/**
 * Manga Reader — a two-page (spread) view for the image lightbox.
 *
 * WHAT THIS FILE WILL BE. Stash's lightbox is `LightboxComponent`, a plain
 * `React.FC` with no `PatchComponent` wrapper, so `PluginApi.patch` cannot reach
 * it: the viewer has to be extended by putting our own elements in the DOM beside
 * Stash's and driving the lightbox through its own interface (its arrow keys and
 * its header indicator). That work is not here yet — see the README.
 *
 * WHAT IT IS NOW: the pairing rules, imported so they are part of the bundle and
 * reachable from the tests. Nothing runs at load but a line saying so, which is
 * deliberate: the plugin is installable and inert rather than half-wired.
 */
import "./spreads";

console.info(
  "[mangaReader] loaded — pairing rules only, no lightbox takeover yet"
);
