"""Run the full pipeline over the curated host-factor set and write web/public/dossiers.json.

This de-risks the UI: the front-end reads real, verified dossiers instantly and the recorded
run can't be broken by a slow API. Re-run any time; external fetches are disk-cached.
"""
from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from aquiles.pipeline import prioritize  # noqa: E402

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "dossiers.json"


async def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    dossiers = await prioritize()
    proposed = sum(d.verifier_stats.proposed for d in dossiers)
    caught = sum(d.verifier_stats.caught for d in dossiers)
    corrected = sum(d.verifier_stats.corrected for d in dossiers)
    unsupported = sum(d.verifier_stats.unsupported for d in dossiers)
    payload = {
        "generated_seconds": round(time.time() - t0, 1),
        "n_targets": len(dossiers),
        "verifier": {
            "claims_proposed": proposed,
            "claims_caught": caught,
            "corrected": corrected,
            "unsupported": unsupported,
            "caught_pct": round(100 * caught / proposed, 1) if proposed else 0.0,
        },
        "dossiers": [d.model_dump() for d in dossiers],
    }
    OUT.write_text(json.dumps(payload, indent=2))
    print(f"wrote {OUT} — {len(dossiers)} targets in {payload['generated_seconds']}s")
    print(f"independent verifier caught {caught}/{proposed} specialist claims "
          f"({payload['verifier']['caught_pct']}%)")


if __name__ == "__main__":
    asyncio.run(main())
