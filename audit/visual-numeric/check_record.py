"""Independent bounded Arabic crop receipt check; no JS application imports.
Uses the prior independent stdlib PNG decoder, without changing frozen evidence.
Proves pixel/value binding and a known manual literal, not OCR or accounting.
"""
import importlib.util
import json
import re
import sys
from functools import lru_cache
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("png_receipt", ROOT / "audit/visual-cell-review/check_record.py")
png = importlib.util.module_from_spec(spec)
spec.loader.exec_module(png)
pixels = lru_cache(maxsize=4)(png.pixels)

def check(record, original):
    assert set(record) == {"kind", "version", "status", "source", "draft", "pixelSha256", "revision", "cells", "regions"}
    assert record["kind"] == "visual-review" and record["version"] == 2 and record["status"] == "cell-evidence-only"
    contract = json.loads((ROOT / "audit/visual-numeric/fixtures/contract.json").read_text())
    target = next(c for c in contract["cells"] if c["id"] == "arabic-minus")
    assert png.sha(original) == contract["source"]["sha256"]
    source, draft = record["source"], record["draft"]
    assert set(source) == {"name", "sha256", "originalPng"}
    assert png.png_bytes(source["originalPng"]) == original and source["sha256"] == png.sha(original)
    assert draft["source"] == {"name": source["name"], "sha256": source["sha256"]}
    assert draft["kind"] == "visual-draft" and draft["status"] == "unverified" and draft["version"] == draft["pageCount"] == len(draft["pages"]) == 1
    assert draft["engine"] == png.ENGINE and record["cells"] == []
    page = draft["pages"][0]
    a, b = pixels(original), pixels(png.png_bytes(page["imageDataUrl"]))
    assert a == b == (page["width"], page["height"], record["pixelSha256"])
    assert record["revision"] == png.fingerprint(["tarasuf-visual-review-v1", source["sha256"], a[2], draft["engine"], page["words"]])
    assert len(record["regions"]) == 1
    cell = record["regions"][0]
    assert set(cell) == {"id", "origin", "role", "observed", "value", "region", "review"}
    assert re.fullmatch(r"region:[1-9]\d{0,5}", cell["id"]) and cell["origin"] == "manual-crop"
    assert cell["role"] == "amount" and cell["value"] == target["expected"]
    region = cell["region"]
    assert list(region) == ["x0", "y0", "x1", "y1"] and all(type(v) is int for v in region.values())
    assert 0 <= region["x0"] < region["x1"] <= page["width"] and 0 <= region["y0"] < region["y1"] <= page["height"]
    # The chosen crop must cover the whole independently specified value area,
    # with <=2px pointer rounding. It must exclude the neighboring balance.
    t = target["rectangle"]
    assert abs(region["x0"] - t["left"]) <= 2 and abs(region["y0"] - t["top"]) <= 2
    assert t["left"] + t["width"] - 2 <= region["x1"] < 1200
    assert abs(region["y1"] - t["top"] - t["height"]) <= 2
    observed = []
    for word in page["words"]:
        b = word["bbox"]
        if b["x0"] < region["x1"] and b["x1"] > region["x0"] and b["y0"] < region["y1"] and b["y1"] > region["y0"]:
            observed.append({"wordId": word["id"], "text": word["text"], "complete": b["x0"] >= region["x0"] and b["y0"] >= region["y0"] and b["x1"] <= region["x1"] and b["y1"] <= region["y1"]})
    assert cell["observed"] == observed
    proof = cell["review"]
    assert set(proof) == {"revision", "fingerprint", "checkedAt"} and proof["revision"] == record["revision"]
    assert proof["fingerprint"] == png.fingerprint(["tarasuf-visual-region-v1", record["revision"], cell["id"], cell["origin"], cell["role"], observed, cell["value"], region])
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", proof["checkedAt"])
    datetime.strptime(proof["checkedAt"], "%Y-%m-%dT%H:%M:%S.%fZ")
    return {"status": "pass", "manualRegions": 1, "arabicLiteral": cell["value"], "pixelIdentity": True, "financialPromotion": False}

if __name__ == "__main__":
    print(json.dumps(check(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]).read_bytes()), ensure_ascii=False))
