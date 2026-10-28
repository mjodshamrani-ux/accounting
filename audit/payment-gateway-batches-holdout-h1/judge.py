"""EXPECTED.json for PG-1 H1 from the sealed foundation oracle as it is
(audit/payment-gateway-batches-foundation/oracle.py, pinned by that
foundation's seal), run on these files and their inputs. Nothing in the
oracle is changed or wrapped.

  python3 -B audit/payment-gateway-batches-holdout-h1/judge.py frozen > frozen/EXPECTED.json
"""
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ORACLE = HERE.parent / "payment-gateway-batches-foundation" / "oracle.py"


def oracle():
    spec = importlib.util.spec_from_file_location("pg1_foundation_oracle", ORACLE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run(folder):
    folder = Path(folder)
    judge = oracle().judge
    ids = sorted(p.name[: -len("-input.json")] for p in folder.glob("*-input.json"))
    return {"schema": "tarasuf-pg1-batches-h1-expected/1",
            "oracle": "audit/payment-gateway-batches-foundation/oracle.py",
            "stories": {sid: judge(folder, sid) for sid in ids}}


def main(folder):
    sys.stdout.write(json.dumps(run(folder), ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
