"""Independent receipt check, using Python stdlib only; no app imports.
Pixel identity and review binding do NOT prove OCR, row coverage or accounting.
The measured corpus uses integer crop coordinates and two known literal cells.
"""
import base64
import hashlib
import json
import re
import struct
import sys
import zlib
from datetime import datetime
from pathlib import Path

ENGINE = {
    "library": "tesseract.js", "version": "7.0.0", "languages": "eng+ara",
    "assetHashes": {
        "worker-vendor.js": "576b7df7e3393e137e51849357c9adb53fe7ac1bb69bfa06cf3d61520f182c6d",
        "tesseract-core-lstm.wasm.js": "eef5f8b2f8e20e150680b20adaec4a60babafee3adbe8a94583c81fee46e8680",
        "eng.traineddata.gz": "45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91",
        "ara.traineddata.gz": "f4746c44b02342dd5b3d4f0198000f47d7c49f1a229e63e0f436c0592dcd9639",
        "worker.js": "4faaf3bf0aabdd360f3a8a280f37050fa7307799d30cb9f4ab2dbd9807383f38",
    },
}
def sha(data):
    return hashlib.sha256(data).hexdigest()
def fingerprint(value):
    return sha(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode())
def png_bytes(url):
    assert url.startswith("data:image/png;base64,")
    encoded = url.split(",", 1)[1]
    out = base64.b64decode(encoded, validate=True)
    assert len(out) <= 2 * 1024 * 1024 and base64.b64encode(out).decode() == encoded
    return out
def pixels(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) <= 2 * 1024 * 1024
    offset, payload, width, height, channels, count = 8, bytearray(), None, None, None, 0
    ended = False
    while offset < len(data):
        count += 1
        assert count <= 5000 and offset + 12 <= len(data)
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + length + 12
        assert end <= len(data)
        kind, body = data[offset + 4:offset + 8], data[offset + 8:end - 4]
        assert zlib.crc32(kind + body) == struct.unpack_from(">I", data, end - 4)[0]
        if count == 1:
            assert kind == b"IHDR" and length == 13
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", body)
            assert 0 < width <= 4096 and 0 < height <= 4096 and width * height <= 8_000_000
            assert depth == 8 and color in (2, 6) and compression == filtering == interlace == 0
            channels = 3 if color == 2 else 4
        elif kind == b"IDAT":
            assert length > 0
            payload.extend(body)
        elif kind == b"IEND":
            assert not body and payload and end == len(data)
            ended = True
            break
        else:
            raise AssertionError("outside measured PNG family")
        offset = end
    assert ended
    stride, expected = width * channels, (width * channels + 1) * height
    inflater = zlib.decompressobj()
    scan = inflater.decompress(payload, expected + 1)
    assert len(scan) == expected and inflater.eof and not inflater.unused_data and not inflater.unconsumed_tail
    raw = bytearray(stride * height)
    for row in range(height):
        method = scan[row * (stride + 1)]
        assert method in range(5)
        for column in range(stride):
            i = row * stride + column
            a = raw[i - channels] if column >= channels else 0
            b = raw[i - stride] if row else 0
            c = raw[i - stride - channels] if row and column >= channels else 0
            p = a + b - c
            paeth = min((a, b, c), key=lambda item: abs(p - item))
            predicted = (0, a, b, (a + b) // 2, paeth)[method]
            raw[i] = (scan[row * (stride + 1) + column + 1] + predicted) % 256
    if channels == 4:
        assert all(raw[i] == 255 for i in range(3, len(raw), 4))
        rgba = raw
    else:
        rgba = bytearray()
        for i in range(0, len(raw), 3):
            rgba.extend(raw[i:i+3]); rgba.append(255)
    return width, height, sha(rgba)
def check(record, original):
    assert set(record) == {"kind", "version", "status", "source", "draft", "pixelSha256", "revision", "cells"}
    assert record["kind"] == "visual-review" and record["version"] == 1 and record["status"] == "cell-evidence-only"
    source, draft = record["source"], record["draft"]
    assert set(source) == {"name", "sha256", "originalPng"}
    assert png_bytes(source["originalPng"]) == original and source["sha256"] == sha(original)
    assert draft["source"] == {"name": source["name"], "sha256": source["sha256"]}
    assert draft["kind"] == "visual-draft" and draft["status"] == "unverified" and draft["version"] == draft["pageCount"] == len(draft["pages"]) == 1
    assert draft["engine"] == ENGINE
    page = draft["pages"][0]
    a, b = pixels(original), pixels(png_bytes(page["imageDataUrl"]))
    assert a == b == (page["width"], page["height"], record["pixelSha256"])
    assert record["revision"] == fingerprint(["tarasuf-visual-review-v1", source["sha256"], a[2], draft["engine"], page["words"]])
    words = {word["id"]: word for word in page["words"]}
    assert len(words) == len(page["words"]) and len(words) <= 20_000
    ids, observed = set(), {}
    assert len(record["cells"]) <= 1000
    for cell in record["cells"]:
        assert set(cell) == {"wordId", "role", "observed", "value", "region", "review"}
        assert cell["wordId"] in words and cell["wordId"] not in ids
        ids.add(cell["wordId"])
        word = words[cell["wordId"]]
        assert cell["observed"] == word["text"] and cell["role"] in ("amount", "date", "reference", "currency")
        assert 0 < len(cell["value"]) <= 512 and cell["value"].strip() and all(ord(c) >= 32 and ord(c) != 127 for c in cell["value"])
        region, bbox = cell["region"], word["bbox"]
        assert list(region) == ["x0", "y0", "x1", "y1"] and all(type(v) is int for v in region.values())
        assert 0 <= region["x0"] <= bbox["x0"] < bbox["x1"] <= region["x1"] <= page["width"]
        assert 0 <= region["y0"] <= bbox["y0"] < bbox["y1"] <= region["y1"] <= page["height"]
        proof = cell["review"]
        assert set(proof) == {"revision", "fingerprint", "checkedAt"} and proof["revision"] == record["revision"]
        assert proof["fingerprint"] == fingerprint([record["revision"], cell["wordId"], cell["role"], cell["observed"], cell["value"], region])
        assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", proof["checkedAt"])
        datetime.strptime(proof["checkedAt"], "%Y-%m-%dT%H:%M:%S.%fZ")
        assert cell["role"] not in observed
        observed[cell["role"]] = cell["value"]
    assert observed == {"reference": "INV-700", "amount": "-250.00"}
    return {"status": "pass", "cells": len(ids), "pixelIdentity": True, "financialPromotion": False}
if __name__ == "__main__":
    print(json.dumps(check(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]).read_bytes())))
