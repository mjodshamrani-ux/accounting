"""Independent known table oracle. Python stdlib only, no application imports.
Checks human crop/row receipts, not automatic OCR accuracy or general layout fit.
"""
import importlib.util
import json
import re
import sys
from datetime import datetime
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("png_oracle", ROOT / "audit/visual-cell-review/check_record.py")
png = importlib.util.module_from_spec(spec)
spec.loader.exec_module(png)
pixels = lru_cache(maxsize=4)(png.pixels)

def stamp(value):
    assert isinstance(value, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", value)
    datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")

def check(record, original):
    contract = json.loads((Path(__file__).parent / "fixtures/contract.json").read_text())
    assert png.sha(original) == contract["source"]["sha256"]
    assert set(record) == {"kind", "version", "status", "image", "revision", "grid", "rows", "coverage"}
    assert record["kind"] == "visual-table" and record["version"] == 1 and record["status"] == "table-evidence-only"
    image = record["image"]
    assert set(image) == {"kind", "version", "status", "source", "draft", "pixelSha256", "revision", "cells", "regions"}
    assert image["kind"] == "visual-review" and image["version"] == 2 and image["status"] == "cell-evidence-only"
    source = image["source"]
    assert set(source) == {"name", "sha256", "originalPng"}
    assert png.png_bytes(source["originalPng"]) == original and source["sha256"] == png.sha(original)
    draft = image["draft"]
    assert set(draft) == {"kind", "version", "status", "source", "engine", "pageCount", "pages"}
    assert draft["source"] == {"name": source["name"], "sha256": source["sha256"]}
    assert draft["kind"] == "visual-draft" and draft["version"] == draft["pageCount"] == len(draft["pages"]) == 1
    assert draft["status"] == "unverified" and draft["engine"] == png.ENGINE and image["cells"] == []
    page = draft["pages"][0]
    assert set(page) == {"page", "width", "height", "imageDataUrl", "words"} and page["page"] == 1
    assert pixels(original) == pixels(png.png_bytes(page["imageDataUrl"])) == (1200, 760, image["pixelSha256"])
    for i, word in enumerate(page["words"]):
        assert set(word) == {"id", "text", "confidence", "bbox"}
        box = word["bbox"]
        assert set(box) == {"x0", "y0", "x1", "y1"}
        assert 0 <= box["x0"] < box["x1"] <= 1200 and 0 <= box["y0"] < box["y1"] <= 760
        assert word["id"] == "p1:w%d:%s,%s,%s,%s" % (i + 1, box["x0"], box["y0"], box["x1"], box["y1"])
        assert isinstance(word["text"], str) and len(word["text"]) <= 4096
    assert image["revision"] == png.fingerprint(["tarasuf-visual-review-v1", source["sha256"], image["pixelSha256"], draft["engine"], page["words"]])
    assert len(image["regions"]) == 4
    for i, cell in enumerate(image["regions"]):
        expected = contract["rows"][0]
        assert set(cell) == {"id", "origin", "role", "observed", "value", "region", "review"}
        assert cell["id"] == "region:%d" % (i + 1) and cell["origin"] == "manual-crop"
        assert cell["value"] == expected["expected"][i] and cell["role"] == expected["crops"][i]["role"]
        region = cell["region"]
        assert set(region) == {"x0", "y0", "x1", "y1"} and all(type(v) is int for v in region.values())
        for k, v in expected["crops"][i]["region"].items():
            assert abs(region[k] - v) <= 2, (k, region[k], v)
        observed = []
        for word in page["words"]:
            b = word["bbox"]
            if b["x0"] < region["x1"] and b["x1"] > region["x0"] and b["y0"] < region["y1"] and b["y1"] > region["y0"]:
                observed.append({"wordId": word["id"], "text": word["text"], "complete": b["x0"] >= region["x0"] and b["y0"] >= region["y0"] and b["x1"] <= region["x1"] and b["y1"] <= region["y1"]})
        assert cell["observed"] == observed
        proof = cell["review"]
        assert set(proof) == {"revision", "fingerprint", "checkedAt"} and proof["revision"] == image["revision"]
        stamp(proof["checkedAt"])
        assert proof["fingerprint"] == png.fingerprint(["tarasuf-visual-region-v1", image["revision"], cell["id"], cell["origin"], cell["role"], observed, cell["value"], region])
    grid = record["grid"]
    assert set(grid) == {"region", "rowCuts", "columnCuts", "roles"} and grid["roles"] == contract["grid"]["roles"]
    for k, v in contract["grid"]["region"].items():
        assert type(grid["region"][k]) is int and abs(grid["region"][k] - v) <= 2
    assert grid["rowCuts"] == [grid["region"]["y0"], 340, 460, grid["region"]["y1"]]
    assert grid["columnCuts"] == [grid["region"]["x0"], 350, 620, 850, grid["region"]["x1"]]
    assert record["revision"] == png.fingerprint(["tarasuf-visual-table-v1", image, grid])
    assert len(record["rows"]) == 3
    for i, row in enumerate(record["rows"]):
        assert set(row) == {"id", "disposition", "note", "cells", "review"}
        expected = contract["rows"][i]
        assert row["id"] == expected["id"] and row["disposition"] == expected["disposition"]
        if i == 0:
            assert row["cells"] == ["region:1", "region:2", "region:3", "region:4"] and row["note"] == "" and row["review"] is None
        else:
            assert row["cells"] == [None] * 4 and row["note"] == expected["note"]
        if i == 1:
            assert row["review"] is None  # Unreadable is never an approved exclusion.
        if i == 2:
            proof = row["review"]
            assert set(proof) == {"fingerprint", "checkedAt"}
            stamp(proof["checkedAt"])
            assert proof["fingerprint"] == png.fingerprint(["tarasuf-table-exclusion-v1", record["revision"], row["id"], row["disposition"], row["note"], row["cells"]])
    coverage = record["coverage"]
    assert set(coverage) == {"fingerprint", "checkedAt"}
    stamp(coverage["checkedAt"])
    assert coverage["fingerprint"] == png.fingerprint(["tarasuf-table-coverage-v1", record["revision"], record["rows"]])
    return {"status": "pass", "rows": 3, "manualValues": 4, "unreadableRows": 1, "reviewedExclusions": 1, "financialPromotion": False}

if __name__ == "__main__":
    print(json.dumps(check(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]).read_bytes())))
