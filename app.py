"""Aquiles Gradio backend.

Exposes the agentic pipeline as typed API endpoints via `gr.api`. Launching with
`mcp_server=True` auto-exposes the same functions as MCP tools (REST + MCP from one codebase).
The Next.js front-end consumes the REST endpoints server-side; Claude Code consumes the MCP
tools. Docstrings below become the MCP tool descriptions/schemas — keep them precise.
"""
from __future__ import annotations

import json
from pathlib import Path

import gradio as gr
from dotenv import load_dotenv

from aquiles.pipeline import HOST_FACTORS, assess_target as _assess_target, prioritize as _prioritize

load_dotenv()

DOSSIERS_JSON = Path(__file__).parent / "web" / "public" / "dossiers.json"


def list_candidates() -> list:
    """List the curated arbovirus host-factor genes Aquiles can assess as antiviral targets.

    Returns a list of candidate human host-dependency factors (from published flavivirus CRISPR
    screens and the Krogan Dengue/Zika interactome), each with its biological role and the study
    that nominated it.
    """
    return [
        {"gene": g["gene"], "role": g["role"], "source": g["source"], "virus": g.get("virus", [])}
        for g in HOST_FACTORS.values()
    ]


async def assess_target(gene: str) -> dict:
    """Assess one host-factor gene as a host-directed antiviral target for Aedes-borne arboviruses.

    Runs specialist evidence-gathering (Open Targets, DGIdb, Europe PMC), then an INDEPENDENT
    verifier that checks every claim against the raw database record, then a synthesis into a
    calibrated, cited, go/no-go dossier. Returns the full auditable dossier including the
    verifier's verdicts and how many specialist claims it caught as wrong.

    Args:
        gene (str): Human gene symbol to assess, e.g. STT3A, VCP, AXL, SPCS1.
    """
    dossier = await _assess_target(gene)
    return dossier.model_dump()


async def prioritize_targets() -> dict:
    """Return the ranked, verified antiviral-target dossiers for the whole curated host-factor set.

    Serves the precomputed results if available (fast); otherwise runs the full pipeline live.
    Returns a ranked list of dossiers plus aggregate verifier statistics (how many specialist
    claims the independent verifier caught across all targets).
    """
    if DOSSIERS_JSON.exists():
        data = json.loads(DOSSIERS_JSON.read_text())
        return data if isinstance(data, dict) else {"dossiers": data}
    dossiers = await _prioritize()
    return {"dossiers": [d.model_dump() for d in dossiers]}


with gr.Blocks(title="Aquiles API") as demo:
    gr.Markdown(
        "# Aquiles — API + MCP\n"
        "Auditable host-directed antiviral target triage for arboviruses, with an independent "
        "verifier. Endpoints below are exposed as both REST (`/gradio_api/call/<name>`) and MCP "
        "tools. The product UI is the Next.js front-end."
    )
    gr.api(list_candidates, api_name="list_candidates")
    gr.api(assess_target, api_name="assess_target", concurrency_limit=5)
    gr.api(prioritize_targets, api_name="prioritize_targets", concurrency_limit=2)


if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860, mcp_server=True, ssr_mode=False)
