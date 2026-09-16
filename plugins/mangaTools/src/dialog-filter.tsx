/**
 * Manga Tools — the Language card in Stash's "edit filters" dialog.
 *
 * The dialog's card and the sidebar's section share the same read/write logic
 * (filter-model.ts) and the same rows (filter-ui.ts); this module is the dialog
 * side alone — the card component and the machinery that keeps the dialog's tag
 * row saying what the card's working copy holds, which is not the same thing the
 * list's own row says.
 */
import { NS } from "./languages";
import { requirePluginApi } from "./plugin-api";
import {
  EMPTY_SELECTION,
  LANGUAGE_TYPE,
  isEmptySelection,
  languageFilterQuery,
  message,
  readLanguageFilter,
  sameSelection,
  selectionConditions,
  tagLabels,
  toggleExcluded,
  toggleIncluded,
  withModifier,
  withoutModifier,
} from "./filter-model";
import {
  LanguageRow,
  TAG_MARK,
  TAG_SELECTOR,
  flagOf,
  isLanguageTag,
  matchesQuery,
  selectableOptions,
  tagText,
  visibleOptions,
} from "./filter-ui";
import type {
  MangaToolsFilterModel,
  MangaToolsLanguageSelection,
} from "./plugin-api";

const PluginApi = requirePluginApi();

// Must stay: the classic JSX transform compiles every element to
// React.createElement, which resolves to this binding.
const React = PluginApi.React;

/** Marks the tags this plugin draws itself, so it never mistakes them for Stash's */
const OWN_TAG_MARK = "data-manga-tools-own-tag";

/**
 * The language tags in the dialog's row.
 *
 * The pills a card draws beside its own editor are skipped: they are inside
 * `.criterion-list`, hidden by CSS, and are Stash's record of what the criterion
 * holds rather than part of the row that reports the filter.
 */
function dialogLanguageTags(): HTMLElement[] {
  const all = document.querySelectorAll(TAG_SELECTOR);
  const ours: HTMLElement[] = [];

  for (let i = 0; i < all.length; i++) {
    if (!all[i].closest(".edit-filter-dialog")) continue;
    if (all[i].closest(".criterion-list")) continue;
    // Never the tags this plugin draws: they are the ones that must stay visible
    // when Stash's step aside, and in an English UI they look enough like Stash's
    // to be mistaken for them.
    if (all[i].hasAttribute(OWN_TAG_MARK)) continue;
    // A tag is a span, so the element Stash makes is always an HTMLElement —
    // which is what hiding one needs.
    if (isLanguageTag(all[i])) ours.push(all[i] as HTMLElement);
  }

  return ours;
}

/** Class of the box the dialog's card is drawn in, inside Stash's editor area */
const DIALOG_HOST_CLASS = "manga-tools-dialog-host";

/**
 * The box Stash renders for our criterion's editor — and only while the card is
 * open, which makes it both the anchor and the signal that there is something
 * to draw.
 */
function dialogEditorBox(): Element | null {
  return document.querySelector(
    '.criterion-list [data-type="' + LANGUAGE_TYPE + '"] .criterion-editor'
  );
}

/** Our own row, held so the same node is reused and can be taken away again */
let dialogTagsFallback: HTMLElement | null = null;

/**
 * The row Stash draws for the criteria it knows about, or null if there is none.
 *
 * Deliberately find-only: manageDialogTags needs to know whether Stash's row is
 * there, and making one as a side effect of asking is how the plugin would end up
 * with a row it does not need.
 *
 * Our own row is skipped by reference — it carries the same classes, so nothing
 * else would tell the two apart, and taking it for Stash's is what would have
 * this module remove the very row it is about to draw into.
 */
function stashDialogTagsRow(): Element | null {
  const content = document.querySelector(".edit-filter-dialog .dialog-content");
  if (!content) return null;

  const rows = content.querySelectorAll(".filter-tags");
  for (let i = 0; i < rows.length; i++) {
    if (rows[i] === dialogTagsFallback) continue;
    if (!rows[i].closest(".criterion-list")) return rows[i];
  }

  return null;
}

/**
 * Where the dialog's tags go: Stash's row when it has one, and one of our own
 * when it does not.
 *
 * That row is inside `.dialog-content` and outside `.criterion-list`, which is
 * the point — it is not inside a card, so closing the card cannot take a tag away
 * with it.
 *
 * Stash renders its row only while the dialog holds at least one criterion, and a
 * dialog whose filter is empty has none: a language picked in that state would
 * then have nowhere to be shown, which is the case this exists for.
 */
function dialogTagsRow(): Element | null {
  const stash = stashDialogTagsRow();
  if (stash) {
    dropFallbackRow();
    return stash;
  }

  const content = document.querySelector(".edit-filter-dialog .dialog-content");
  if (!content) {
    dropFallbackRow();
    return null;
  }

  if (!dialogTagsFallback) {
    dialogTagsFallback = document.createElement("div");
    // The classes Stash's own tag row carries — not the pill row's
    // (`d-flex justify-content-center mb-2`), which is a different element
    // inside a card and would space this one differently.
    dialogTagsFallback.className = "wrap-tags filter-tags";
  }

  if (dialogTagsFallback.parentNode !== content) {
    content.appendChild(dialogTagsFallback);
  }

  return dialogTagsFallback;
}

/** Takes our row away again once Stash is drawing one of its own */
function dropFallbackRow(): void {
  if (dialogTagsFallback?.parentNode) {
    dialogTagsFallback.parentNode.removeChild(dialogTagsFallback);
  }
}

/**
 * Words the dialog's tags from the card.
 *
 * This is the one place the plugin writes to the dialog's row rather than the
 * list's, and the reason is that the two rows mean different things. The list's
 * row reports the filter the list is *applied* to. The dialog's reports the
 * dialog's *working copy* — which is why Stash's own criteria update it the
 * moment they are edited, several clicks before Apply. A language filter's
 * working copy lives in this plugin's card rather than in Stash's copy, so this
 * has to say for it what Stash says for its own criteria.
 *
 * Stash's tags are the ones written into, one label per tag, because a tag is
 * already a working, clickable piece of Stash's own UI and re-wording it is all
 * that is wrong with it. A tag is hidden only when the card has nothing to say
 * in its place — an emptied card, or fewer conditions than the dialog's copy
 * holds — and never for any other reason, so nothing here alternates from one
 * render to the next.
 *
 * Hidden rather than removed: it is Stash's element, React is entitled to
 * re-render it, and one it still owns is one it will not miss.
 */
function manageDialogTags(labels: string[]): void {
  const tags = dialogLanguageTags();

  for (let i = 0; i < tags.length; i++) {
    const label = i < labels.length ? labels[i] : null;

    const text = tagText(tags[i]);
    if (label !== null && text.nodeValue !== label) {
      text.nodeValue = label;
      tags[i].setAttribute(TAG_MARK, label);
    }

    const display = label === null ? "none" : "";
    if (tags[i].style.display !== display) tags[i].style.display = display;
  }
}

/**
 * The labels the card has to draw itself: those the dialog has no tag for.
 *
 * Stash draws a tag per condition of the criterion in its copy, so the first
 * tags are the ones that already have somewhere to go and are handled by
 * manageDialogTags. What is left over is a condition the dialog's copy does not
 * have — the first language picked into a dialog that had none at all.
 */
function ownTagLabels(labels: string[]): string[] {
  return labels.slice(dialogLanguageTags().length);
}

/**
 * Was the ✗ of a language tag in the dialog's row just clicked?
 *
 * Stash's ✗ takes the criterion out of the dialog's working copy. The card is
 * what Apply merges, and it would otherwise go on showing a language the dialog
 * has dropped, so the two have to move together — which is what the listener
 * using this does.
 *
 * Only the ✗: the tag's label is Stash's way into the card, and clicking it
 * changes nothing.
 */
function clickedTagRemove(target: Element | null): boolean {
  if (!target || typeof target.closest !== "function") return false;
  if (!target.closest(".edit-filter-dialog")) return false;
  if (!target.closest(".filter-tags .tag-item button")) return false;

  const tag = target.closest(".tag-item");
  return !!tag && !tag.closest(".criterion-list") && isLanguageTag(tag);
}

/**
 * The tag the card draws itself, for a language Stash has no tag to show.
 *
 * The same markup as Stash's own down to the ✗ — a `tag-item badge` with a
 * `btn-secondary` button — so one drawn here is indistinguishable from one of
 * Stash's. That is not only for looks: it is why the dialog's row does not jump
 * when a card edit turns Stash's tag into ours.
 *
 * It is not clickable, unlike Stash's. There is nowhere for it to go: it only
 * appears while the dialog is open, with the card right beside it.
 */
function LanguageTag(props: { label: string; onRemove: () => void }) {
  const Solid = PluginApi.libraries.FontAwesomeSolid || {};
  const Icon = PluginApi.components.Icon;
  const Bootstrap = PluginApi.libraries.Bootstrap;

  // Deliberately no row around this. It joins Stash's own row, and a wrapper
  // would nest a second flex row inside it, whose margin would inflate the height
  // of the row Stash drew — which stretches the native badges sitting in it and
  // makes them look bigger. Only the fallback row, made above, is a row.
  return (
    <span
      className="tag-item badge badge-secondary"
      // So that dialogLanguageTags never mistakes this for one of Stash's
      data-manga-tools-own-tag=""
    >
      {props.label}
      {Bootstrap ? (
        // `variant` alone: adding the class names as well is how this came out
        // as `btn btn-secondary btn btn-secondary`.
        <Bootstrap.Button variant="secondary" onClick={props.onRemove}>
          <Icon icon={Solid.faXmark || Solid.faTimes} />
        </Bootstrap.Button>
      ) : null}
    </span>
  );
}

/**
 * What of the dialog's DOM this component draws into, as one comparable value.
 *
 * Three things, and each has to be noticed separately: the dialog appearing, the
 * card's body being mounted or unmounted inside it, and the tag row coming and
 * going — the last of which changes on its own, since Stash renders that row only
 * while the dialog's copy holds a criterion. Any of the three appearing or
 * disappearing means there is something (or nothing) to draw.
 *
 * The dialog is asked first because the other two cannot exist without it, which
 * keeps the common case — no dialog open — to a single query on every mutation.
 */
function dialogDomState(): string {
  const dialog = document.querySelector(".edit-filter-dialog");
  if (!dialog) return "";

  return (
    (dialogEditorBox() ? "card " : "") + (stashDialogTagsRow() ? "tags" : "")
  );
}

/**
 * The language card inside Stash's "edit filters" dialog.
 *
 * The list is ours and so is the state behind it; nothing of Stash's editor is
 * touched. An earlier version drove that editor — filling its inputs, setting
 * its modifier select and pressing its confirm button — and it was the wrong
 * approach three times over: it produced a condition with an empty modifier that
 * the backend rejected outright, it left a replaced language in place, and it
 * could not express more than one language at all, because that editor appends
 * one condition per press and two conditions on a field are ANDed.
 *
 * So the selection is kept here, in the same shape the sidebar uses, and applied
 * by merging it into the URL at the moment Apply is pressed — see the effect
 * below. That is the sidebar's mechanism, and it brings the sidebar's abilities
 * with it: several languages, exclusions, and the two modifier entries.
 *
 * The tag is Stash's own, not one of ours: the criterion is handed to Stash as
 * the Language criterion (see adoptLanguageCriterion) and only its wording is
 * repaired (see relabelTags). So the tag appears in both tag rows, opens this
 * card when clicked and clears the filter when its ✗ is pressed — all of which
 * an earlier version of this component had to draw itself, in a second tag that
 * sat beside Stash's.
 */
export function DialogLanguageFilter(props: { filter: MangaToolsFilterModel }) {
  const intl = PluginApi.libraries.Intl.useIntl();
  const history = PluginApi.libraries.ReactRouterDOM.useHistory();

  const bumpState = React.useState(0);
  const bump = bumpState[1];

  // What is applied right now, read from the model on every render rather than
  // snapshotted once: Apply replaces the model, and a snapshot taken at mount
  // would go on describing the filter as it was before.
  const applied = readLanguageFilter(props.filter);

  // What the reader has chosen here, which is what the list below draws and what
  // Apply writes. Both are compared as sets, so picking a value and then picking
  // it again leaves no trace.
  const choiceState = React.useState<MangaToolsLanguageSelection>(applied);
  const choice = choiceState[0];
  const setChoice = choiceState[1];

  const queryState = React.useState("");
  const query = queryState[0];
  const setQuery = queryState[1];

  const searchRef = React.useRef<HTMLInputElement | null>(null);

  /**
   * Set when Apply is pressed, cleared once the merge has run.
   *
   * Deliberately not "the model changed": a filter changed from the sidebar
   * while this dialog happens to be open would otherwise have this card's
   * unapplied selection merged into it, which is not what pressing nothing
   * means.
   */
  const applyPending = React.useRef(false);

  /**
   * What this component draws depends on DOM Stash owns and React never reports:
   * the card's body, which is mounted by an effect inside the dialog rather than
   * by the render that mounts this component, and the dialog's tag row, which is
   * rendered by another component entirely.
   *
   * Watching for clicks is not enough. The click that opens the card is not always
   * ours to catch — the tag above opens the dialog *onto* this card
   * (`editingCriterion`) — and the row is rendered in the same commit as the
   * dialog itself, so a render that runs before that commit cannot see it. Without
   * this the card could open empty, with no search box and no languages, and the
   * dialog's tags could go unworded.
   *
   * So the mount points are watched rather than predicted. A mutation callback is
   * a microtask, which is before the browser paints, and React renders a state
   * change made outside an event handler synchronously — so what this asks for is
   * in place before any of it is on screen.
   */
  const dialogDom = React.useRef("");
  React.useEffect(() => {
    if (typeof MutationObserver !== "function") return;

    const observer = new MutationObserver(() => {
      const state = dialogDomState();
      if (state === dialogDom.current) return;

      dialogDom.current = state;
      bump((v) => v + 1);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, []);

  /** Apply, and the ways Stash itself takes the language away */
  React.useEffect(() => {
    function onClick(event: Event) {
      const clicked = event.target as Element | null;
      if (!clicked || typeof clicked.closest !== "function") return;
      if (!clicked.closest(".edit-filter-dialog")) return;

      // Apply, as Stash draws it: the one primary button in the dialog's footer.
      //
      // On the *capture* phase, deliberately, so this runs before React's own
      // handler and therefore before the render that follows it. The flag only
      // has to be standing by the time the merge effect runs, and capture is the
      // ordering that guarantees it — on the bubble phase it is set after React
      // has already re-rendered, and the effect may well have run by then, in
      // which case it sees nothing pending and the merge never happens again.
      if (clicked.closest(".modal-footer button.btn-primary")) {
        applyPending.current = true;

        // A deadline, because the wait in the merge below has no other way out,
        // and it reports a case worth knowing about rather than a bug: Apply
        // commits Stash's own filter, which this card's selection is not part of.
        // Choosing a language and nothing else leaves that filter untouched, so
        // there is nothing for the merge to wait for and the language is not
        // applied. Changing it from the sidebar is what works.
        window.setTimeout(() => {
          if (!applyPending.current) return;
          applyPending.current = false;

          console.warn(
            "[mangaTools] Apply changed nothing in Stash's filter, so the language " +
              "picked in the card was not applied. Pick it in the sidebar instead."
          );
        }, 2000);
      }

      // Every way Stash itself takes the language away — the ✗ on the card, the
      // ✗ on the dialog's tag, and "clear all" — edits the dialog's working copy
      // rather than this card's state. Apply then commits a filter with no
      // language in it, and the merge would read our own still-standing selection
      // as the newer of the two and write it straight back. Emptying it here is
      // what makes those buttons mean what they say, and what keeps the card
      // showing the same filter the dialog does.
      if (
        clicked.closest(".clear-all-button") ||
        clicked.closest(
          '.criterion-list [data-type="' +
            LANGUAGE_TYPE +
            '"] .remove-criterion-button'
        ) ||
        clickedTagRemove(clicked)
      ) {
        setChoice(EMPTY_SELECTION);
        setQuery("");
      }
    }

    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  /**
   * The merge.
   *
   * It waits for the list's filter to become what Apply committed, and only then
   * writes.
   *
   * That wait is the whole of it. Apply commits the dialog's *copy*, and the
   * filter this component is rendered with is the list's, which becomes that copy
   * a commit later, when Stash's own hook re-reads the URL Apply wrote. Merging
   * before that writes a third filter — neither the one committed nor the one in
   * hand — and then the URL and the filter describe different things. Stash's URL
   * handling has no way back from that: its one reconciliation is "decode the URL,
   * take it as the filter, and re-encode it if the string differs", which cannot
   * tell a different filter from a correction, so the URL and the filter state go
   * on rewriting each other until React throws.
   *
   * Merging *after* the wait is safe for the opposite reason: what gets written
   * is then that same filter with only the language changed — exactly the string
   * Stash's own encoder would produce for it, which is the one thing its
   * reconciliation recognises as already agreeing. And it comes out right as
   * well: by then the filter holds everything else the dialog did, so a criterion
   * removed there stays removed.
   *
   * The wait is short and always ends: the model this component is handed is
   * replaced whenever the URL changes, because the criterion carries the Language
   * identity and so never compares equal to a freshly decoded one. If it somehow
   * does not arrive, the timer says so rather than merging later and wrongly.
   */
  const lastModel = React.useRef<MangaToolsFilterModel | null>(null);
  React.useEffect(() => {
    const model = props.filter;
    const previous = lastModel.current;
    lastModel.current = model;

    if (!applyPending.current) return;

    // Still waiting: the filter has not become what Apply committed yet. This is
    // checked on every render rather than once, because how many renders the wait
    // lasts is Stash's business — a fresh page has more of them, which is why the
    // first Apply after a reload is the one that used to miss.
    if (!previous || previous === model) return;

    applyPending.current = false;
    const unchanged = sameSelection(choice, readLanguageFilter(model));

    if (unchanged) return;

    const search = languageFilterQuery(model, choice);
    if (search === null) {
      console.error(
        "[mangaTools] this list has no custom-fields criterion, so the language filter could not be applied"
      );
      return;
    }

    // Stash reads the URL on every navigation, so this is the whole of it — the
    // same route the sidebar takes.
    history.replace(Object.assign({}, history.location, { search: search }));
  });

  // The dialog's tags, and what is left for the card to draw itself — see
  // manageDialogTags and ownTagLabels. The labels are the card's own, because the
  // dialog's row is the one that reports the working copy; an empty card has
  // nothing to say, which is what takes the tags away.
  //
  // Worked out above the effect that uses them rather than further down with the
  // rest of what the card draws: they were `var`s once and only reachable from
  // the effect because of hoisting, which is exactly the kind of thing that stops
  // being true the moment the declaration changes.
  const dialogTagLabels = isEmptySelection(choice)
    ? []
    : tagLabels(intl, { value: selectionConditions(choice) }) || [];
  const ownTags = ownTagLabels(dialogTagLabels);
  const ownTagsRow = ownTags.length ? dialogTagsRow() : null;

  /**
   * The dialog's tags, worded from the card — and its row taken away again when
   * the card has nothing of its own to draw.
   *
   * A layout effect rather than the render body because it writes to DOM React
   * owns; a layout effect runs after React has written that DOM and before the
   * browser paints, so the wording is still what the card's first paint shows. It
   * runs on every commit, which is what keeps the row up to date as the card is
   * edited, and every write in it is guarded on the value actually changing — so
   * a commit that has nothing to do leaves the DOM alone.
   */
  React.useLayoutEffect(() => {
    manageDialogTags(dialogTagLabels);
    if (!ownTagsRow) dropFallbackRow();
  });

  /**
   * What the card starts from, re-read from the filter each time the dialog opens.
   *
   * Stash snapshots the filter when its dialog mounts — `cloneDeep` in
   * EditFilterDialog, and a fresh dialog is mounted for every open — so its cards
   * always describe the filter as it stands. This component cannot do that by
   * existing: it is mounted for as long as the gallery list is, so its state
   * would otherwise go on describing whichever filter was in place when the page
   * first loaded.
   *
   * Once per dialog, counted rather than flagged, so opening the card, closing it
   * and opening it again cannot discard a selection that has not been applied
   * yet. A layout effect so the card's first paint already shows the right rows.
   */
  const sessionRef = React.useRef(0);
  const syncedRef = React.useRef(-1);
  React.useLayoutEffect(() => {
    if (!document.querySelector(".edit-filter-dialog")) {
      sessionRef.current += 1;
      syncedRef.current = -1;
      return;
    }

    if (syncedRef.current === sessionRef.current) return;
    syncedRef.current = sessionRef.current;

    // A functional update that hands back the state it was given when the
    // selection has not in fact moved, so this effect cannot ask for a re-render
    // it does not need — a setState in a layout effect is a synchronous render,
    // and one that changes nothing every time is a loop.
    const applied = readLanguageFilter(props.filter);
    setChoice((previous) =>
      sameSelection(previous, applied) ? previous : applied
    );
    setQuery("");
  });

  // What the list is drawn from, following the sidebar's rules: the enabled
  // languages setting limits the choices, and a value already in use stays
  // visible even if it has since been disabled.
  const options = visibleOptions(intl, choice);
  const selectable = selectableOptions(choice, options);

  const chosen = selectable.filter(
    (o) => choice.included.indexOf(o.value) !== -1
  );
  const excludedChosen = selectable.filter(
    (o) => choice.excluded.indexOf(o.value) !== -1
  );
  const candidates = selectable.filter(
    (o) =>
      choice.included.indexOf(o.value) === -1 &&
      choice.excluded.indexOf(o.value) === -1 &&
      matchesQuery(o, query)
  );

  const showModifiers = isEmptySelection(choice);

  // The card's box, which Stash renders only while the card is open.
  const box = dialogEditorBox();
  let host: Element | null = null;
  if (box) {
    host = box.querySelector("." + DIALOG_HOST_CLASS);
    if (!host) {
      host = document.createElement("div");
      host.className = DIALOG_HOST_CLASS;
      box.insertBefore(host, box.firstChild);
    }
  }

  const list = (
    <div className="manga-tools-dialog-card">
      <div className="selectable-filter">
        <div className="clearable-input-group">
          <input
            ref={searchRef}
            className="clearable-text-field form-control"
            value={query}
            placeholder={message(intl, "actions.search", "Search") + "…"}
            onChange={(e: { target: { value: string } }) => {
              setQuery(e.target.value);
            }}
            onKeyDown={(e: { key?: string }) => {
              if (e.key === "Escape") {
                if (searchRef.current) searchRef.current.blur();
                return;
              }

              // Enter takes the one value left, as Stash's own list does.
              if (e.key !== "Enter" || candidates.length !== 1) return;
              setChoice(toggleIncluded(choice, candidates[0].value));
              setQuery("");
            }}
          />
        </div>
        <ul>
          {choice.modifier ? (
            <LanguageRow
              variant="dialog"
              modifier
              state="included"
              label={
                choice.modifier === "any"
                  ? message(intl, "criterion_modifier_values.any", "Any")
                  : message(intl, "criterion_modifier_values.none", "None")
              }
              onClick={() => {
                setChoice(withoutModifier(choice));
              }}
            />
          ) : null}
          {chosen.map((o) => (
            <LanguageRow
              key={"in-" + o.value}
              variant="dialog"
              state="included"
              label={o.label}
              flag={flagOf(o)}
              onClick={() => {
                setChoice(toggleIncluded(choice, o.value));
              }}
            />
          ))}
          {excludedChosen.map((o) => (
            <li key={"ex-" + o.value} className="excluded-object">
              <LanguageRow
                variant="dialog"
                state="excluded"
                label={o.label}
                flag={flagOf(o)}
                onClick={() => {
                  setChoice(toggleExcluded(choice, o.value));
                }}
              />
            </li>
          ))}
          {showModifiers ? (
            <LanguageRow
              variant="dialog"
              modifier
              state="candidate"
              canExclude={false}
              label={message(intl, "criterion_modifier_values.any", "Any")}
              onClick={() => {
                setChoice(withModifier(choice, "any"));
              }}
            />
          ) : null}
          {showModifiers ? (
            <LanguageRow
              variant="dialog"
              modifier
              state="candidate"
              canExclude={false}
              label={message(intl, "criterion_modifier_values.none", "None")}
              onClick={() => {
                setChoice(withModifier(choice, "none"));
              }}
            />
          ) : null}
          {candidates.map((o) => (
            <LanguageRow
              key={o.value}
              variant="dialog"
              state="candidate"
              label={o.label}
              flag={flagOf(o)}
              canExclude
              onClick={() => {
                setChoice(toggleIncluded(choice, o.value));
              }}
              onExclude={() => {
                setChoice(toggleExcluded(choice, o.value));
              }}
            />
          ))}
        </ul>
      </div>
    </div>
  );

  return (
    <>
      {host ? PluginApi.ReactDOM.createPortal(list, host) : null}
      {/* And, when the card has something Stash has no tag for, the tags of its
          own — one per condition, in the place Stash's would have been. */}
      {ownTagsRow
        ? PluginApi.ReactDOM.createPortal(
            ownTags.map((label, index) => (
              <LanguageTag
                key={index}
                label={label}
                onRemove={() => {
                  setChoice(EMPTY_SELECTION);
                  setQuery("");
                }}
              />
            )),
            ownTagsRow
          )
        : null}
    </>
  );
}

// Published on the namespace so the smoke tests can exercise the dialog's tag
// machinery without mounting the card itself.
NS.manageDialogTags = manageDialogTags;
NS.ownTagLabels = ownTagLabels;
NS.clickedTagRemove = clickedTagRemove;
