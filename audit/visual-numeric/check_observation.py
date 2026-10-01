"""Recompute the failed native OCR experiment's metrics from raw output.
This verifies the evidence, not OCR success, provenance authentication or training.
"""
import gzip
import json
import re
import sys
from pathlib import Path
from check_record import ROOT, png

def display(text):
    return re.sub(r"[\s\u200e\u200f\u202a-\u202e\u2066-\u2069]", "", text)

def check(report):
    contract = json.loads((ROOT / "audit/visual-numeric/fixtures/contract.json").read_text())
    original = (ROOT / "audit/visual-numeric/fixtures/amounts.png").read_bytes()
    assert png.sha(original) == contract["source"]["sha256"] == report["sourceSha256"]
    assert report["financialPromotion"] is False and report["assetHashes"] == {k: v for k, v in png.ENGINE["assetHashes"].items() if k.endswith(".js")}
    assert all(r["method"] == "GET" and re.fullmatch(r"\$LOCAL/(?:ocr/(?:worker|worker-vendor|tesseract-core-lstm.wasm)\.js)?", r["url"]) for r in report["requests"])
    native = report["observation"]
    profiles = ["whole-page-default", "region-line-7", "region-raw-line-13", "region-line-7-whitelist"]
    assert native[0]["profile"] == profiles[0] and "cell" not in native[0] and len(native) == 49
    words = [w for b in native[0]["raw"]["blocks"] for p in b["paragraphs"] for line in p["lines"] for w in line["words"]]
    comparisons = []
    for cell in contract["cells"]:
        r = cell["rectangle"]
        inside = [w for w in words if w["bbox"]["x0"] >= r["left"] and w["bbox"]["x1"] <= r["left"] + r["width"] and w["bbox"]["y0"] >= r["top"] and w["bbox"]["y1"] <= r["top"] + r["height"]]
        whole = " ".join(w["text"] for w in sorted(inside, key=lambda w: w["bbox"]["x0"]))
        observations = [(profiles[0], whole)]
        for profile in profiles[1:]:
            matches = [o for o in native if o["profile"] == profile and o.get("cell") == cell["id"]]
            assert len(matches) == 1
            observations.append((profile, matches[0]["raw"]["text"]))
        for profile, observed in observations:
            comparisons.append({"cell": cell["id"], "kind": cell["kind"], "expected": cell["expected"], "profile": profile, "observed": observed, "exactDisplay": display(observed) == display(cell["expected"])})
    assert comparisons == report["comparisons"]
    summary = []
    for profile in profiles:
        rows = [r for r in comparisons if r["profile"] == profile]
        summary.append({"profile": profile, "amountExact": sum(r["kind"] == "amount" and r["exactDisplay"] for r in rows), "amounts": sum(r["kind"] == "amount" for r in rows), "controlExact": sum(r["kind"] == "non-amount" and r["exactDisplay"] for r in rows), "controls": sum(r["kind"] == "non-amount" for r in rows)})
    assert summary == report["summary"]
    return {"status": "evidence-consistent", "financialPromotion": False, "summary": summary}

if __name__ == "__main__":
    report = json.loads(gzip.decompress((ROOT / "audit/visual-numeric/baseline/report.json.gz").read_bytes()))
    print(json.dumps(check(report), ensure_ascii=False))
