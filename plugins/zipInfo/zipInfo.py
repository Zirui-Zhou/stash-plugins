#!/usr/bin/env python3
"""Gallery ZIP Info — report how each gallery's ZIP archive is compressed.

Two ways in.

As a Stash plugin task: Stash starts this script with its plugin input on stdin
and reads one JSON object back from stdout (see `exec` and `interface: raw` in
zipInfo.yml). Neither is needed to debug it.

By hand, which is what the first run should be:

    python3 zipInfo.py --file /comics/example.zip
    python3 zipInfo.py --root /comics

Both read the archives directly and print a table. They answer the question the
plugin task cannot answer for you: whether the paths the database holds are
readable from inside the container, and what the archives under them look like.

Only the standard library. Stash's own image ships python3 and py3-requests, but
a rebuilt image need not, and nothing here needs more than zipfile and urllib.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import zipfile
from datetime import datetime, timezone

# The compression methods worth naming. The format allows others (bzip2, lzma,
# zstd); they are reported by their number rather than guessed at, since a name
# this script invented would be worse than the number the format itself uses.
METHOD_NAMES = {
    zipfile.ZIP_STORED: "stored",
    zipfile.ZIP_DEFLATED: "deflated",
    zipfile.ZIP_BZIP2: "bzip2",
    zipfile.ZIP_LZMA: "lzma",
}

# How many of the worst archives to keep in the report's short list. The full
# per-archive data is in the same file; this is the part to read first.
WORST_COUNT = 20


# ── Talking to Stash ───────────────────────────────────────────────────────


def log(level, message):
    """One log line, in the form Stash's raw plugin interface expects.

    Logs go to *stderr*, prefixed with SOH, a one-letter level and STX: t, d, i,
    w, e for trace..error, or p for progress. stdout carries the result and
    nothing else, which is why this cannot simply print.
    """
    print("\x01" + level + "\x02" + message, file=sys.stderr, flush=True)


def progress(fraction):
    log("p", str(min(max(fraction, 0.0), 1.0)))


class Stash:
    """The smallest GraphQL client that can walk the library.

    urllib rather than requests on purpose: `requests` is in Stash's image but
    not necessarily in a rebuilt one, and one POST does not need a library.
    """

    def __init__(self, connection):
        self.url = "{}://localhost:{}/graphql".format(
            connection["Scheme"], connection["Port"]
        )
        cookie = (connection.get("SessionCookie") or {}).get("Value")
        self.headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if cookie:
            self.headers["Cookie"] = "session=" + cookie

    def query(self, query, variables=None):
        body = json.dumps({"query": query, "variables": variables or {}}).encode()
        request = urllib.request.Request(self.url, data=body, headers=self.headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:
            raise RuntimeError(
                "GraphQL request failed: {} {}".format(error.code, error.reason)
            )
        if payload.get("errors"):
            raise RuntimeError("GraphQL error: " + json.dumps(payload["errors"]))
        return payload["data"]


# How many galleries to ask for at a time. The walk below stops when a page comes
# back with fewer than this, so the two have to agree.
PAGE_SIZE = 200

# One page of galleries with the files behind them. `folder` is not asked for:
# a folder-backed gallery has no archive, and the files list is what says so.
GALLERY_PAGE = """
query($page: Int!) {
  findGalleries(filter: { page: $page, per_page: %d, sort: "path", direction: ASC }) {
    count
    galleries {
      id
      title
      files {
        path
        size
      }
    }
  }
}
""" % PAGE_SIZE


def galleries_from_stash(stash):
    """Every archive behind every gallery, as {gallery_id, title, path, size}.

    Pages until a page comes back short. *Short* rather than until as many
    archives as `count` have been collected: `count` is galleries, and a
    folder-backed gallery contributes no archive at all — waiting for the two
    numbers to meet would page past the end of the library every time.
    """
    out = []
    page = 1
    while True:
        result = stash.query(GALLERY_PAGE, {"page": page})["findGalleries"]
        found = result["galleries"]
        for gallery in found:
            for file in gallery["files"]:
                out.append(
                    {
                        "gallery_id": gallery["id"],
                        "title": gallery["title"],
                        "path": file["path"],
                        "size": file["size"],
                    }
                )
        total = result["count"]
        progress(min(page * PAGE_SIZE / total, 1.0) if total else 1.0)
        if len(found) < PAGE_SIZE:
            return out
        page += 1


# ── Reading an archive ─────────────────────────────────────────────────────


def describe(path, recorded_size=None):
    """What an archive holds, without reading a single image out of it.

    The table of contents — the central directory — sits at the end of the file,
    so this seeks to it and stops: opening a 16 GB archive is as cheap as opening
    a small one, and nothing is decompressed.
    """
    try:
        with zipfile.ZipFile(path) as archive:
            entries = [info for info in archive.infolist() if not info.is_dir()]
            methods = {}
            for info in entries:
                methods[info.compress_type] = methods.get(info.compress_type, 0) + 1
    except (zipfile.BadZipFile, OSError) as error:
        return {"path": path, "error": "{}: {}".format(type(error).__name__, error)}

    raw_bytes = sum(info.file_size for info in entries)
    packed_bytes = sum(info.compress_size for info in entries)
    names = {METHOD_NAMES.get(m, "method {}".format(m)) for m in methods}
    kind = next(iter(names)) if len(names) == 1 else "mixed"

    described = {
        "path": path,
        "kind": kind,
        "entries": len(entries),
        "raw_bytes": raw_bytes,
        "packed_bytes": packed_bytes,
        "methods": {
            METHOD_NAMES.get(m, "method {}".format(m)): n for m, n in methods.items()
        },
    }
    if recorded_size is not None:
        described["size"] = recorded_size
    # Bytes that have to be decompressed to be read at all — the number that
    # explains a stall, and the one the report is sorted by.
    described["deflated_bytes"] = sum(
        info.file_size
        for info in entries
        if info.compress_type != zipfile.ZIP_STORED
    )
    return described


def archives_under(root):
    """Every .zip under a directory, recursively, in a stable order."""
    found = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for name in sorted(filenames):
            if name.lower().endswith(".zip"):
                found.append(os.path.join(dirpath, name))
    return found


# ── The report ─────────────────────────────────────────────────────────────


def summarise(described, source):
    """The whole scan as one JSON object: a short list, then everything."""
    ok = [d for d in described if "error" not in d]
    failed = [d for d in described if "error" in d]

    kinds = {}
    for item in ok:
        kinds[item["kind"]] = kinds.get(item["kind"], 0) + 1

    def worst_first(item):
        return item.get("deflated_bytes", 0)

    return {
        "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "scanned": {
            "archives": len(described),
            "readable": len(ok),
            "failed": len(failed),
        },
        "kinds": kinds,
        "deflated_bytes": sum(d.get("deflated_bytes", 0) for d in ok),
        "worst": sorted(ok, key=worst_first, reverse=True)[:WORST_COUNT],
        "archives": described,
        "failures": failed,
    }


def format_bytes(count):
    for unit in ("B", "KiB", "MiB", "GiB", "TiB"):
        if count < 1024 or unit == "TiB":
            return "{:.2f} {}".format(count, unit)
        count /= 1024.0


def print_summary(report):
    """The part worth reading, to the plugin log."""
    log(
        "i",
        "scanned {} archive(s): {}".format(
            report["scanned"]["archives"],
            ", ".join(
                "{} {}".format(n, kind) for kind, n in sorted(report["kinds"].items())
            )
            or "none readable",
        ),
    )
    if report["deflated_bytes"]:
        log(
            "w",
            "{} of image data has to be decompressed on every read — rebuild "
            "those archives with `zip -0` (see the README)".format(
                format_bytes(report["deflated_bytes"])
            ),
        )
    for item in report["worst"][:5]:
        title = item.get("title") or item["path"]
        log(
            "i",
            "  {} — {}, {} of {} images".format(
                title,
                item["kind"],
                format_bytes(item["deflated_bytes"]),
                item["entries"],
            ),
        )
    if report["failures"]:
        log(
            "w",
            "{} archive(s) could not be read — the paths the database holds may "
            "not be readable from inside the container; they are listed in the "
            "report".format(len(report["failures"])),
        )


def write_report(report, path):
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    return path


# ── Entry points ───────────────────────────────────────────────────────────


def default_report_path():
    """Beside the script, so it lands where the plugin's own files are."""
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "zipInfo-report.json")


def scan_from_stash(connection):
    entries = galleries_from_stash(Stash(connection))
    described = []
    for index, entry in enumerate(entries):
        item = describe(entry["path"], entry.get("size"))
        item["gallery_id"] = entry["gallery_id"]
        item["title"] = entry["title"]
        described.append(item)
        if index % 25 == 0:
            progress((index + 1) / len(entries) if entries else 1.0)
    return described


def run(input_data, output):
    """The plugin task: walk the library and report."""
    log("i", "Gallery ZIP Info")
    described = scan_from_stash(input_data["server_connection"])
    report = summarise(described, "stash")
    path = write_report(report, default_report_path())
    print_summary(report)
    log("i", "report written to " + path)
    output["output"] = {
        "archives": report["scanned"]["archives"],
        "kinds": report["kinds"],
        "deflated_bytes": report["deflated_bytes"],
        "report": path,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Report the compression method of ZIP archives, from Stash or "
        "from the filesystem."
    )
    parser.add_argument(
        "--file",
        action="append",
        default=[],
        metavar="ZIP",
        help="inspect one archive; repeatable, and needs no Stash",
    )
    parser.add_argument(
        "--root",
        metavar="DIR",
        help="inspect every .zip under a directory, recursively; needs no Stash",
    )
    parser.add_argument(
        "--report",
        metavar="PATH",
        help="where to write the JSON report (default: beside this script)",
    )
    args = parser.parse_args()

    if args.file or args.root:
        paths = list(args.file)
        if args.root:
            paths += archives_under(args.root)
        described = [describe(path) for path in paths]
        report = summarise(described, "filesystem")
        print_summary(report)
    else:
        # Started by Stash: the plugin input is the whole of stdin.
        report = None
        described = []
        output = {}
        try:
            input_data = json.load(sys.stdin)
            run(input_data, output)
        # A task reports failure through the result object; crashing would
        # lose the connection details and the reason with it.
        except Exception as error:
            output["error"] = "{}: {}".format(type(error).__name__, error)
        print(json.dumps(output))
        return 0

    path = write_report(report, args.report or default_report_path())
    print("report written to " + path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
