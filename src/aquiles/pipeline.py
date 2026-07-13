"""Orchestration: per gene, run specialist -> independent verifier (isolated) -> synthesis,
compute grounded scores, and assemble an auditable TargetDossier.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

from dotenv import load_dotenv

from . import agents
from .clients import gather_raw_facts
from .schemas import (
    Citation,
    TargetDossier,
    VerifiedClaim,
    VerifierStats,
)

load_dotenv()

DATA = Path(__file__).parent / "data"


def _load(name: str) -> dict:
    return json.loads((DATA / name).read_text())


HOST_FACTORS = {g["gene"]: g for g in _load("host_factors.json")["genes"]}
FAILED_TRIALS = _load("failed_trials.json")["trials"]

_SURVIVE_THRESHOLD = 0.34  # fraction of claims that must survive verification to not abstain


# ---------- grounded scoring (computed in Python, not by the LLM) ----------

def _druggability(raw: dict) -> tuple[float, str]:
    ot = raw.get("open_targets", {})
    dg = raw.get("dgidb", {})
    buckets = [b.lower() for b in (ot.get("tractability_positive_buckets") or [])]
    n_drugs = ot.get("known_drug_count", 0) or 0
    n_int = dg.get("interaction_count", 0) or 0
    if any("approved" in b for b in buckets) or n_drugs > 0:
        return 0.95, "approved/clinical drug exists"
    if any(k in b for b in buckets for k in ("advanced clinical", "phase")):
        return 0.8, "advanced clinical tractability"
    if any(k in b for b in buckets for k in ("clinical", "discovery precedence", "ligand", "structure")) or n_int >= 3:
        return 0.55, "ligandable / small-molecule precedence"
    if buckets or n_int > 0:
        return 0.35, "predicted tractability only"
    return 0.15, "no tractability evidence"


def _evidence_strength(raw: dict, survivors: int, provenance: str) -> float:
    pmc = raw.get("europepmc", {})
    n_papers = pmc.get("hit_count", 0) or 0
    score = 0.0
    score += min(survivors, 6) / 6 * 0.5
    score += min(n_papers, 6) / 6 * 0.3
    score += 0.2 if provenance else 0.0  # nominated by a published screen/interactome
    return round(min(score, 1.0), 2)


def _confidence(stats: VerifierStats, evidence: float) -> float:
    if stats.proposed == 0:
        return 0.0
    survival = (stats.confirmed + stats.corrected) / stats.proposed
    return round(survival * (0.5 + 0.5 * evidence), 2)


def _rule_recommendation(drug: float, evidence: float, survivors: int, proposed: int) -> str:
    if not proposed or survivors / proposed < _SURVIVE_THRESHOLD:
        return "insufficient-evidence"
    if drug >= 0.7 and evidence >= 0.5:
        return "go"
    if drug < 0.3 and evidence < 0.4:
        return "no-go"
    return "watch" if survivors >= 2 else "insufficient-evidence"


# ---------- per-target ----------

async def assess_target(gene: str) -> TargetDossier:
    meta = HOST_FACTORS.get(gene, {})
    role = meta.get("role", "")
    provenance = meta.get("source", "")

    raw = await gather_raw_facts(gene)
    draft = await agents.run_specialist(gene, role, raw)

    # independent verification, one isolated call per claim, in parallel
    verdicts = await asyncio.gather(*(agents.run_verifier(c, raw) for c in draft.claims))

    verified: list[VerifiedClaim] = []
    stats = VerifierStats()
    for claim, verdict in zip(draft.claims, verdicts):
        if verdict is None:
            stats.unassessed += 1
            v_verdict, corrected, rationale = (
                "unassessed", "",
                "Independent verification unavailable (safety classifier declined); "
                "excluded from the ablation.",
            )
        else:
            setattr(stats, verdict.verdict, getattr(stats, verdict.verdict) + 1)
            stats.proposed += 1
            v_verdict = verdict.verdict
            corrected = verdict.corrected_value
            rationale = verdict.rationale
        verified.append(VerifiedClaim(
            field=claim.field, statement=claim.statement, asserted_value=claim.asserted_value,
            basis=claim.basis, verdict=v_verdict, corrected_value=corrected,
            rationale=rationale, citations=agents.record_citation(claim.field, raw),
        ))

    survivors = [v for v in verified if v.verdict in ("confirmed", "corrected")]
    drug_score, tract_label = _druggability(raw)
    evidence = _evidence_strength(raw, len(survivors), provenance)
    confidence = _confidence(stats, evidence)

    ot = raw.get("open_targets", {})
    known_drugs = [d.get("name") for d in (ot.get("known_drugs") or []) if d.get("name")]

    # synthesis over VERIFIED survivors only
    survivors_blob = "\n".join(
        f"- [{v.verdict}] ({v.field}) {v.statement} | asserted='{v.asserted_value}'"
        + (f" | corrected='{v.corrected_value}'" if v.corrected_value else "")
        + f" | {v.rationale}"
        for v in survivors
    ) or "(no claims survived verification)"
    scores_blob = (f"druggability={drug_score} ({tract_label}); evidence_strength={evidence}; "
                   f"confidence={confidence}; known_drugs={known_drugs[:6]}; "
                   f"verifier_caught={stats.caught}/{stats.proposed}")
    trials_blob = "\n".join(
        f"- {t['drug']} (targets {t['target']}): {t['failure_reason']}" for t in FAILED_TRIALS
    )

    synth = (await agents.run_synthesis(gene, role, survivors_blob, trials_blob, scores_blob)
             if survivors else None)

    citations = [Citation(source="host-factor screen", ref=provenance)] if provenance else []
    if ot.get("available"):
        citations.append(Citation(source="Open Targets", ref=ot.get("ensembl_id", ""),
                                  url=ot.get("url", "")))
    for p in (raw.get("europepmc", {}).get("papers") or [])[:3]:
        citations.append(Citation(source="Europe PMC", ref=f"PMID {p.get('pmid')}",
                                  url=p.get("url", ""), snippet=(p.get("title") or "")[:120]))

    dossier = TargetDossier(
        gene=gene, source=provenance, host_factor_role=role,
        druggability_score=drug_score, evidence_strength=evidence, confidence=confidence,
        n_known_drugs=len(known_drugs), known_drugs=known_drugs[:10], tractability=tract_label,
        verified_claims=verified, verifier_stats=stats, citations=citations,
    )
    if synth is not None:
        dossier.host_factor_role = synth.host_factor_role or role
        dossier.summary = synth.summary
        dossier.mechanistic_hypothesis = synth.mechanistic_hypothesis
        dossier.why_prior_failed = synth.why_prior_failed
        dossier.recommendation = synth.recommendation
        dossier.recommendation_rationale = synth.recommendation_rationale
        dossier.validation_experiment = synth.validation_experiment
    else:
        # deterministic fallback — LLM synthesis declined or nothing to synthesize
        drugs_txt = f" Known/annotated drugs: {', '.join(known_drugs[:4])}." if known_drugs else ""
        caught_txt = (f" The independent verifier caught {stats.caught} of {stats.proposed} "
                      "specialist claims against the source records.") if stats.caught else ""
        dossier.recommendation = _rule_recommendation(
            drug_score, evidence, len(survivors), stats.proposed)
        dossier.summary = (
            f"{gene} — {role} Druggability {drug_score:.2f} ({tract_label}); "
            f"{len(survivors)} of {stats.proposed} specialist claims verified against database "
            f"records.{drugs_txt}{caught_txt}"
        )
        dossier.recommendation_rationale = (
            f"Rule-based call from verified evidence: druggability {drug_score:.2f}, evidence "
            f"strength {evidence:.2f}, {len(survivors)}/{stats.proposed} claims verified"
            + ("; LLM synthesis unavailable." if survivors else ".")
        )
        dossier.mechanistic_hypothesis = (
            f"Pharmacologically inhibiting {gene} could remove a host function the pathogen "
            f"co-opts ({role.rstrip('.')}), blocking replication without directly targeting a "
            "viral protein."
        )
        dossier.validation_experiment = (
            f"CRISPRi/knockdown of {gene} (plus chemical inhibition where a tool compound exists) "
            "in a permissive human cell line, read out by viral-yield reduction with a paired "
            "host-cytotoxicity counter-screen."
        )
        glyco = gene in {"STT3A", "STT3B", "DDOST", "MAGT1", "OSTC", "SPCS1", "SPCS3"}
        dossier.why_prior_failed = (
            "Host-directed anti-dengue candidates have repeatedly failed in controlled trials "
            "(chloroquine, celgosivir, ivermectin) mainly from insufficient in-vivo target "
            "engagement at tolerated doses and dosing after peak viremia"
            + (" — celgosivir, a host alpha-glucosidase (glycosylation) inhibitor, is the most "
               "directly relevant precedent for this glycosylation-pathway target."
               if glyco else "; any candidate here must clear that target-engagement/timing bar.")
        )
    return dossier


async def prioritize(genes: list[str] | None = None, concurrency: int = 4) -> list[TargetDossier]:
    genes = genes or list(HOST_FACTORS.keys())
    sem = asyncio.Semaphore(concurrency)

    async def _one(g: str) -> TargetDossier:
        async with sem:
            try:
                return await assess_target(g)
            except Exception as e:  # noqa: BLE001
                return TargetDossier(gene=g, error=f"{type(e).__name__}: {e}")

    dossiers = await asyncio.gather(*(_one(g) for g in genes))
    dossiers.sort(
        key=lambda d: 0.5 * d.druggability_score + 0.3 * d.evidence_strength + 0.2 * d.confidence,
        reverse=True,
    )
    return dossiers


# ---------- CLI ----------

def _cli() -> None:
    ap = argparse.ArgumentParser(description="Aquiles host-directed antiviral target triage")
    ap.add_argument("--gene", help="assess a single gene symbol")
    ap.add_argument("--all", action="store_true", help="prioritize the whole curated set")
    args = ap.parse_args()
    if args.gene:
        d = asyncio.run(assess_target(args.gene))
        print(d.model_dump_json(indent=2))
    elif args.all:
        ds = asyncio.run(prioritize())
        for d in ds:
            print(f"{d.gene:8} drug={d.druggability_score:.2f} ev={d.evidence_strength:.2f} "
                  f"conf={d.confidence:.2f} rec={d.recommendation} "
                  f"caught={d.verifier_stats.caught}/{d.verifier_stats.proposed}")
    else:
        ap.print_help()


if __name__ == "__main__":
    _cli()
