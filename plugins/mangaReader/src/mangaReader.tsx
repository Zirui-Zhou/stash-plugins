/**
 * Manga Reader — a two-page (spread) view for the image lightbox.
 *
 * The entry point, and nothing else: the pairing rules are in spreads.ts, the
 * settings in settings.ts, what this plugin knows about Stash's lightbox in
 * stash-lightbox.ts, and the reader itself in takeover.ts.
 *
 * Nothing here draws anything. `install` starts watching for a lightbox and adds
 * this plugin's switch to its options menu; the pages only appear when a reader
 * turns that switch on, which is off until they do (see DEFAULT_SETTINGS).
 */
import "./spreads";
import { requirePluginApi } from "./plugin-api";
import { install } from "./takeover";

// Throws if Stash has not injected its API, which is the one failure worth being
// loud about: everything this plugin does goes through it, and a plugin that
// quietly did nothing would look like a plugin that failed to load.
requirePluginApi();

install();
