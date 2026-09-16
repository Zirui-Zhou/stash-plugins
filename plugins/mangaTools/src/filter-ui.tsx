/**
 * Manga Tools — the UI both filter surfaces share.
 *
 * The sidebar sections and the dialog's Language card draw the same rows and
 * offer the same choices, so the pieces they have in common live here: the
 * LanguageRow (with its Flag), the option lists and query matching, and the DOM
 * primitives that recognise Stash's tags for our criteria.
 *
 * The tag recognisers are deliberately in one place. The `TAG_MARK` attribute is
 * written by both the sidebar (writeTagLabels) and the dialog (manageDialogTags),
 * and `isLanguageTag` is read by both; duplicating them across two modules would
 * let the two surfaces stop recognising each other's tags.
 */
import { NS } from "./languages";
import { requirePluginApi } from "./plugin-api";
import { message } from "./filter-model";
import type { ReactElement } from "react";
import type {
  MangaToolsIntl,
  MangaToolsLanguageSelection,
  MangaToolsOption,
} from "./plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/**
 * The languages a surface offers.
 *
 * The enabled-languages setting limits the choices, and a value the selection
 * already holds stays visible even if it has since been disabled — otherwise the
 * list would be filtered by something the reader cannot see.
 *
 * Shared rather than written out per surface: the sidebar section and the dialog's
 * card must offer the same choices, or a filter set in one is not the filter the
 * other shows.
 */
export function visibleOptions(
  intl: MangaToolsIntl,
  selection: MangaToolsLanguageSelection
): MangaToolsOption[] {
  return NS.languageOptions(intl.locale).filter(
    (o) =>
      !NS.enabledLanguages ||
      NS.enabledLanguages.has(o.value) ||
      selection.included.indexOf(o.value) !== -1 ||
      selection.excluded.indexOf(o.value) !== -1
  );
}

/**
 * Nothing is selectable while (Any) or (None) is set: there is no particular value
 * to pick in those states. That is Stash's own rule — its `useCandidates` returns
 * an empty list for IsNull and NotNull — and it is why choosing (None) in the
 * studio filter makes the studio list disappear. The search box stays, standing
 * over nothing, exactly as it does there.
 */
export function selectableOptions(
  selection: MangaToolsLanguageSelection,
  options: MangaToolsOption[]
): MangaToolsOption[] {
  return selection.modifier ? [] : options;
}

/** Does an option match what the reader typed? Against the name and the code both. */
export function matchesQuery(option: MangaToolsOption, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    option.label.toLowerCase().indexOf(needle) !== -1 ||
    option.value.toLowerCase().indexOf(needle) !== -1
  );
}

/** The flag to draw for an option, or null when flags are turned off */
export function flagOf(option: MangaToolsOption): string | null {
  return NS.showFlags ? option.flag : null;
}

/** A regional flag, drawn by flag-icons' CSS — the same markup the dropdowns use */
function Flag(props: { flag: string; className?: string }): ReactElement {
  return (
    <span
      className={
        "fi fi-" + props.flag + (props.className ? " " + props.className : "")
      }
    />
  );
}

/**
 * One row of a language list.
 *
 * Shared by the sidebar section and the dialog's card, because the two draw the
 * same four things: a value that can be picked, one that has been picked, one
 * that has been excluded, and the two modifier entries. What differs is only the
 * wrapper — Stash's sidebar list puts the label in a `label-group` and wraps it
 * in a truncated span, while its dialog list uses bare divs and gives a picked
 * row an extra empty div — so that is what `variant` selects. Rendering them
 * separately is how the two drifted apart before.
 */
export function LanguageRow(props: {
  label: string;
  state: "candidate" | "included" | "excluded";
  variant: "sidebar" | "dialog";
  flag?: string | null;
  /** A leading element drawn where a flag would go — the censorship chess icon. */
  leading?: ReactElement | null;
  modifier?: boolean;
  canExclude?: boolean;
  /**
   * A row whose criterion holds one value at a time, so there is nothing for the
   * plus to add. Stash hides it with a class rather than by not drawing it —
   * `visibility: hidden` in its list styles — which is what keeps a single-value
   * row's label lined up with a multi-value one's. Only ever passed for a
   * *candidate*: Stash's own selected row has no such class, and neither should
   * this one, or the tick would be hidden with the plus.
   */
  singleValue?: boolean;
  onClick: () => void;
  onExclude?: () => void;
}) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Regular = PluginApi.libraries.FontAwesomeRegular || {};
  const Icon = PluginApi.components.Icon;
  const Bootstrap = PluginApi.libraries.Bootstrap;
  const intl = PluginApi.libraries.Intl.useIntl();

  const hover = React.useState(false);
  const hovered = hover[0];
  const setHovered = hover[1];

  const selected = props.state !== "candidate";
  const excluded = props.state === "excluded";
  const sidebar = props.variant === "sidebar";

  function setHover(next: boolean) {
    return () => {
      setHovered(next);
    };
  }

  // A plus to add, a tick once added, a cross once excluded — and under the
  // cursor the tick or cross becomes a hollow cross, which is how Stash says
  // that clicking takes it away again.
  const icon = !selected
    ? Solid.faPlus
    : hovered
      ? Regular.faTimesCircle || Solid.faTimesCircle
      : excluded
        ? Solid.faTimesCircle
        : Solid.faCheckCircle;

  const labelClass = excluded
    ? "excluded-object-label"
    : selected
      ? "selected-object-label"
      : "unselected-object-label";

  return (
    <li
      className={
        (selected ? "selected-object" : "unselected-object") +
        (props.modifier ? " modifier-object" : "")
      }
    >
      <a
        tabIndex={0}
        onClick={props.onClick}
        onMouseEnter={setHover(true)}
        onMouseLeave={setHover(false)}
        onFocus={setHover(true)}
        onBlur={setHover(false)}
      >
        <div className={sidebar ? "label-group" : undefined}>
          <Icon
            className={
              "fa-fw " +
              (excluded ? "exclude-icon" : "include-button") +
              (props.singleValue ? " single-value" : "")
            }
            icon={icon}
          />
          {props.leading != null ? (
            props.leading
          ) : props.flag ? (
            <Flag flag={props.flag} />
          ) : null}
          {sidebar ? (
            <span className={"TruncatedText inline " + labelClass}>
              {props.label}
            </span>
          ) : (
            <span className={labelClass}>{props.label}</span>
          )}
        </div>
        {!selected || !sidebar ? (
          <div>
            {props.canExclude && !selected && Bootstrap ? (
              <Bootstrap.Button
                // Without this the exclude button is a solid blue block: see the
                // note on the search box's clear button.
                variant="secondary"
                className="minimal exclude-button"
                onClick={(e: { stopPropagation: () => void }) => {
                  e.stopPropagation();
                  if (props.onExclude) props.onExclude();
                }}
                onKeyDown={(e: { stopPropagation: () => void }) => {
                  e.stopPropagation();
                }}
              >
                <span className="exclude-button-text">
                  {sidebar
                    ? "exclude"
                    : message(intl, "actions.exclude_lowercase", "exclude")}
                </span>
                <Icon className="fa-fw exclude-icon" icon={Solid.faMinus} />
              </Bootstrap.Button>
            ) : null}
          </div>
        ) : null}
      </a>
    </li>
  );
}

/** Every tag Stash draws, in both of the rows that show a filter's criteria */
export const TAG_SELECTOR = ".filter-tags .tag-item";

/**
 * Set on a Stash tag this plugin has worded, holding the wording it put there.
 *
 * Needed because a tag that has been re-worded is no longer recognisable by its
 * text — in most UI languages the wording written here does not open with the raw
 * field name — and the dialog's tags have to be found again on later renders: to
 * be shown again when the card falls back into line with the applied filter, and
 * to be hidden again after Stash has re-rendered them.
 *
 * Holding the label rather than being an empty marker is what makes it safe.
 * React can reuse an element for another criterion's tag, where Stash's own tag
 * keys collide; when it does, it rewrites the text and the attribute no longer
 * matches it — so the tag is treated as whatever it now is.
 */
export const TAG_MARK = "data-manga-tools-language";

/**
 * Is this tag Stash's tag for a criterion of ours?
 *
 * Recognised by its text, there being no attribute on a tag saying which criterion
 * it came from. Every one of Stash's formats opens with the field name and then a
 * space — "{criterion} (custom field) …" for a criterion's own tag, "{criterion} …"
 * for the pills beside the editor — so that much is matched. The trailing space
 * is what makes a bare prefix safe, since no other field can begin with the same
 * run of characters *and* a space. See TAG_MARK for the tag that has already been
 * re-worded and so no longer says that.
 */
export function isFieldTag(
  tag: Element,
  fieldName: string,
  mark: string
): boolean {
  // The label is the tag's first child — `{label}` ahead of the ✗ button.
  const text = tag.firstChild;
  if (text?.nodeType !== 3 /* TEXT_NODE */) return false;

  const value = String(text.nodeValue).trim();
  if (tag.getAttribute(mark) === value) return true;

  const prefix = fieldName.toLowerCase() + " ";
  return value.toLowerCase().indexOf(prefix) === 0;
}

/** Is this tag Stash's tag for the language criterion? */
export function isLanguageTag(tag: Element): boolean {
  return isFieldTag(tag, NS.FIELD_NAME, TAG_MARK);
}

/** The text node holding a tag's label */
export function tagText(tag: Element): Node {
  return tag.firstChild as Node;
}
