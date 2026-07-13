"""The validated number: verifier ON vs OFF ablation, from the precomputed dossiers.

Verifier OFF = trust every specialist claim. Verifier ON = keep only claims that survive the
independent check. The difference (claims caught) is the honest measure of what independent,
database-anchored verification adds over a self-checking model.
"""
from __future__ import annotations

import json
from pathlib import Path

DOSSIERS = Path(__file__).resolve().parent.parent / "web" / "public" / "dossiers.json"


def main() -> None:
    if not DOSSIERS.exists():
        raise SystemExit("run scripts/precompute.py first")
    data = json.loads(DOSSIERS.read_text())
    v = data.get("verifier", {})
    proposed = v.get("claims_proposed", 0)
    caught = v.get("claims_caught", 0)
    print("=" * 60)
    print("ABLATION — independent verifier ON vs OFF")
    print("=" * 60)
    print(f"targets assessed          : {data.get('n_targets')}")
    print(f"specialist claims proposed: {proposed}")
    print(f"  confirmed by raw record : {proposed - caught}")
    print(f"  corrected               : {v.get('corrected')}")
    print(f"  unsupported / rejected  : {v.get('unsupported')}")
    print("-" * 60)
    print(f">>> the independent verifier caught {caught} of {proposed} specialist claims "
          f"({v.get('caught_pct')}%) that a self-checking model would have kept.")
    print("=" * 60)


if __name__ == "__main__":
    main()
