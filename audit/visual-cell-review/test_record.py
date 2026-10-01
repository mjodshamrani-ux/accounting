import copy
import json
import unittest
from pathlib import Path
from check_record import check

ROOT = Path(__file__).parent / "fixtures"
class IndependentReviewTests(unittest.TestCase):
    def setUp(self):
        self.record = json.loads((ROOT / "record.json").read_text())
        self.original = (ROOT / "source.png").read_bytes()
    def test_valid_known_literals_and_pixels(self):
        self.assertFalse(check(self.record, self.original)["financialPromotion"])
    def test_corruptions_cannot_pass_the_independent_checker(self):
        for target, key, value in [
            ("cell", "value", "250.00"), ("cell", "role", "reference"),
            ("cell", "observed", "250.00"), ("proof", "fingerprint", "0" * 64),
            ("proof", "revision", "0" * 64), ("record", "pixelSha256", "0" * 64),
            ("record", "status", "verified"), ("record", "revision", "0" * 64),
        ]:
            with self.subTest(target=target, key=key):
                changed = copy.deepcopy(self.record)
                item = changed if target == "record" else next(c for c in changed["cells"] if c["role"] == "amount")
                if target == "proof": item = item["review"]
                item[key] = value
                with self.assertRaises(AssertionError): check(changed, self.original)
    def test_source_bytes_crc_and_crop_damage(self):
        original = bytearray(self.original); original[-1] ^= 1
        with self.assertRaises(AssertionError): check(self.record, original)
        changed = copy.deepcopy(self.record); changed["cells"][0]["region"]["x0"] = 79
        with self.assertRaises(AssertionError): check(changed, self.original)
        changed = copy.deepcopy(self.record); changed["cells"].append(changed["cells"][0])
        with self.assertRaises(AssertionError): check(changed, self.original)
if __name__ == "__main__": unittest.main()
