"""Write the FA-1 H2 files into frozen/, each file with its own writer, none
used before for FA-1: Ruby's standard csv library (render.rb), jq's @csv
(render.jq), a mawk program with a byte-order mark (render.awk), and a Rust
writer on the standard library alone that leaves no line end after the last
record (render.rs). A story's byte patch, if any, replaces the first
occurrence of its text in the written bytes of one file. Then each story's
<id>-input.json: the three file names, the confirmed readings and the scope.

  python3 -B audit/fixed-assets-sections-holdout-h2/stories.py > frozen/stories.json
  python3 -B audit/fixed-assets-sections-holdout-h2/render.py frozen

Needs Ruby 3.3, jq 1.7, mawk and rustc.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
FAMILY = "fixed-assets-sections-1"
ROLES = ["register-sections", "category-map", "gl-balances"]


def readings():
    return [{"sheet": 0, "role": role, "family": FAMILY, "confirmed": True} for role in ROLES]


def write(writer, cells, path, tmp, rust):
    rows = tmp / "rows.json"
    rows.write_text(json.dumps(cells, ensure_ascii=False), encoding="utf-8")
    if writer == "ruby":
        subprocess.run(["ruby", str(HERE / "render.rb"), str(rows), str(path)], check=True)
    elif writer == "jq":
        out = subprocess.run(["jq", "-r", "-f", str(HERE / "render.jq"), str(rows)], check=True,
                             capture_output=True).stdout
        path.write_bytes(out)
    elif writer == "awk":
        framed = tmp / "rows.awk"
        framed.write_bytes(b"\x1e".join(b"\x1f".join(v.encode("utf-8") for v in row) for row in cells))
        out = subprocess.run(["awk", "-f", str(HERE / "render.awk"), str(framed)], check=True, capture_output=True,
                             env={"LC_ALL": "C", "PATH": "/usr/bin:/bin"}).stdout
        path.write_bytes(out)
    elif writer == "rust":
        framed = tmp / "rows.hex"
        framed.write_text("".join(" ".join(v.encode("utf-8").hex() for v in row) + "\n" for row in cells),
                          encoding="ascii")
        subprocess.run([str(rust), str(framed), str(path)], check=True)
    else:
        raise SystemExit(f"unknown writer {writer}")


def main(folder):
    folder = Path(folder).resolve()
    facts = json.loads((folder / "stories.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        rust = tmp / "render-rs"
        subprocess.run(["rustc", "-O", "-o", str(rust), str(HERE / "render.rs")], check=True)
        for s in facts["stories"]:
            for side, (name, writer) in enumerate(zip(s["names"], s["writers"])):
                write(writer, s["cells"][side], folder / name, tmp, rust)
    for s in facts["stories"]:
        for side, old, new in s["patch"]:
            path = folder / s["names"][side]
            raw = path.read_bytes()
            if old.encode() not in raw:
                raise SystemExit(f"{s['id']}: the patch text is not in {path.name}")
            path.write_bytes(raw.replace(old.encode(), new.encode(), 1))
        given = {"names": s["names"], "readings": readings(), "scope": s["scope"]}
        (folder / f"{s['id']}-input.json").write_text(json.dumps(given, ensure_ascii=False, indent=1) + "\n",
                                                      encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
