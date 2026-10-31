"""obfuscate()/load_json() round-trip, and that load_json still reads plain JSON (the dev path)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import secret


class Secret(unittest.TestCase):
    sample = {"cities": {"Paris": {"lat": 48.8566, "lon": 2.3522}}, "n": [1, 2, 3]}

    def test_roundtrip(self):
        raw = json.dumps(self.sample).encode()
        blob = secret.obfuscate(raw)
        self.assertTrue(blob.startswith(b"WPX1"))
        self.assertNotIn(b"Paris", blob)          # actually obfuscated
        self.assertEqual(secret.loads(blob), self.sample)

    def test_load_json_reads_both(self):
        with tempfile.TemporaryDirectory() as d:
            plain = os.path.join(d, "plain.json")
            with open(plain, "w") as f:
                json.dump(self.sample, f)
            self.assertEqual(secret.load_json(plain), self.sample)

            blob = os.path.join(d, "blob.json")
            with open(blob, "wb") as f:
                f.write(secret.obfuscate(json.dumps(self.sample).encode()))
            self.assertEqual(secret.load_json(blob), self.sample)


if __name__ == "__main__":
    unittest.main()
