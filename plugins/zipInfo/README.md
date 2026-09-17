# Gallery ZIP Info

Reports how the images in each gallery's ZIP archive are stored — **stored**
(no compression, which is what you want), **deflated**, or **mixed** — and writes
the whole scan to a JSON report.

## Why

Stash reads a ZIP-backed gallery one image at a time, and its own documentation
says the archive should be built without compression:

> For best results, images in zip file should be stored without compression
> (copy, store or no compression options … Eg on linux: `zip -0 -r gallery.zip
> foldertozip/`). This impacts heavily on the zip read performance.

A deflated entry has to be decompressed on every read, which is where the
multi-second stalls on a large gallery come from. Nothing in Stash reports which
of the two an archive uses, so the only way to find out has been `zipinfo -v` on
one file at a time. This plugin answers it for the whole library at once.

## Install

Add the source URL this repository publishes as a plugin source in
**Settings → Plugins**, then install **Gallery ZIP Info** from it. It has no UI:
it adds a task, under **Settings → Tasks → Gallery ZIP Info**.

It needs nothing but Python 3, which Stash's own image already ships — the script
uses only the standard library, and there is no binary to compile for your
architecture.

## Run it by hand first

The task is not the best first step, because it cannot tell you whether the paths
the database holds are readable from where the plugin runs. These two can, and
they need no Stash at all — run them inside the container if that is where Stash
runs:

```bash
python3 zipInfo.py --file /comics/example.zip     # one archive
python3 zipInfo.py --root /comics                 # every .zip under a directory
```

Each prints a summary and writes `zipInfo-report.json` beside the script (use
`--report <path>` to put it elsewhere).

## Then the task

**Settings → Tasks → Gallery ZIP Info → Report ZIP compression** walks every
gallery through Stash's GraphQL API, reads each archive's table of contents, and
writes the same report. Nothing is decompressed: an archive's table of contents
sits at the end of the file, so even a 16 GB archive is cheap to open.

Only one archive is read per gallery, and only when the gallery is backed by one
— a folder-backed gallery has no file to read and is not counted.

## Reading the report

| Field | Meaning |
| --- | --- |
| `kinds` | How many archives are `stored`, `deflated` or `mixed` |
| `deflated_bytes` | Image data that has to be decompressed on every read. This is the number that costs you time |
| `worst` | The 20 archives with the most deflated data — start here |
| `archives` | Every archive, with its entry count, per-method counts and sizes |
| `failures` | Archives that could not be read, and why. A path that the database holds but the plugin cannot open is the expected first finding: check that the plugin runs in the same container as Stash, with the same library mounted |

## What to do about a deflated archive

Rebuild it with `zip -0`, keeping the entries' names and their order the same:

```bash
mkdir work && cd work
unzip -q /comics/example.zip
zip -0 -q -r /comics/example.zip.new .
mv /comics/example.zip.new /comics/example.zip
```

Then have Stash rescan the gallery. The images themselves are unchanged, so their
fingerprints are unchanged; the archive's own fingerprint changes, which is what
the rescan picks up.

## Deliberately not here yet

**Converting an archive.** It is the obvious next step, and it is not in this
plugin because it rewrites a file you cannot get back if the write goes wrong —
and because the report is what tells you whether it is worth having. If the scan
comes back with everything already `stored`, there is nothing to convert.

The other reason is that what a conversion *should* do is a real question: an
archive can be reported as `mixed` with a single deflated entry, and rebuilding
it costs a full rewrite plus a rescan for two megabytes of saved reads.
