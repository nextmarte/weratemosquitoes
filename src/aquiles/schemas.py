"""Pydantic models for Aquiles.

Two families:
  * LLM-output models (`Specialist*`, `Verifier*`, `Synthesis*`) — filled by Claude via
    structured outputs. Kept flat and Optional-free (use "" for N/A) so they serialize
    cleanly through the structured-output JSON schema.
  * Dossier models (`Citation`, `VerifiedClaim`, `TargetDossier`) — assembled in Python and
    serialized to `dossiers.json` for the Gradio API / MCP tools / Next.js front-end.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Field_ = Literal[
    "host_factor_role",
    "druggability",
    "known_drugs",
    "safety",
    "prior_antiviral_evidence",
    "expression",
]

Verdict = Literal["confirmed", "corrected", "unsupported"]
Recommendation = Literal["go", "watch", "no-go", "insufficient-evidence"]


# ---------- LLM output models ----------

class SpecialistClaim(BaseModel):
    field: Field_ = Field(description="Which aspect of the target this claim is about.")
    statement: str = Field(description="One-sentence claim in plain English.")
    asserted_value: str = Field(
        description="The concrete value being asserted (e.g. a tractability bucket, a drug "
        "name, an ADR, a count). Keep it short and checkable against a database record."
    )
    basis: str = Field(
        description="What the claim is grounded in: cite the specific raw record field "
        "if it came from the provided data, or say 'prior knowledge' if not."
    )


class SpecialistDraft(BaseModel):
    gene: str
    claims: list[SpecialistClaim]


class VerifierVerdict(BaseModel):
    verdict: Verdict = Field(
        description="'confirmed' if the raw record supports the asserted value; 'corrected' "
        "if the record supports a different value; 'unsupported' if the record neither "
        "supports it nor offers a correction."
    )
    corrected_value: str = Field(
        default="",
        description="If verdict is 'corrected', the value the raw record actually supports. "
        "Otherwise empty string.",
    )
    rationale: str = Field(
        description="One sentence citing the exact raw-record evidence for the verdict."
    )


class RepurposingHypothesis(BaseModel):
    has_candidate: bool = Field(
        description="True if a credible drug-repurposing candidate exists among the provided known drugs.")
    drug: str = Field(default="", description="The candidate drug (MUST be one of the provided known drugs).")
    approved_for: str = Field(default="", description="The drug's current/original indication (e.g. an oncology or antiparasitic use).")
    mechanism: str = Field(default="", description="How the drug engages this human host-factor target.")
    rationale: str = Field(default="", description="Why repurposing it as a host-directed antiviral for dengue/Zika is plausible.")
    why_it_might_succeed: str = Field(default="", description="Why it could avoid the failure modes that sank prior dengue drug trials.")
    confidence: str = Field(default="", description="High | Medium | Low, with a one-clause reason.")
    caveats: str = Field(default="", description="Key risks or unknowns.")


class SynthesisOutput(BaseModel):
    host_factor_role: str = Field(description="How the arbovirus depends on this host factor.")
    summary: str = Field(description="2-3 sentence target summary for a scientist.")
    mechanistic_hypothesis: str = Field(
        description="Why inhibiting this host factor could block the virus."
    )
    why_prior_failed: str = Field(
        default="",
        description="If any listed failed repurposing trial is mechanistically relevant, "
        "explain the likely translational failure mode. Otherwise empty string.",
    )
    recommendation: Recommendation
    recommendation_rationale: str
    validation_experiment: str = Field(
        description="A concrete next experiment (e.g. CRISPRi + viral yield assay)."
    )


# ---------- Dossier models (assembled in Python) ----------

class Citation(BaseModel):
    source: str  # "Open Targets" | "DGIdb" | "Europe PMC" | "Krogan interactome" | ...
    ref: str  # accession / id / short label
    url: str = ""
    snippet: str = ""


class VerifiedClaim(BaseModel):
    field: str
    statement: str
    asserted_value: str
    basis: str
    verdict: str  # confirmed | corrected | unsupported | unassessed
    corrected_value: str = ""
    rationale: str
    citations: list[Citation] = Field(default_factory=list)


class VerifierStats(BaseModel):
    proposed: int = 0  # claims actually assessed (confirmed + corrected + unsupported)
    confirmed: int = 0
    corrected: int = 0
    unsupported: int = 0
    unassessed: int = 0  # verifier declined (safety classifier) — excluded from the ablation

    @property
    def caught(self) -> int:
        """Claims the independent verifier corrected or rejected against the raw record."""
        return self.corrected + self.unsupported


class TargetDossier(BaseModel):
    gene: str
    source: str = ""  # provenance of the host-factor candidate (screen / interactome)
    host_factor_role: str = ""
    summary: str = ""
    mechanistic_hypothesis: str = ""
    why_prior_failed: str = ""
    recommendation: Recommendation = "insufficient-evidence"
    recommendation_rationale: str = ""
    validation_experiment: str = ""

    # grounded numeric scores (computed in Python from verified evidence)
    druggability_score: float = 0.0  # 0-1
    evidence_strength: float = 0.0  # 0-1
    confidence: float = 0.0  # 0-1

    n_known_drugs: int = 0
    known_drugs: list[str] = Field(default_factory=list)
    tractability: str = ""

    verified_claims: list[VerifiedClaim] = Field(default_factory=list)
    verifier_stats: VerifierStats = Field(default_factory=VerifierStats)
    citations: list[Citation] = Field(default_factory=list)
    repurposing: RepurposingHypothesis | None = None
    error: str = ""
