"""The sealed INV-3 foundation is intact: focused inputs by hash and nothing
else in the folder, the facts regenerate from stories.py byte for byte, the
oracle reproduces EXPECTED.json, the independent file check passed with its
planted changes rejected, the dense files regenerate to their sealed hashes,
the oracle reproduces their sealed expectations and agrees with every dense
intent, and the seal pins the tools as they are now. The oracle's agreement
with every focused intent is test_oracle.py's.

    python3 -B audit/inventory-links-foundation/check_seal.py
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FROZEN = HERE / "frozen"
sys.path.insert(0, str(HERE))
import dense  # noqa: E402
import seal  # noqa: E402
import stories as model  # noqa: E402


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def problems():
    out = []
    manifest = json.loads((FROZEN / "INPUT-MANIFEST.json").read_text(encoding="utf-8"))
    present = {p.name for p in FROZEN.iterdir()} - seal.NOT_INPUTS
    if present != set(manifest["files"]):
        out.append(f"inputs differ from the manifest: {sorted(present ^ set(manifest['files']))}")
    for name, entry in manifest["files"].items():
        path = FROZEN / name
        if path.exists() and (sha(path) != entry["sha256"] or path.stat().st_size != entry["bytes"]):
            out.append(f"{name} differs from the manifest")
    pins = json.loads((FROZEN / "SEAL.json").read_text(encoding="utf-8"))["pins"]
    if set(pins) != {"INPUT-MANIFEST.json", *seal.JUDGED, *seal.TOOLS, "../inventory-register/reference.py"}:
        out.append("the seal pins another set of files")
    for name, digest in pins.items():
        path = FROZEN / name if (FROZEN / name).exists() else HERE / name
        if sha(path) != digest:
            out.append(f"{name} differs from the seal")
    facts = subprocess.run([sys.executable, "-B", str(HERE / "stories.py")], check=True, capture_output=True).stdout
    if facts != (FROZEN / "stories.json").read_bytes():
        out.append("stories.py no longer regenerates the sealed facts")
    expected = subprocess.run([sys.executable, "-B", str(HERE / "oracle.py"), str(FROZEN)], check=True,
                              capture_output=True).stdout
    if expected != (FROZEN / "EXPECTED.json").read_bytes():
        out.append("the oracle no longer reproduces EXPECTED.json")
    verify = json.loads((FROZEN / "VERIFY.json").read_text(encoding="utf-8"))
    if not verify.get("passed") or not verify["selfTest"] or not all(p["rejected"] for p in verify["selfTest"]) \
            or verify["factsSha256"] != sha(FROZEN / "stories.json"):
        out.append("the independent file check did not pass on these facts")
    sealed = json.loads((FROZEN / "DENSE-MANIFEST.json").read_text(encoding="utf-8"))
    if not sealed["verify"]["passed"]:
        out.append("the independent check did not pass on the dense files")
    with tempfile.TemporaryDirectory() as tmp:
        try:
            dense.materialize(tmp)
        except SystemExit as error:
            out.append(str(error))
            return out
        judged = json.loads(subprocess.run([sys.executable, "-B", str(HERE / "oracle.py"), "--dense", tmp],
                                           check=True, capture_output=True).stdout)
    if judged["sha256"] != sealed["expectedSha256"]:
        out.append("the oracle no longer reproduces the dense expectations")
    for s in model.dense():
        i, got = s.to_json()["intent"], judged["stories"][s.id]
        if got["refused"] != i["refused"] or got.get("financial") != i["financial"] \
                or [[r, st, c] for r, st, c, *_ in got.get("links", [])] != (i["links"] if not i["refused"] else []) \
                or got.get("unlinked", []) != i["unlinked"]:
            out.append(f"{s.id}: the oracle disagrees with the dense intent")
    return out


def main():
    found = problems()
    print(json.dumps({"sealIntact": not found, "problems": found}, indent=1))
    if found:
        sys.exit(1)


if __name__ == "__main__":
    main()
