"""Async clients for external ground-truth databases, with on-disk caching.

Every fetch is cached to `cache/` so the pipeline, precompute and the recorded run are
offline-safe and deterministic. Failures degrade gracefully (return an `available: False`
record) so one dead API never breaks the pipeline.

These raw records are the INDEPENDENT ground truth the verifier checks the specialist's
claims against.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx

CACHE_DIR = Path(__file__).parent / "cache"
CACHE_DIR.mkdir(exist_ok=True)

OPEN_TARGETS = "https://api.platform.opentargets.org/api/v4/graphql"
DGIDB = "https://dgidb.org/api/graphql"
EUROPE_PMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"

_TIMEOUT = httpx.Timeout(25.0)
_HEADERS = {"User-Agent": "Aquiles/0.1 (hackathon; host-directed antiviral triage)"}


def _cache_path(namespace: str, key: str) -> Path:
    h = hashlib.sha1(f"{namespace}:{key}".encode()).hexdigest()[:16]
    return CACHE_DIR / f"{namespace}_{key.replace('/', '_')[:40]}_{h}.json"


def _cache_get(namespace: str, key: str) -> Any | None:
    p = _cache_path(namespace, key)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            return None
    return None


def _cache_set(namespace: str, key: str, value: Any) -> None:
    _cache_path(namespace, key).write_text(json.dumps(value, indent=2))


async def _graphql(client: httpx.AsyncClient, url: str, query: str, variables: dict) -> dict:
    r = await client.post(url, json={"query": query, "variables": variables}, headers=_HEADERS)
    r.raise_for_status()
    return r.json()


# ---------- Open Targets ----------

_OT_SEARCH = """
query ($q: String!) {
  search(queryString: $q, entityNames: ["target"]) {
    hits { id name entity }
  }
}
"""

_OT_TARGET = """
query ($id: String!) {
  target(ensemblId: $id) {
    id
    approvedSymbol
    approvedName
    tractability { modality label value }
    safetyLiabilities { event }
    knownDrugs { count rows { drug { name } phase mechanismOfAction disease { name } } }
  }
}
"""


async def fetch_open_targets(client: httpx.AsyncClient, gene: str) -> dict:
    cached = _cache_get("opentargets", gene)
    if cached is not None:
        return cached
    out: dict = {"source": "Open Targets", "gene": gene, "available": False}
    try:
        s = await _graphql(client, OPEN_TARGETS, _OT_SEARCH, {"q": gene})
        hits = (s.get("data", {}).get("search", {}) or {}).get("hits", []) or []
        ensembl = next((h["id"] for h in hits if h.get("id", "").startswith("ENSG")), None)
        if not ensembl:
            out["error"] = "gene not resolved to Ensembl id"
            _cache_set("opentargets", gene, out)
            return out
        d = await _graphql(client, OPEN_TARGETS, _OT_TARGET, {"id": ensembl})
        t = d.get("data", {}).get("target") or {}
        tract = t.get("tractability") or []
        # buckets where value is True, e.g. "Approved Drug", "Advanced Clinical", ...
        positive = [x.get("label") for x in tract if x.get("value")]
        kd = t.get("knownDrugs") or {}
        rows = kd.get("rows") or []
        drugs = []
        seen = set()
        for row in rows:
            name = (row.get("drug") or {}).get("name")
            if name and name not in seen:
                seen.add(name)
                drugs.append({"name": name, "phase": row.get("phase"),
                              "moa": row.get("mechanismOfAction"),
                              "disease": (row.get("disease") or {}).get("name")})
        out.update({
            "available": True,
            "ensembl_id": ensembl,
            "approved_symbol": t.get("approvedSymbol"),
            "approved_name": t.get("approvedName"),
            "tractability_positive_buckets": positive,
            "known_drug_count": kd.get("count", 0),
            "known_drugs": drugs[:15],
            "safety_liabilities": [x.get("event") for x in (t.get("safetyLiabilities") or [])][:15],
            "url": f"https://platform.opentargets.org/target/{ensembl}",
        })
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
    _cache_set("opentargets", gene, out)
    return out


# ---------- DGIdb ----------

_DGIDB_Q = """
query ($names: [String!]) {
  genes(names: $names) {
    nodes {
      name
      interactions {
        drug { name conceptId }
        interactionScore
        interactionTypes { type }
        sources { sourceDbName }
      }
    }
  }
}
"""


async def fetch_dgidb(client: httpx.AsyncClient, gene: str) -> dict:
    cached = _cache_get("dgidb", gene)
    if cached is not None:
        return cached
    out: dict = {"source": "DGIdb", "gene": gene, "available": False}
    try:
        d = await _graphql(client, DGIDB, _DGIDB_Q, {"names": [gene]})
        nodes = (d.get("data", {}).get("genes", {}) or {}).get("nodes", []) or []
        interactions = []
        for node in nodes:
            for it in node.get("interactions", []) or []:
                interactions.append({
                    "drug": (it.get("drug") or {}).get("name"),
                    "concept_id": (it.get("drug") or {}).get("conceptId"),
                    "score": it.get("interactionScore"),
                    "types": [x.get("type") for x in (it.get("interactionTypes") or [])],
                    "sources": [x.get("sourceDbName") for x in (it.get("sources") or [])],
                })
        interactions.sort(key=lambda x: (x.get("score") or 0), reverse=True)
        out.update({
            "available": True,
            "interaction_count": len(interactions),
            "interactions": interactions[:20],
            "url": f"https://dgidb.org/results?searchType=gene&searchTerms={gene}",
        })
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
    _cache_set("dgidb", gene, out)
    return out


# ---------- Europe PMC ----------

async def fetch_europepmc(client: httpx.AsyncClient, gene: str) -> dict:
    cached = _cache_get("europepmc", gene)
    if cached is not None:
        return cached
    query = (f'("{gene}") AND (dengue OR zika OR chikungunya OR flavivirus OR arbovirus) '
             'AND (host factor OR antiviral OR target OR replication)')
    out: dict = {"source": "Europe PMC", "gene": gene, "available": False, "query": query}
    try:
        r = await client.get(EUROPE_PMC, params={
            "query": query, "format": "json", "pageSize": 6,
            "resultType": "core",  # relevance sort (default) — avoids mega-cited off-topic guidelines
        }, headers=_HEADERS)
        r.raise_for_status()
        results = (r.json().get("resultList", {}) or {}).get("result", []) or []
        papers = []
        for p in results:
            abstract = (p.get("abstractText") or "").strip()
            authors = (p.get("authorString") or "")
            papers.append({
                "title": p.get("title"),
                # cap authors: consortium/guideline papers list thousands, blowing up the record
                "authors": (authors[:140] + " et al.") if len(authors) > 140 else authors,
                "year": p.get("pubYear"),
                "pmid": p.get("pmid"),
                "doi": p.get("doi"),
                "cited_by": p.get("citedByCount"),
                "abstract_snippet": abstract[:450],
                "url": (f"https://europepmc.org/article/{p.get('source', 'MED')}/{p.get('id')}"),
            })
        out.update({"available": True, "hit_count": len(papers), "papers": papers})
    except Exception as e:  # noqa: BLE001
        out["error"] = f"{type(e).__name__}: {e}"
    _cache_set("europepmc", gene, out)
    return out


# ---------- combined ----------

async def gather_raw_facts(gene: str) -> dict:
    """Fetch all external ground-truth records for a gene, in parallel."""
    import asyncio

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        ot, dg, pmc = await asyncio.gather(
            fetch_open_targets(client, gene),
            fetch_dgidb(client, gene),
            fetch_europepmc(client, gene),
        )
    return {"gene": gene, "open_targets": ot, "dgidb": dg, "europepmc": pmc}
