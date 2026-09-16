/**
 * Manga Tools — the censorship attribute
 *
 * What values it takes, and how one is drawn. The counterpart of languages.ts,
 * which does the same for the language attribute; the *name* of the field they
 * live in stays in fields.ts with the other two, because the list of names is the
 * one thing that has to agree everywhere.
 *
 * The split is deliberate and is the one this plugin makes: an attribute owns its
 * vocabulary and its presentation, and the surfaces own where things go. A
 * surface — the details block, the edit block — renders more than one attribute,
 * so an attribute does not own a surface; what it owns is how to draw *a value of
 * it*, wherever that value is being shown.
 *
 * The three states are two values and an absence, which is why there is a third
 * icon here at all. Absence means "nobody has said", and a selector expresses it
 * with its own clear button — the same arrangement the language dropdown has.
 */
import { NS } from "./languages";
import { t } from "./i18n";
import { requirePluginApi } from "./plugin-api";
import type { MangaToolsIntl } from "./plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding. This is the only module
// that uses JSX without a direct `React.*` call, so the linter cannot see the
// use — it reads as unused even though the transform emits a reference to it.
// biome-ignore lint/correctness/noUnusedVariables: used by the JSX below, via the classic transform
const React = PluginApi.React;

/**
 * The values the field takes, in the order the selector lists them.
 *
 * Both lower case, and matching is case-insensitive like everything else. Note
 * that a boolean would not do: a key that is absent, a key set to "false", and a
 * key holding junk would then have to be told apart, and only the first is a state
 * the reader chose.
 */
NS.CENSORSHIP_VALUES = ["censored", "uncensored"];

/**
 * Normalises a stored value to one of CENSORSHIP_VALUES, or "" when it is not one
 * of them.
 *
 * Unlike NS.normalize for languages, an unrecognised value is *not* echoed back:
 * with exactly two values and no aliases there is nothing it could mean, and the
 * selector has no way to draw it. It reads as "not marked" instead, and stays in
 * the gallery until something writes over it — the plugin never rewrites data it
 * did not put there.
 */
NS.normalizeCensorship = (raw: unknown): string => {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim().toLowerCase();
  if (s === "") return "";

  const values = NS.CENSORSHIP_VALUES;
  for (let i = 0; i < values.length; i++) {
    if (values[i] === s) return values[i];
  }
  return "";
};

/**
 * One icon per state, and the one place the three names are written down.
 *
 * The pairing is a Chinese pun rather than anything to do with chess: 步兵,
 * "infantry", is what a censored release is *not*, and 骑兵, "cavalry", is what it
 * is — by way of the mosaic a censor lays over the page. A pawn and a knight say
 * the same thing in one glyph each. The joke is deliberately explained nowhere on
 * screen: the icons carry it, and a tooltip that spelled it out would be a
 * tooltip about a word rather than about the gallery.
 *
 * `faChessBoard` is the absence, and it earns its place twice over — it is the
 * third member of the same set, so the control reads as one thing with three
 * states rather than as two chess pieces beside a UI glyph, and a board with
 * nothing on it *is* "nothing marked yet". It looks a little like the mosaic the
 * other two are named after, which the dimmed grey helps along.
 *
 * No fallback name is needed, unlike `faXmark` in dialog-filter.tsx:
 * chess-board has been spelled that way in every FontAwesome since 5, so
 * whichever version Stash bundles answers to it.
 */
const ICONS: { [value: string]: string } = {
  censored: "faChessKnight",
  uncensored: "faChessPawn",
  "": "faChessBoard",
};

/** Names already reported, so a page of galleries does not print a page of logs */
const missingIcons: { [name: string]: boolean } = {};

function noteMissingIcon(name: string): void {
  if (missingIcons[name]) return;
  missingIcons[name] = true;
  console.error(
    "[mangaTools] this Stash's FontAwesome has no " +
      name +
      ", so that icon is drawn as nothing. Run this in the console to see which " +
      "names it does have: window.PluginApi.libraries.FontAwesomeSolid." +
      name
  );
}

/**
 * The icon definition for a state, or null when this Stash has no such name.
 *
 * The lookup is by string, at runtime, so a name the bundled set does not have
 * comes back undefined — and undefined handed to Stash's Icon *throws inside a
 * render*, which takes the whole page down rather than one glyph. The names above
 * are checked against the wrong source by nature: FontAwesome's docs list every
 * version, not the subset a given Stash ships.
 */
NS.censorshipIcon = (value: string): unknown => {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const name = ICONS[value] || ICONS[""];
  const icon = Solid[name];
  if (!icon) {
    noteMissingIcon(name);
    return null;
  }
  return icon;
};

/** The plugin's own word for a state, for a tooltip or a label */
NS.censorshipLabel = (intl: MangaToolsIntl, value: string): string => {
  if (value === "censored") return t(intl, "mangaTools.censorship.censored");
  if (value === "uncensored")
    return t(intl, "mangaTools.censorship.uncensored");
  return t(intl, "mangaTools.censorship.unset");
};

/**
 * The state's icon, or nothing at all when this Stash has no such name.
 *
 * A component rather than a bare `<Icon icon={censorshipIcon(...)} />`, so that a
 * missing name costs one glyph instead of throwing through a render — which on a
 * detail page would mean the page, not the icon.
 */
export function CensorshipIcon(props: { value: string }) {
  const Icon = PluginApi.components.Icon;
  const icon = NS.censorshipIcon(props.value);
  return icon ? <Icon icon={icon} /> : null;
}

/**
 * One option of the selector: the state's icon, then its name.
 *
 * react-select draws this for the menu item and for the value in the box, so the
 * two always agree — the same arrangement as the language dropdown's flag.
 * `.manga-tools-option` is the class that spaces the two apart.
 */
export function formatCensorshipOption(option: {
  value: string;
  label: string;
}) {
  return (
    <span className="manga-tools-option">
      <CensorshipIcon value={option.value} />
      {option.label}
    </span>
  );
}

export { NS };
