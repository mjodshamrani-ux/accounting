#!/usr/bin/env python3
"""Compare every uncompressed member of two XLSX/ZIP packages.

ZIP compression and container metadata may differ. Member names and bytes may not.
This checks package identity, not whether either workbook is financially correct.
"""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import sys
import zipfile
import zlib


CHUNK_SIZE = 1024 * 1024


def inspect_package(path):
    """Return member digests after reading each member through ZIP's CRC check."""
    with zipfile.ZipFile(path) as package:
        infos = package.infolist()
        counts = Counter(info.filename for info in infos)
        duplicates = sorted(name for name, count in counts.items() if count > 1)
        if duplicates:
            return {}, duplicates

        digests = {}
        for info in infos:
            if info.is_dir():
                continue
            digest = hashlib.sha256()
            with package.open(info) as member:
                while chunk := member.read(CHUNK_SIZE):
                    digest.update(chunk)
            # Reading to EOF also verifies the member's CRC in zipfile.
            digests[info.filename] = digest.hexdigest()
        return digests, []


def compare(baseline, candidate):
    result = {
        "identical": False,
        "baseline": str(baseline),
        "candidate": str(candidate),
        "missingFromCandidate": [],
        "extraInCandidate": [],
        "changed": [],
        "duplicateNames": {"baseline": [], "candidate": []},
        "errors": [],
    }
    packages = {}
    for label, path in (("baseline", baseline), ("candidate", candidate)):
        try:
            packages[label], result["duplicateNames"][label] = inspect_package(path)
        except (OSError, RuntimeError, ValueError, zipfile.BadZipFile, zlib.error) as exc:
            result["errors"].append({"archive": label, "message": str(exc)})

    if result["errors"] or any(result["duplicateNames"].values()):
        return result

    before, after = packages["baseline"], packages["candidate"]
    result["missingFromCandidate"] = sorted(before.keys() - after.keys())
    result["extraInCandidate"] = sorted(after.keys() - before.keys())
    result["changed"] = sorted(
        name for name in before.keys() & after.keys() if before[name] != after[name]
    )
    result["identical"] = not any(
        result[key]
        for key in ("missingFromCandidate", "extraInCandidate", "changed")
    )
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("baseline", type=Path, help="Original XLSX package")
    parser.add_argument("candidate", type=Path, help="Recompressed XLSX package")
    args = parser.parse_args(argv)
    result = compare(args.baseline, args.candidate)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0 if result["identical"] else 1


if __name__ == "__main__":
    sys.exit(main())
