"""Regenerate the CLR-1 dense stories into a folder and check every file
against the sealed DENSE-MANIFEST.json, byte for byte by hash. Runs use the
folder only after this check passes.

    python3 -B audit/clearing-groups-foundation/dense.py DIR
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def materialize(folder):
    folder = Path(folder)
    subprocess.run([sys.executable, "-B", str(HERE / "render.py"), "--dense", str(folder)], check=True)
    sealed = json.loads((HERE / "frozen" / "DENSE-MANIFEST.json").read_text(encoding="utf-8"))["files"]
    present = {p.name for p in folder.iterdir() if p.name.endswith((".csv", "-input.json"))}
    problems = sorted(present ^ set(sealed))
    for name, entry in sealed.items():
        path = folder / name
        if path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            problems.append(name)
    if problems:
        raise SystemExit(f"dense files differ from the seal: {problems}")
    return folder


if __name__ == "__main__":
    materialize(sys.argv[1])
    print(json.dumps({"dense": sys.argv[1], "sealed": True}))
