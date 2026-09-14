# stash-plugins

Plugins for [Stash](https://github.com/stashapp/stash), installed and updated
through Stash's own plugin manager — no copying files by hand.

## Plugins

| Plugin | What it does |
|---|---|
| [Manga Tools](plugins/mangaTools/README.md) | Adapts Stash galleries to manga/comic management: a language attribute with a flag badge on the cover, a dropdown on the edit page, a localised row on the detail page, and a language row in the bulk edit dialog |

Each plugin's full documentation — every feature, its settings, and what to check
if something stops working — is in its own README, linked above.

## Installation

In Stash, go to **Settings → Plugins → Available Plugins → Add source**, and fill in:

| Field | Value |
|---|---|
| Name | anything, e.g. `stash-plugins` |
| Source URL | `https://zirui-zhou.github.io/stash-plugins/index.yml` |
| Local Path | anything, e.g. `stash-plugins` |

Every plugin above then appears in the list. Tick the ones you want, click
**Install**, then **Reload plugins**.

## Updating

When a plugin changes, it shows up under **Installed Plugins** — click **Check
for updates**, then **Update**. Your own data and settings are untouched: they
live in Stash's database, not in the plugin.

## If something doesn't work

1. Check that the plugin is ticked and enabled under **Settings → Plugins**, then
   click **Reload plugins**.
2. **Hard-refresh the browser (Ctrl+F5).** Stash caches plugin JavaScript, so a
   freshly installed or updated plugin can keep running the old code.
3. Still stuck? Open the browser console (F12). Each plugin's README has a
   troubleshooting section listing the log lines it prints and what each one
   means.

## Adding your own plugin

See [DEVELOPING.md](DEVELOPING.md) for how the plugins here are built, packaged
and published, and the conventions to follow.
