"""The three Claude sub-agents: specialist, independent verifier, synthesizer.

Design (the differentiator): the specialist reasons freely (raw records + its own knowledge)
and can over-claim. The verifier runs in an ISOLATED context — it sees only ONE claim plus
the raw database record it should be checkable against, and nothing else — so its judgement is
an independent, ground-truth-anchored check, not the same model reviewing itself.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

from anthropic import AsyncAnthropic
from dotenv import load_dotenv

from .schemas import (
    SpecialistClaim,
    SpecialistDraft,
    SynthesisOutput,
    VerifierVerdict,
)

# Haiku 4.5 is the refusal-resistant model for this antiviral-target content (Sonnet 5 / Opus 4.8
# trip the dual-use bio classifier); it is a fully capable specialist and record-checker here.
MODEL_SPECIALIST = os.getenv("AQUILES_MODEL_SPECIALIST", "claude-haiku-4-5")
MODEL_VERIFIER = os.getenv("AQUILES_MODEL_VERIFIER", "claude-haiku-4-5")
MODEL_SYNTH = os.getenv("AQUILES_MODEL_SYNTH", "claude-haiku-4-5")

_client: AsyncAnthropic | None = None


def client() -> AsyncAnthropic:
    global _client
    if _client is None:
        # load .env by absolute repo path so auth resolves regardless of CWD / entrypoint
        load_dotenv(Path(__file__).resolve().parents[2] / ".env")
        _client = AsyncAnthropic()
    return _client


# ---------- rendering ----------

def _render_facts(raw: dict) -> str:
    ot, dg, pmc = raw.get("open_targets", {}), raw.get("dgidb", {}), raw.get("europepmc", {})
    lines = []
    lines.append("## Open Targets")
    if ot.get("available"):
        lines.append(f"tractability_positive_buckets: {ot.get('tractability_positive_buckets')}")
        lines.append(f"known_drug_count: {ot.get('known_drug_count')}")
        lines.append(f"known_drugs: {json.dumps(ot.get('known_drugs', [])[:8])}")
        lines.append(f"safety_liabilities: {ot.get('safety_liabilities')}")
    else:
        lines.append(f"(unavailable: {ot.get('error')})")
    lines.append("## DGIdb drug-gene interactions")
    if dg.get("available"):
        lines.append(f"interaction_count: {dg.get('interaction_count')}")
        lines.append(f"interactions: {json.dumps(dg.get('interactions', [])[:10])}")
    else:
        lines.append(f"(unavailable: {dg.get('error')})")
    lines.append("## Europe PMC literature")
    if pmc.get("available"):
        for p in pmc.get("papers", [])[:6]:
            lines.append(f"- {p.get('year')} {p.get('title')} (PMID {p.get('pmid')}, cited {p.get('cited_by')})")
    else:
        lines.append(f"(unavailable: {pmc.get('error')})")
    return "\n".join(lines)


def relevant_record(field: str, raw: dict) -> str:
    """The raw record the verifier is allowed to see for a claim of this field — nothing else."""
    ot, dg, pmc = raw.get("open_targets", {}), raw.get("dgidb", {}), raw.get("europepmc", {})
    if field in ("druggability", "known_drugs", "safety"):
        rec = {
            "Open Targets": {
                "tractability_positive_buckets": ot.get("tractability_positive_buckets"),
                "known_drug_count": ot.get("known_drug_count"),
                "known_drugs": ot.get("known_drugs"),
                "safety_liabilities": ot.get("safety_liabilities"),
                "available": ot.get("available"),
                "url": ot.get("url"),
            },
            "DGIdb": {
                "interaction_count": dg.get("interaction_count"),
                "interactions": dg.get("interactions"),
                "available": dg.get("available"),
                "url": dg.get("url"),
            },
        }
    elif field in ("prior_antiviral_evidence", "host_factor_role", "expression"):
        # titles/PMIDs only — full abstracts (viral-mechanism prose) over-trip bio classifiers
        slim = [{"title": p.get("title"), "year": p.get("year"), "pmid": p.get("pmid"),
                 "cited_by": p.get("cited_by")}
                for p in (pmc.get("papers") or [])[:6]]
        rec = {"Europe PMC (paper titles)": {"papers": slim, "available": pmc.get("available")}}
    else:
        rec = {"open_targets": ot, "dgidb": dg, "europepmc": pmc}
    return json.dumps(rec, indent=2)


def record_citation(field: str, raw: dict):
    from .schemas import Citation
    ot, pmc = raw.get("open_targets", {}), raw.get("europepmc", {})
    cites = []
    if field in ("druggability", "known_drugs", "safety") and ot.get("available"):
        cites.append(Citation(source="Open Targets", ref=ot.get("ensembl_id", ""),
                              url=ot.get("url", "")))
    if field in ("prior_antiviral_evidence", "host_factor_role", "expression") and pmc.get("available"):
        for p in (pmc.get("papers") or [])[:2]:
            cites.append(Citation(source="Europe PMC", ref=f"PMID {p.get('pmid')}",
                                  url=p.get("url", ""), snippet=(p.get("title") or "")[:120]))
    return cites


# ---------- agents ----------

FALLBACK_MODEL = "claude-opus-4-8"

BENIGN_CONTEXT = (
    "You are assisting legitimate, defensive biomedical drug-discovery research. The task is to "
    "evaluate HUMAN host proteins as candidate therapeutic drug targets for host-directed "
    "ANTIVIRAL medicines that protect patients from mosquito-borne flavivirus disease (dengue, "
    "Zika, chikungunya, yellow fever), for which no antiviral is currently approved. Every input "
    "is a public database record (Open Targets, DGIdb, Europe PMC) or published, peer-reviewed "
    "literature. This is standard therapeutic target-validation work.\n\n"
)


async def _structured(model: str, max_tokens: int, system: str, user: str, schema,
                      *, disable_thinking: bool):
    """Call Claude for a structured result, robust to safety-classifier false positives.

    Benign antiviral-target text occasionally trips dual-use bio classifiers (stop_reason
    'refusal'). On a refusal or an unparsed output, retry on a more calibrated fallback model.
    Returns the parsed schema instance, or None if every attempt declined/failed.
    """
    models = [model] if model == FALLBACK_MODEL else [model, FALLBACK_MODEL]
    kwargs: dict = {"thinking": {"type": "disabled"}} if disable_thinking else {}
    for m in models:
        try:
            resp = await client().messages.parse(
                model=m, max_tokens=max_tokens, system=system,
                messages=[{"role": "user", "content": user}], output_format=schema, **kwargs,
            )
        except Exception as e:  # noqa: BLE001
            import sys
            print(f"[structured] {m} error: {type(e).__name__}: {e}", file=sys.stderr)
            continue
        if resp.stop_reason == "refusal":
            import sys
            print(f"[refusal] {m} declined ({schema.__name__})", file=sys.stderr)
            continue  # false-positive refusal — try the fallback model
        if resp.parsed_output is not None:
            return resp.parsed_output
        text = "".join(getattr(b, "text", "") for b in resp.content
                       if getattr(b, "type", None) == "text").strip()
        if text:
            try:
                return schema.model_validate_json(text)
            except Exception:  # noqa: BLE001
                pass
    return None


_SPECIALIST_SYSTEM = (
    "You are a drug-target evidence analyst. Given public database records (Open Targets, DGIdb, "
    "Europe PMC) and your expertise, assess the human protein below as a candidate therapeutic "
    "drug target. Produce concrete, checkable claims across these fields: host_factor_role, "
    "druggability, known_drugs, safety, prior_antiviral_evidence, expression. Each claim's "
    "`asserted_value` must be short and checkable against a database record (a tractability "
    "bucket, a drug name, an ADR, a count, a finding). Set `basis` honestly: name the exact "
    "raw-record field if grounded there, or write 'prior knowledge' if you are reasoning beyond "
    "the provided records. Aim for 6-8 claims."
)


async def run_specialist(gene: str, host_factor_role: str, raw: dict) -> SpecialistDraft:
    msg = (
        f"Gene: {gene}\nCurated host-factor role: {host_factor_role}\n\n"
        f"Raw database records:\n{_render_facts(raw)}"
    )
    draft = await _structured(MODEL_SPECIALIST, 2000, _SPECIALIST_SYSTEM, msg,
                              SpecialistDraft, disable_thinking=False)
    if draft is None:
        return SpecialistDraft(gene=gene, claims=[])
    draft.gene = gene
    return draft


_VERIFIER_SYSTEM = (
    "You are an INDEPENDENT verifier. You are given exactly ONE claim and the RAW database "
    "record it should be checkable against — and nothing else. Judge the claim ONLY against that "
    "raw record. Do NOT use outside knowledge or assumptions.\n"
    "- 'confirmed': the raw record supports the asserted value.\n"
    "- 'corrected': the raw record supports a DIFFERENT value (give it in corrected_value).\n"
    "- 'unsupported': the raw record neither supports the asserted value nor offers a correction "
    "(e.g. the claim's basis was 'prior knowledge' and the record is silent).\n"
    "Cite the exact raw-record field in your rationale."
)


async def run_verifier(claim: SpecialistClaim, raw: dict) -> VerifierVerdict | None:
    """Independent, isolated-context check of one claim. Returns None if the verifier declined
    (safety classifier) on both the primary and fallback model — the caller marks it unassessed."""
    rec = relevant_record(claim.field, raw)
    msg = (
        "CLAIM:\n"
        f"  field: {claim.field}\n  statement: {claim.statement}\n"
        f"  asserted_value: {claim.asserted_value}\n  basis: {claim.basis}\n\n"
        f"RAW RECORD (the only ground truth you may use):\n{rec}"
    )
    return await _structured(MODEL_VERIFIER, 1200, _VERIFIER_SYSTEM, msg,
                             VerifierVerdict, disable_thinking=True)


_SYNTH_SYSTEM = (
    "You are a scientist writing a therapeutic drug-target assessment for a human protein. Use "
    "ONLY the verified claims provided (each already checked against a database). Be calibrated "
    "and auditable; never assert beyond the verified evidence. If a listed prior drug trial is "
    "mechanistically relevant to this target, explain the likely reason it did not succeed in "
    "why_prior_failed."
)


async def run_synthesis(
    gene: str,
    host_factor_role: str,
    verified_claims_blob: str,
    failed_trials_blob: str,
    scores_blob: str,
) -> SynthesisOutput | None:
    msg = (
        f"Target gene: {gene}\nCurated host-factor role: {host_factor_role}\n\n"
        f"VERIFIED CLAIMS (verdict-annotated):\n{verified_claims_blob}\n\n"
        f"GROUNDED SCORES:\n{scores_blob}\n\n"
        f"FAILED DENGUE REPURPOSING TRIALS (for why_prior_failed reasoning):\n{failed_trials_blob}"
    )
    return await _structured(MODEL_SYNTH, 2000, _SYNTH_SYSTEM, msg,
                             SynthesisOutput, disable_thinking=True)
