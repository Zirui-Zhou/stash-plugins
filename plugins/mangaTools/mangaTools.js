/**
 * Manga Tools — a toolbox that adapts Stash galleries to manga/comic management.
 *
 * Everything goes through the UI plugin API; no Stash core code is modified, so
 * Stash upgrades never produce merge conflicts.
 *
 * Features. There is one so far, and it lives in three places:
 *
 *   1. Language attribute
 *      - a flag badge on the bottom of the gallery card cover
 *      - a dropdown on the gallery edit page, so you never type a code by hand
 *      - a localised name (plus flag) on the gallery detail page, instead of the
 *        raw code
 *
 *      The value lives in the Gallery's custom fields (custom_fields.language).
 *      What is stored is the canonical code, not the display name, and the name
 *      is looked up only when rendering — the same approach Stash takes for
 *      performer nationality.
 *
 * New features should keep the same shape: a shared namespace on
 * window.MangaTools for data, and patches that hand anything they do not own
 * straight back to the original component.
 *
 * Depends on languages.js being loaded first (see the ui.javascript order in
 * mangaTools.yml).
 */
(function () {
  "use strict";

  var PluginApi = window.PluginApi;
  if (!PluginApi) {
    console.error("[mangaTools] PluginApi not ready, plugin not loaded");
    return;
  }

  var NS = window.MangaTools;
  if (!NS) {
    console.error("[mangaTools] languages.js not loaded, plugin not loaded");
    return;
  }

  var React = PluginApi.React;
  var h = React.createElement;
  var Fragment = React.Fragment;

  var FIELD_NAME = NS.FIELD_NAME;
  var REFRESH_MS = 60000;

  /**
   * Pulls the original component out of a patch.instead callback's arguments.
   *
   * The official example writes `function (props, _, original)`, but the number
   * of arguments passed depends on whether React supplies the legacy context, so
   * a hard-coded index can come back undefined. The last argument is always the
   * original component — reading it that way is safe either way.
   */
  function originalFrom(args) {
    return args[args.length - 1];
  }

  function argsToArray(args) {
    return Array.prototype.slice.call(args);
  }

  /**
   * Records the first time a patch is actually invoked.
   *
   * Patching a component name that does not exist does not raise an error — it
   * simply never runs, leaving no trace to debug from. (This really happened:
   * CustomField looks like a patchable component but is a plain React.FC.)
   * This log is direct evidence that a patch took effect; it fires once per
   * target.
   */
  var firedOnce = {};

  function noteFired(target) {
    if (firedOnce[target]) return;
    firedOnce[target] = true;
    console.info("[mangaTools] patch active: " + target);
  }

  // ───────────────────────────── State ─────────────────────────────

  /** galleryId (string) -> the raw language value from custom fields */
  var store = new Map();

  /** Subscribers: re-render when the store or the route changes */
  var listeners = new Set();

  var inFlight = null;
  var started = false;
  var lastLoggedSize = -1;

  /**
   * Current path. CustomFieldsInput is shared by every entity type, so this is
   * how we tell a gallery page apart from the rest.
   */
  var currentPath = window.location.pathname || "";

  function emit() {
    listeners.forEach(function (fn) {
      fn();
    });
  }

  function subscribe(fn) {
    listeners.add(fn);
    return function () {
      listeners.delete(fn);
    };
  }

  /** Subscribes to global state (data or route) and re-renders on change. */
  function useGlobalVersion() {
    var state = React.useState(0);
    var version = state[0];
    var setVersion = state[1];

    React.useEffect(function () {
      return subscribe(function () {
        setVersion(function (v) {
          return v + 1;
        });
      });
    }, []);

    return version;
  }

  /**
   * Only show the language dropdown on gallery edit panels.
   *
   * CustomFieldsInput is shared by the scene, performer, studio, tag and image
   * edit panels. Without this check the "language" field would show up on every
   * one of them. A gallery detail page is /galleries/{id}, and the bulk edit
   * dialog opens over the gallery list at /galleries.
   */
  function isGalleryContext() {
    return currentPath.indexOf("/galleries") === 0;
  }

  // ───────────────────── Reading and writing custom fields ─────────────────────

  /**
   * Reads the language value out of custom_fields. The field name is matched
   * case-insensitively.
   * @param {object|undefined} customFields
   * @returns {string} "" when there is no such field
   */
  function pickLanguage(customFields) {
    if (!customFields || typeof customFields !== "object") return "";

    var keys = Object.keys(customFields);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === FIELD_NAME) {
        var v = customFields[keys[i]];
        if (v === null || v === undefined) return "";
        return String(v);
      }
    }
    return "";
  }

  /**
   * Writes a new language value into custom_fields and returns the new object
   * (the input is not mutated). An empty value removes every case variant of the
   * key — matching the delete semantics of the native CustomFieldInput.
   */
  function setLanguage(customFields, code) {
    var next = Object.assign({}, customFields || {});
    Object.keys(next).forEach(function (k) {
      if (k.toLowerCase() === FIELD_NAME) delete next[k];
    });
    if (code) next[FIELD_NAME] = code;
    return next;
  }

  // ───────────────────────────── Fetching ─────────────────────────────

  /**
   * A Gallery's custom_fields is the GraphQL Map scalar, and a single key cannot
   * be projected out of it. So we filter for galleries that have a `language`
   * field and fetch the whole map, then keep it in memory.
   *
   * The field name must be lowercase `language` — that is what this plugin
   * writes. Matching both `language` and `Language` in one query is impossible:
   *   - OR is singular in the schema (OR: GalleryFilterType), not an array
   *   - multiple criteria inside the custom_fields array are ANDed, not ORed
   * So lowercase is a hard constraint, guaranteed by the dropdown. Reads remain
   * case-insensitive, so a capitalised key already in the library still renders.
   */
  var QUERY = null;

  function getQuery() {
    if (QUERY) return QUERY;

    var Apollo = PluginApi.libraries.Apollo;
    var gql =
      (Apollo && Apollo.gql) || (PluginApi.GQL && PluginApi.GQL.gql);
    if (!gql) {
      console.error("[mangaTools] gql not available, cannot build the query");
      return null;
    }

    QUERY = gql(
      [
        "query MangaToolsMap {",
        "  findGalleries(",
        "    gallery_filter: {",
        '      custom_fields: [{ field: "language", modifier: NOT_NULL }]',
        "    }",
        "    filter: { per_page: -1 }",
        "  ) {",
        "    count",
        "    galleries {",
        "      id",
        "      custom_fields",
        "    }",
        "  }",
        "}",
      ].join("\n")
    );

    return QUERY;
  }

  /** Refetches the language map. Concurrent calls share one in-flight request. */
  function refresh() {
    if (inFlight) return inFlight;

    var query = getQuery();
    if (!query) return Promise.resolve();

    var client;
    try {
      client = PluginApi.utils.StashService.getClient();
    } catch (e) {
      console.error("[mangaTools] failed to get the Apollo client:", e);
      return Promise.resolve();
    }

    inFlight = client
      .query({ query: query, fetchPolicy: "network-only" })
      .then(function (res) {
        var result = res && res.data && res.data.findGalleries;
        var galleries = (result && result.galleries) || [];

        var next = new Map();
        galleries.forEach(function (g) {
          var value = pickLanguage(g.custom_fields);
          if (value) next.set(String(g.id), value);
        });

        store = next;
        emit();

        // Only log when the count changes, so it does not spam every minute.
        // This line is the first thing to check when a badge does not show up:
        // if it says 0, the query worked but no gallery carries a language field,
        // so the problem is the data rather than the plugin.
        if (next.size !== lastLoggedSize) {
          lastLoggedSize = next.size;
          console.info(
            "[mangaTools] loaded language tags for " + next.size + " gallery(ies)"
          );
        }
      })
      .catch(function (e) {
        // Deliberately do not clear what we already have — stale values beat
        // none, and the next refresh will try again. Query syntax errors land
        // here too (Apollo throws GraphQL errors), so this log has to be loud.
        console.error(
          "[mangaTools] failed to fetch language data, badges will not show. Raw error:",
          e
        );
      })
      .then(function () {
        inFlight = null;
      });

    return inFlight;
  }

  function start() {
    if (started) return;
    started = true;

    refresh();

    // Saving an edit does not change the route, so a slow poll acts as a
    // backstop. The query only pulls id + custom_fields, so it is small.
    window.setInterval(function () {
      if (document.visibilityState === "visible") refresh();
    }, REFRESH_MS);

    if (PluginApi.Event && PluginApi.Event.addEventListener) {
      PluginApi.Event.addEventListener("stash:location", function (e) {
        var loc = e && e.detail && e.detail.data && e.detail.data.location;
        currentPath = (loc && loc.pathname) || window.location.pathname || "";
        refresh();
        // Tell subscribers to recompute isGalleryContext()
        emit();
      });
    }
  }

  // ─────────────────────── UI locale and flags ───────────────────────

  /**
   * Current Stash UI locale.
   *
   * Reads it through react-intl, exactly like CountryLabel does — the plugin
   * never guesses the user's language. This is a hook, so it must be called
   * inside a component body.
   */
  function useLocale() {
    return PluginApi.libraries.Intl.useIntl().locale;
  }

  /**
   * A regional flag.
   *
   * flag-icons' CSS is loaded globally by Stash (index.scss imports
   * `flag-icons/css/flag-icons.min.css`), so emitting `<span class="fi fi-jp">`
   * is all that is needed — no assets to ship.
   *
   * These are CSS-drawn flags, not emoji: Windows' Segoe UI Emoji has no flag
   * glyphs, so a flag emoji degrades into a pair of boxed letters there.
   */
  function Flag(props) {
    return h("span", {
      className:
        "fi fi-" + props.flag + (props.className ? " " + props.className : ""),
    });
  }

  // ─────────────────────────── Cover badge ───────────────────────────

  /** Reads the in-memory store only; issues no requests. */
  function LanguageBadge(props) {
    useGlobalVersion();
    var locale = useLocale();

    var info = NS.describe(store.get(String(props.galleryId)), locale);
    if (!info) return null;

    // Unknown values have no flag, so fall back to a grey text chip.
    if (!info.known) {
      return h(
        "div",
        { className: "manga-tools-badge is-unknown" },
        info.name
      );
    }

    return h(
      "div",
      { className: "manga-tools-badge", "aria-label": info.name },
      h(Flag, { flag: info.flag })
    );
  }

  // ─────────────────────────── Edit-page dropdown ───────────────────────────

  /** react-select is a namespace import on PluginApi.libraries; the component is its default export */
  var SELECT = null;

  function resolveSelect() {
    if (SELECT) return SELECT;

    var RS = PluginApi.libraries.ReactSelect;
    if (!RS) {
      console.error("[mangaTools] react-select not available");
      return null;
    }

    SELECT = RS.default || RS.Select || RS;
    return SELECT;
  }

  /**
   * Renders a dropdown option: flag plus localised name.
   * react-select calls this for both the menu item and the selected value, so
   * the two always look the same.
   */
  function formatLanguageOption(option) {
    return h(
      "span",
      { className: "manga-tools-option" },
      option.flag
        ? h(Flag, { flag: option.flag, className: "manga-tools-flag" })
        : null,
      h("span", null, option.label)
    );
  }

  /**
   * Copies the class names for each layer off the studio field's DOM.
   *
   * Column widths are deliberately not hard-coded: renderField's defaults differ
   * between Stash versions — develop uses { sm: 3, xl: 2 } while the build
   * actually running only had { sm: 3 }. The extra col-xl-2 made our label
   * column narrower than the native ones on wide screens, so nothing lined up.
   * Copying the class names that are already there is correct regardless of
   * version or breakpoint.
   *
   * Returns null when nothing can be read, and the caller falls back to a
   * conservative default.
   */
  function readNativeFieldClasses() {
    var anchor = document.querySelector('.form-group[data-field="studio_id"]');
    if (!anchor) return null;

    var label = anchor.querySelector("label");
    var control = label && label.nextElementSibling;
    if (!label || !control) return null;

    return {
      group: anchor.className,
      label: label.className,
      control: control.className,
    };
  }

  /**
   * The edit page's language field, rendered through a portal into the row
   * **right after the studio field**.
   *
   * Why an always-present field rather than replacing the existing language
   * input row: CustomFieldsInput only renders input rows for fields that already
   * exist, and a new gallery has no language row to replace. Typing the field
   * name and code by hand for every gallery would defeat the point of the
   * dropdown. The existing language row is suppressed by the CustomFieldInput
   * patch below, so there is never a duplicate.
   *
   * The structure mirrors Stash's renderField (utils/form.tsx) — see
   * readNativeFieldClasses for how the column widths are matched.
   */
  function LanguageRow(props) {
    useGlobalVersion();

    var intl = PluginApi.libraries.Intl.useIntl();
    var Select = resolveSelect();

    // The mount point is read during render (same approach as the detail page).
    // ensureFieldHost is idempotent and returns null when the anchor is absent.
    var host = isGalleryContext() ? ensureFieldHost() : null;

    var bump = React.useState(0)[1];

    // On first mount the studio row **has not been committed to the DOM yet**:
    // CustomFieldsInput sits at the very end of the edit form, so when it renders
    // React has only just built the elements and has not written them out. This
    // pass therefore cannot find the anchor. The effect runs after the commit,
    // when it can, and one extra render is all it takes.
    //
    // It only bumps when the mount point differs from the one used for this
    // render, so once things settle the condition is never true again and there
    // is no render loop.
    React.useEffect(function () {
      if (isGalleryContext() && ensureFieldHost() !== host) {
        bump(function (v) {
          return v + 1;
        });
      }
    });

    if (!isGalleryContext() || !Select || !host) return null;

    var current = NS.describe(props.value, intl.locale);
    var options = NS.languageOptions(intl.locale);

    // Keep an unrecognised current value in the list, otherwise picking
    // something else would make it unreachable.
    if (current && !current.known) {
      options = [
        { value: current.code, label: current.name, flag: null },
      ].concat(options);
    }

    var selected = current
      ? { value: current.code, label: current.name, flag: current.flag }
      : null;

    // Column widths come from the native field; this is the fallback.
    var cls = readNativeFieldClasses() || {
      group: "form-group row",
      label: "form-label col-form-label col-sm-3",
      control: "col-sm-9",
    };

    var field = h(
      // Plain div/label carrying the copied class names, rather than
      // Form.Group/Form.Label/Col: those components regenerate the width classes
      // from their own defaults, which is what broke the alignment before.
      "div",
      { className: cls.group, "data-field": "manga_tools_language" },
      h("label", { className: cls.label, htmlFor: "manga_tools_language" }, fieldLabel(intl)),
      h(
        "div",
        { className: cls.control },
        h(Select, {
          className: "manga-tools-select",
          classNamePrefix: "react-select",
          inputId: "manga_tools_language",
          isClearable: true,
          isSearchable: false,
          placeholder: "Select language…",
          value: selected,
          options: options,
          // react-select draws a vertical rule between the clear and expand
          // icons by default, and none of Stash's own dropdowns have it — its
          // Select.tsx sets components: { IndicatorSeparator: () => null } in
          // its default props, and CountrySelect and FilterSelect each strip it
          // too. Follow suit, so this field matches the ones above it.
          components: { IndicatorSeparator: () => null },
          // Flags are drawn with CSS and cannot live inside a plain-text label,
          // so the option has to be rendered here.
          formatOptionLabel: formatLanguageOption,
          // An empty value deletes the field, matching the native
          // onChange("", "") semantics.
          onChange: function (opt) {
            props.onChange(opt ? opt.value : "");
          },
        })
      )
    );

    return PluginApi.ReactDOM.createPortal(field, host);
  }

  // ───────────────────────────── Patch registration ─────────────────────────────

  // 1. The badge on the bottom of the gallery card cover.
  //
  //    The original component has to be rendered as a React element. Do not call
  //    original(props) directly the way the official example does —
  //    GalleryCard.Overlays uses useMemo internally, and calling it directly
  //    breaks the rules of hooks.
  PluginApi.patch.instead("GalleryCard.Overlays", function () {
    var args = argsToArray(arguments);
    var props = args[0];
    var Original = originalFrom(args);
    noteFired("GalleryCard.Overlays");

    var id = props.gallery && props.gallery.id;
    var value = id ? store.get(String(id)) : "";
    if (!value) return h(Original, props);

    return h(
      Fragment,
      null,
      h(Original, props),
      h(LanguageBadge, { galleryId: id })
    );
  });

  // 2. Edit page: render the language field (it portals itself after the studio
  //    row, so it contributes nothing at this position).
  PluginApi.patch.instead("CustomFieldsInput", function () {
    var args = argsToArray(arguments);
    var props = args[0];
    var Original = originalFrom(args);
    noteFired("CustomFieldsInput");

    return h(
      Fragment,
      null,
      h(LanguageRow, {
        value: pickLanguage(props.values),
        onChange: function (code) {
          props.onChange(setLanguage(props.values, code));
        },
      }),
      h(Original, props)
    );
  });

  // 3. Edit page: stop rendering the existing language input row, since the
  //    field above handles it now. Every other field goes straight back to the
  //    original component, so the plugin has zero effect on them.
  //
  //    isNew must pass through: that is the "new field" row, and the user may be
  //    in the middle of typing "language" as the field name. Returning null would
  //    make the whole row vanish mid-keystroke.
  PluginApi.patch.instead("CustomFieldInput", function () {
    var args = argsToArray(arguments);
    var props = args[0];
    var Original = originalFrom(args);
    noteFired("CustomFieldInput");

    var isLanguageField =
      props.field && String(props.field).toLowerCase() === FIELD_NAME;

    if (!props.isNew && isLanguageField) {
      return null;
    }

    return h(Original, props);
  });

  /** Class name of the detail row's mount point */
  var DETAIL_HOST_CLASS = "manga-tools-detail-host";

  /** The mount point. Held at module scope so a React re-render that drops it reuses the same node. */
  var detailHost = null;

  /**
   * Finds (creating if needed) the mount point for the detail-page language row.
   *
   * Why this touches the DOM: everything inside `.gallery-details` is a bare
   * <h6>. The only component there is PhotographerLink, and neither it nor its
   * parent GalleryDetailPanel is patchable, so React offers no insertion point.
   *
   * Appending to the end of `.gallery-details` puts the row after "photographer"
   * and before "details" — the latter belongs to renderDetails() in the next .row.
   */
  function ensureDetailHost() {
    var panel = document.querySelector(".gallery-details");
    if (!panel) {
      detailHost = null;
      return null;
    }

    if (!detailHost) {
      detailHost = document.createElement("div");
      detailHost.className = DETAIL_HOST_CLASS;
    }

    // A React re-render may push it earlier or drop it; keep it at the end.
    if (
      detailHost.parentNode !== panel ||
      panel.lastElementChild !== detailHost
    ) {
      panel.appendChild(detailHost);
    }

    return detailHost;
  }

  /** Class name of the edit field's mount point */
  var FIELD_HOST_CLASS = "manga-tools-field-host";

  /** As above, held at module scope so the same node is reused */
  var fieldHost = null;

  /**
   * Finds (creating if needed) the mount point for the edit-page language field,
   * positioned **right after the studio field's row**.
   *
   * Why not patch StudioSelect instead: it renders inside a `<Col>`, so anything
   * added there is nested inside that column and the label column no longer
   * lines up with the native fields. What is needed is a sibling field row, so
   * one has to be inserted into the DOM.
   *
   * Conveniently renderField leaves a data-field attribute on every row, which
   * makes a far more stable anchor than walking the structure.
   */
  function ensureFieldHost() {
    var anchor = document.querySelector('.form-group[data-field="studio_id"]');
    if (!anchor || !anchor.parentNode) {
      fieldHost = null;
      return null;
    }

    if (!fieldHost) {
      fieldHost = document.createElement("div");
      fieldHost.className = FIELD_HOST_CLASS;
    }

    // A React re-render may displace it; keep it directly after the studio row.
    // The reference node is nextElementSibling rather than nextSibling: it is
    // the same property the idempotency check above uses, and a stray whitespace
    // text node between the two does not change the position either way.
    if (
      fieldHost.parentNode !== anchor.parentNode ||
      anchor.nextElementSibling !== fieldHost
    ) {
      anchor.parentNode.insertBefore(fieldHost, anchor.nextElementSibling);
    }

    return fieldHost;
  }

  /**
   * Localised text for the "language" label.
   *
   * Reuses config.ui.language.heading straight out of Stash's own locale files.
   * It exists in **every** locale Stash ships (en-GB "Language", zh-CN "语言",
   * ja-JP "言語", …), so this gets all of Stash's UI languages for free instead
   * of maintaining a label table here.
   */
  function fieldLabel(intl) {
    return intl.formatMessage({
      id: "config.ui.language.heading",
      defaultMessage: "Language",
    });
  }

  /**
   * The detail page's language row, rendered through a portal into the mount
   * point above.
   *
   * A portal rather than writing DOM directly: the content stays under React's
   * control, so a UI language change updates it automatically, and the only
   * thing inserted by hand is an empty div.
   *
   * Rendered as an <h6> to match the "photographer" rows above it.
   */
  function DetailLanguageRow(props) {
    useGlobalVersion();

    var intl = PluginApi.libraries.Intl.useIntl();
    var info = NS.describe(props.value, intl.locale);
    if (!info) return null;

    // The mount point is synced during render. ensureDetailHost is idempotent
    // (find → create if missing → move back to the end) and always returns the
    // same node, so it never creates duplicates or triggers a render loop.
    //
    // A render-phase side effect is used here rather than state + useEffect: the
    // latter returns null first and re-renders after, which flashes every time
    // you open a gallery. Stash runs React 17, so there is no concurrent
    // rendering to be interrupted, and only our own node is touched — never a
    // sibling React manages.
    var host = ensureDetailHost();
    if (!host) return null;

    // Built piece by piece rather than as one string: the space between the flag
    // and the name is only added when there is a flag. Otherwise an unknown value
    // would render as "Language:  klingon" — two spaces.
    // The gap comes entirely from that space; the CSS adds no margin-right, so
    // the space before and after the flag match, and the row lines up with
    // "photographer: ..." above it.
    var children = [fieldLabel(intl) + ": "];
    if (info.flag) {
      children.push(
        h(Flag, { flag: info.flag, className: "manga-tools-flag" }),
        " "
      );
    }
    children.push(info.name);

    return PluginApi.ReactDOM.createPortal(
      h("h6", { className: "manga-tools-detail" }, children),
      host
    );
  }

  // 4. Detail page: show the language as "flag + localised name", positioned
  //    under "photographer".
  //
  //    Note the target is CustomFields (plural, the container), not CustomField —
  //    the latter is a plain React.FC with no PatchComponent wrapper, so patching
  //    it reports no error and simply never runs.
  //    The language entry is lifted out of `values` (otherwise it would be
  //    rendered twice) and everything else is handed to the original unchanged;
  //    DetailLanguageRow renders that one entry under "photographer".
  PluginApi.patch.instead("CustomFields", function () {
    var args = argsToArray(arguments);
    var props = args[0];
    var Original = originalFrom(args);
    noteFired("CustomFields");

    var values = props.values;
    if (!values || typeof values !== "object") return h(Original, props);

    var key = null;
    Object.keys(values).forEach(function (k) {
      if (key === null && k.toLowerCase() === FIELD_NAME) key = k;
    });
    if (key === null) return h(Original, props);

    var rest = Object.assign({}, values);
    delete rest[key];

    return h(
      Fragment,
      null,
      h(Original, Object.assign({}, props, { values: rest })),
      h(DetailLanguageRow, { value: values[key] })
    );
  });

  start();
})();
