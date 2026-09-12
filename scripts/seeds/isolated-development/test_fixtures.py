"""Offline checks for the seed's graph, revision order and evidence boundaries."""
import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
LINK = re.compile(r"context-use://(entity|page|asset|record)/([a-z0-9-]+)")


def read_json(path):
    return json.loads((ROOT / path).read_text())


class HistoricalSeedTests(unittest.TestCase):
    def test_snapshots_only_reference_existing_resources(self):
        entities = {p.stem for p in (ROOT / "entities").glob("*.json")}
        assets = {a["readableId"] for a in read_json("assets/index.json")}
        records = {r["id"] for r in read_json("records/index.json")}
        existing = {"entity": entities, "asset": assets, "record": records, "page": set()}
        snapshots = read_json("pages/index.json")
        previous_date = ""
        used_paths = set()
        for snapshot in snapshots:
            with self.subTest(path=snapshot["path"]):
                self.assertGreaterEqual(snapshot["asOf"], previous_date)
                previous_date = snapshot["asOf"]
                self.assertNotIn(snapshot["path"], used_paths)
                used_paths.add(snapshot["path"])
                markdown = (ROOT / snapshot["path"]).read_text()
                self.assertTrue(markdown.startswith("# "))
                self.assertEqual(len(re.findall(r"^# ", markdown, re.M)), 1)
                # The map opens at the owner; first-person prose alone cannot
                # connect these pages to that resource neighborhood.
                self.assertIn(("entity", "steve-jobs"), LINK.findall(markdown))
                for kind, target in LINK.findall(markdown):
                    self.assertIn(target, existing[kind])
                existing["page"].add(snapshot["readableId"])
        actual_paths = {str(p.relative_to(ROOT)) for folder in ("pages", "revisions")
                        for p in (ROOT / folder).glob("*.md")}
        self.assertEqual(used_paths, actual_paths)

    def test_final_graph_reaches_every_resource(self):
        latest = {s["readableId"]: s for s in read_json("pages/index.json")}
        pending = ["my-work-from-ipod-to-iphone"]
        seen = set()
        reached = {"entity": set(), "asset": set(), "record": set()}
        while pending:
            current = pending.pop()
            if current in seen:
                continue
            seen.add(current)
            for kind, target in LINK.findall((ROOT / latest[current]["path"]).read_text()):
                if kind == "page":
                    pending.append(target)
                else:
                    reached[kind].add(target)
        self.assertEqual(seen, set(latest))
        self.assertEqual(reached["entity"], {p.stem for p in (ROOT / "entities").glob("*.json")})
        self.assertEqual(reached["asset"], {a["readableId"] for a in read_json("assets/index.json")})
        self.assertEqual(reached["record"], {r["id"] for r in read_json("records/index.json")})

    def test_invented_evidence_cannot_lose_its_label(self):
        synthetic_ids = set()
        for record in read_json("records/index.json"):
            content = record["content"]
            body = (ROOT / record["path"]).read_text()
            with self.subTest(record=record["id"]):
                if record["provider"] == "synthetic-workspace":
                    synthetic_ids.add(record["id"])
                    self.assertEqual(content["attributes"]["evidence"], "synthetic")
                    self.assertTrue(content["title"].startswith("[Synthetic]"))
                    self.assertIn("Invented for this historical demo", body)
                    self.assertNotIn("sourceUrl", content)
                else:
                    self.assertEqual(content["attributes"]["evidence"], "documented")
                    self.assertTrue(content["sourceUrl"].startswith("https://"))
                    self.assertIn(content["sourceUrl"], body)
        for snapshot in read_json("pages/index.json"):
            markdown = (ROOT / snapshot["path"]).read_text()
            if any(kind == "record" and target in synthetic_ids
                   for kind, target in LINK.findall(markdown)):
                self.assertIn("**Synthetic scenario", markdown)

    def test_asset_bytes_and_provenance_are_bundled(self):
        for asset in read_json("assets/index.json"):
            with self.subTest(asset=asset["readableId"]):
                data = (ROOT / asset["path"]).read_bytes()
                self.assertTrue(data)
                if asset.get("expectedMediaType") == "image/jpeg":
                    self.assertTrue(data.startswith(b"\xff\xd8\xff"))
                elif asset.get("expectedMediaType") == "image/png":
                    self.assertTrue(data.startswith(b"\x89PNG\r\n\x1a\n"))
                if asset.get("expectedMediaType", "").startswith("image/"):
                    for field in ("sourceUrl", "credit", "license", "licenseUrl", "dateNote"):
                        self.assertTrue(asset[field])


if __name__ == "__main__":
    unittest.main()
