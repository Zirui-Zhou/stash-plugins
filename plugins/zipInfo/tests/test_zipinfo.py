"""Tests for zipInfo.py — reading an archive, and turning a scan into a report.

The fixtures are built with `zipfile` rather than shelling out to `zip`, so the
tests need nothing installed and can state the compression method per entry:
that is the whole of what the plugin reports on, and one archive holding a stored
entry and a deflated one is the case it exists to find.
"""

import json
import subprocess
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN))

import zipInfo  # noqa: E402 - the plugin has to be on the path first


def make_zip(path, methods):
    """A zip at `path` with one entry per method in `methods`."""
    with zipfile.ZipFile(path, "w") as archive:
        for index, method in enumerate(methods):
            # Contents that compress, so a deflated entry is visibly smaller.
            body = ("image %d " % index).encode() * 500
            info = zipfile.ZipInfo("image-%03d.jpg" % index)
            info.compress_type = method
            archive.writestr(info, body)
    return str(path)


class DescribeTest(unittest.TestCase):
    """What the plugin says about one archive's table of contents."""

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)

    def path(self, name):
        return str(Path(self.dir.name) / name)

    def test_stored(self):
        described = zipInfo.describe(make_zip(self.path("a.zip"), [zipfile.ZIP_STORED] * 3))
        self.assertEqual(described["kind"], "stored")
        self.assertEqual(described["entries"], 3)
        self.assertEqual(described["methods"], {"stored": 3})
        self.assertEqual(
            described["deflated_bytes"],
            0,
            "nothing in a stored archive has to be decompressed to be read",
        )

    def test_deflated(self):
        described = zipInfo.describe(make_zip(self.path("a.zip"), [zipfile.ZIP_DEFLATED] * 3))
        self.assertEqual(described["kind"], "deflated")
        self.assertEqual(described["deflated_bytes"], described["raw_bytes"])
        self.assertLess(
            described["packed_bytes"],
            described["raw_bytes"],
            "the fixture has to actually compress, or packed_bytes proves nothing",
        )

    def test_mixed_counts_each_method(self):
        described = zipInfo.describe(
            make_zip(
                self.path("a.zip"),
                [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED, zipfile.ZIP_DEFLATED],
            )
        )
        self.assertEqual(described["kind"], "mixed")
        self.assertEqual(described["methods"], {"stored": 1, "deflated": 2})

    def test_an_unreadable_archive_is_reported_not_raised(self):
        # The first run against a real library is expected to hit this: a path the
        # database holds that the plugin cannot open. It has to come back as data
        # about that archive, or one bad file ends a scan of the whole library.
        described = zipInfo.describe(self.path("missing.zip"))
        self.assertIn("error", described)
        self.assertEqual(described["path"], self.path("missing.zip"))

    def test_a_directory_that_is_not_a_zip(self):
        path = self.path("not-a-zip.zip")
        Path(path).write_bytes(b"not an archive")
        self.assertIn("error", zipInfo.describe(path))


class WalkTest(unittest.TestCase):
    """Walking the library: the part a bug would hide behind.

    A walk that stops early reports a clean library that it never finished
    reading, which is the one result nobody would question.
    """

    class Stub:
        """A Stash that answers with the pages it was given."""

        def __init__(self, pages):
            self.pages = pages
            self.asked = []

        def query(self, query, variables):
            self.asked.append(variables["page"])
            return {
                "findGalleries": {
                    "count": self.count,
                    "galleries": self.pages[variables["page"] - 1],
                }
            }

    def setUp(self):
        # Progress goes to stderr, which unittest does not capture: without this
        # the walk's own progress lines land in the middle of the test output.
        original = zipInfo.progress
        zipInfo.progress = lambda fraction: None
        self.addCleanup(setattr, zipInfo, "progress", original)

    def walk(self, pages, count):
        stash = self.Stub(pages)
        stash.count = count
        return zipInfo.galleries_from_stash(stash), stash

    def test_a_folder_backed_gallery_contributes_nothing(self):
        # Two galleries, one archive between them: the count is galleries, the
        # result is archives, and stopping on the count would never stop here.
        found, stash = self.walk(
            [[{"id": "1", "title": "a", "files": [{"path": "/a.zip", "size": 1}]},
              {"id": "2", "title": "b", "files": []}]],
            2,
        )
        self.assertEqual([item["path"] for item in found], ["/a.zip"])
        self.assertEqual(stash.asked, [1], "one short page is the whole library")

    def test_every_page_is_read(self):
        full = [
            {"id": str(i), "title": str(i), "files": [{"path": "/%d.zip" % i, "size": i}]}
            for i in range(zipInfo.PAGE_SIZE)
        ]
        found, stash = self.walk([full, [{"id": "last", "title": "last", "files": [{"path": "/last.zip", "size": 1}]}]], 201)
        self.assertEqual(len(found), zipInfo.PAGE_SIZE + 1)
        self.assertEqual(stash.asked, [1, 2])
        self.assertEqual(found[0]["size"], 0)
        self.assertEqual(found[-1]["title"], "last")


class SummaryTest(unittest.TestCase):
    """What the plugin says about a whole scan."""

    def test_worst_first_and_counted(self):
        report = zipInfo.summarise(
            [
                {"path": "quiet.zip", "kind": "stored", "entries": 1, "deflated_bytes": 0},
                {"path": "loud.zip", "kind": "deflated", "entries": 2, "deflated_bytes": 900},
                {"path": "broken.zip", "error": "OSError: no such file"},
            ],
            "test",
        )
        self.assertEqual(report["scanned"], {"archives": 3, "readable": 2, "failed": 1})
        self.assertEqual(report["kinds"], {"stored": 1, "deflated": 1})
        self.assertEqual(report["deflated_bytes"], 900)
        self.assertEqual(
            [item["path"] for item in report["worst"]],
            ["loud.zip", "quiet.zip"],
            "the archive to rebuild first has to come first",
        )
        self.assertEqual(report["failures"][0]["path"], "broken.zip")

    def test_archives_under_is_recursive_and_sorted(self):
        with tempfile.TemporaryDirectory() as root:
            (Path(root) / "b").mkdir()
            for name in ("a.zip", "b/c.zip", "b/notes.txt"):
                (Path(root) / name).write_bytes(b"x")
            found = [Path(p).relative_to(root).as_posix() for p in zipInfo.archives_under(root)]
        self.assertEqual(found, ["a.zip", "b/c.zip"])


class TaskTest(unittest.TestCase):
    """The interface Stash uses: JSON in on stdin, one JSON object out on stdout.

    Run as a subprocess because that interface *is* the plumbing: the plugin is
    started as a program, and getting stdout wrong would show up as a task that
    reports nothing rather than as a failure in a function.
    """

    def run_plugin(self, stdin):
        return subprocess.run(
            [sys.executable, str(PLUGIN / "zipInfo.py")],
            input=json.dumps(stdin),
            capture_output=True,
            text=True,
            timeout=60,
        )

    def test_a_failed_connection_comes_back_as_an_error_result(self):
        result = self.run_plugin(
            {"args": {"mode": "report"}, "server_connection": {"Scheme": "http", "Port": 1}}
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("error", payload)
        self.assertEqual(len(result.stdout.strip().splitlines()), 1, "stdout carries the result and nothing else")

    def test_logs_go_to_stderr_with_the_prefix_stash_expects(self):
        result = self.run_plugin({"args": {}, "server_connection": {"Scheme": "http", "Port": 1}})
        self.assertTrue(result.stderr.startswith("\x01"), repr(result.stderr[:40]))


if __name__ == "__main__":
    unittest.main()
