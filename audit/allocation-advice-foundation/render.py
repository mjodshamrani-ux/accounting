"""Write the ALL-1 stories' snapshots and their sessions.

    python3 -B render.py frozen            # focused stories F01-F33, every writer
    python3 -B render.py --dense DIR       # dense stories D1-D3, Python writers only

Each story gets three files (payments, invoices, advice) and <id>-input.json:
the file names, the confirmed readings and scope, and the accountant's
decisions as allocation-snapshot-1 events, which name items and advice lines
by the hash of the file and the row, so they are written after the files.

Writers: py-min (minimal quoting, LF), py-min-crlf (minimal quoting, CRLF),
py-all-bom (every field quoted, CRLF, byte order mark) and exceljs
(render.mjs: XLSX sheets of text cells, with the story's hidden rows,
through the ExcelJS the application already depends on).
"""
import csv
import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import stories as model  # noqa: E402

FAMILY = "allocation-snapshot-1"


def write(rows, writer):
    buf = io.StringIO(newline="")
    if writer == "py-min":
        w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    elif writer == "py-min-crlf":
        w = csv.writer(buf, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
    elif writer == "py-all-bom":
        w = csv.writer(buf, quoting=csv.QUOTE_ALL, lineterminator="\r\n")
    else:
        raise ValueError(writer)
    w.writerows(rows)
    data = buf.getvalue().encode("utf-8")
    return b"\xef\xbb\xbf" + data if writer == "py-all-bom" else data


def readings():
    return [{"sheet": 0, "role": role, "family": FAMILY, "confirmed": True} for role in model.ROLES]


def context(hashes, scope):
    fields = ["entity", "ledger", "party", "account", "currency", "cutoff", "basis"]
    return json.dumps([FAMILY, hashes, [[r["sheet"], r["role"], r["family"], r["confirmed"]] for r in readings()],
                       [scope[k] for k in fields], scope["confirmed"]], ensure_ascii=False, separators=(",", ":"))


def events(s, hashes):
    ctx = context(hashes, s["scope"])
    item = [lambda ref, side=side: f"{side}:{hashes[side]}:0:{s['itemRows'][side][ref]}" for side in (0, 1)]
    out = []
    for n, d in enumerate(s["decisions"], start=1):
        base = {"id": d["id"], "context": ctx, "at": f"2026-10-01T09:{n // 60:02d}:{n % 60:02d}.000Z",
                "note": f"Synthetic decision {d['id']}"}
        if d["type"] == "undo":
            out.append({**base, "type": "undo", "target": d["target"]})
            continue
        links = []
        if d["type"] == "remittance":
            for x in d["lines"]:
                row = s["lineRows"][x]
                cells = dict(zip(s["cells"][2][0], s["cells"][2][row - 1]))
                links.append({"paymentId": item[0](cells["Payment ID"]), "invoiceId": item[1](cells["Invoice ID"]),
                              "amount": s["adviceMinor"][x],
                              "basis": {"kind": "remittance", "reference": x, "reason": "Remittance advice reviewed",
                                        "proofId": f"2:{hashes[2]}:0:{row}"}})
        else:
            for p, i, m in d["links"]:
                links.append({"paymentId": item[0](p), "invoiceId": item[1](i), "amount": m,
                              "basis": {"kind": d["kind"], "reference": f"CONF-{d['id']}",
                                        "reason": "Confirmed by the supplier", "proofId": ""}})
        out.append({**base, "type": "allocate", "links": links})
    return out


def emit(stories, out, python_only):
    out.mkdir(parents=True, exist_ok=True)
    pending = []
    for s in stories:
        for side, name in enumerate(s["names"]):
            if s["writer"] == "exceljs":
                if python_only:
                    raise ValueError("dense stories use Python writers only")
                pending.append({"path": str(out / name), "rows": s["cells"][side], "hidden": s["hidden"][side]})
            else:
                (out / name).write_bytes(write(s["cells"][side], s["writer"]))
    if pending:
        subprocess.run(["node", str(HERE / "render.mjs")], input=json.dumps(pending).encode("utf-8"), check=True)
    for s in stories:
        hashes = [hashlib.sha256((out / name).read_bytes()).hexdigest() for name in s["names"]]
        given = {"names": s["names"], "readings": readings(), "scope": s["scope"], "events": events(s, hashes)}
        (out / f"{s['id']}-input.json").write_text(json.dumps(given, ensure_ascii=False, indent=1) + "\n",
                                                   encoding="utf-8")


def main(argv):
    if argv[:1] == ["--dense"]:
        emit([s.to_json() for s in model.dense()], Path(argv[1]), True)
    else:
        emit([s.to_json() for s in model.focused()], Path(argv[0]), False)


if __name__ == "__main__":
    main(sys.argv[1:])
