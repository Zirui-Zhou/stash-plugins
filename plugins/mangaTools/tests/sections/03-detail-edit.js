/**
 * 8–9b: the two surfaces the plugin portals into Stash's own markup — the
 * details tab's block, and the edit form's row.
 */

const assert = require("node:assert");
const {
  NS,
  call,
  call2,
  documentRoot,
  find,
  galleryToolbarDom,
  globalListeners,
  hasText,
  makeEl,
  original,
  state,
} = require("../helpers.js");
const { detail, editField } = require("../renders.js");

module.exports = () => {
  // ── 8. CustomFieldInput isolation ──────────────────────────────────
  assert.strictEqual(
    call("CustomFieldInput", {
      field: "plugin.mangaTools.language",
      value: "zh-Hans",
    }),
    null,
    "an existing language row should render null"
  );
  assert.strictEqual(
    call("CustomFieldInput", {
      field: "plugin.mangaTools.Language",
      value: "x",
    }),
    null,
    "a capitalised field name should be recognised too"
  );
  assert.strictEqual(
    call("CustomFieldInput", {
      field: "plugin.mangaTools.language",
      isNew: true,
    }).type,
    original,
    "the isNew row must pass through, or it vanishes while the name is being typed"
  );
  assert.strictEqual(
    call("CustomFieldInput", { field: "author", value: "x" }).type,
    original,
    "other fields must go back to the original component"
  );
  assert.strictEqual(
    call2("CustomFieldInput", { field: "author" }).type,
    original,
    "reading the original as args[last] must survive the 2-argument call form"
  );
  console.log("✓ CustomFieldInput isolation (including the 2-argument form)");

  // ── 9. CustomFields detail page: lift our fields out, portal the panel into .gallery-details ──
  // The panel is gated on being on a gallery *page* and carrying a value: a
  // gallery with neither field draws nothing, so an unset value is kept quiet the
  // same way the rest of the plugin keeps it. A detail page for a scene, group or
  // performer has no `.gallery-details` and no id, so it gets nothing.
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries/1" } } },
  });
  // Mount a detail panel into the DOM stub to stand in for a gallery detail page
  const galleryPanel = makeEl("div");
  galleryPanel.className = "gallery-details";
  documentRoot.appendChild(galleryPanel);
  // The panel already holds a few rows rendered by Stash
  const stockH6 = makeEl("h6");
  galleryPanel.appendChild(stockH6);

  let r9 = detail({ "plugin.mangaTools.language": "zh-Hant", author: "x" });
  assert.deepStrictEqual(
    r9.rest,
    { author: "x" },
    "the language entry must be lifted out so it is not rendered twice"
  );
  assert.strictEqual(
    r9.portal.__portal,
    true,
    "should render through a portal"
  );

  // The mount point must land at the end of .gallery-details — after "photographer",
  // before "details".
  const host = galleryPanel.lastElementChild;
  assert.strictEqual(host.className, "manga-tools-detail-host");
  assert.strictEqual(host.parentNode, galleryPanel);
  assert.strictEqual(
    r9.portal.host,
    host,
    "the portal should render into this mount point"
  );

  // Content: a collapsible block whose rows are the <h6>s Stash draws around it
  assert.strictEqual(r9.portal.node.type, "div");
  assert.strictEqual(r9.portal.node.props.className, "manga-tools-panel");
  assert.ok(
    hasText(r9.portal.node, "漫画信息"),
    "headed with this plugin's own words for it, since Stash has none"
  );

  // The language row is the first .manga-tools-detail in the block — the same
  // class, and so the same font and spacing, as the rows it sits between.
  const langRow = find(
    r9.portal.node,
    (n) => n.props?.className === "manga-tools-detail"
  );
  assert.strictEqual(langRow.type, "h6", "drawn as its neighbours are");
  const rowFlag = find(langRow, (n) => /fi fi-/.test(n.props.className || ""));
  assert.strictEqual(rowFlag.props.className, "fi fi-tw manga-tools-flag");
  assert.ok(
    hasText(r9.portal.node, "繁体中文"),
    "the name should be localised"
  );
  assert.ok(
    hasText(r9.portal.node, "语言: "),
    "the label should come from Stash's locale files (zh-CN → 语言)"
  );

  // Spacing comes from a text space, not a CSS margin, so pin the text children
  // down. With a flag: "label + space" + flag + " " + name — equal gaps either side.
  assert.deepStrictEqual(
    langRow.props.children.filter((c) => typeof c === "string"),
    ["语言: ", " ", "繁体中文"]
  );

  // When a React re-render pushes the mount point earlier, it must be pulled back.
  galleryPanel.appendChild(makeEl("h6")); // stand in for another row React adds
  assert.strictEqual(
    galleryPanel.lastElementChild.tagName,
    "h6",
    "precondition: the mount point was displaced"
  );
  detail({ "plugin.mangaTools.language": "ja" });
  assert.strictEqual(
    galleryPanel.lastElementChild,
    host,
    "a re-render should pull it back to the end"
  );
  const hosts = galleryPanel.children.filter(
    (c) => c.className === "manga-tools-detail-host"
  );
  assert.strictEqual(
    hosts.length,
    1,
    "the mount point must not be created twice"
  );
  assert.strictEqual(hosts[0], host, "the same mount point should be reused");

  // A capitalised key should be lifted out too (field names are case-insensitive;
  // the value itself must still be canonical).
  r9 = detail({ "plugin.mangaTools.Language": "zh-Hant" });
  assert.deepStrictEqual(
    r9.rest,
    {},
    "a capitalised key should be lifted out too"
  );
  assert.ok(hasText(r9.portal.node, "繁体中文"));

  // Unknown value: no flag, text only — and no stray extra space
  r9 = detail({ "plugin.mangaTools.language": "klingon" });
  assert.strictEqual(
    find(r9.portal.node, (n) => /fi fi-/.test(n.props.className || "")),
    null,
    "an unknown value should have no flag"
  );
  assert.ok(hasText(r9.portal.node, "klingon"));
  const unknownRow = find(
    r9.portal.node,
    (n) => n.props?.className === "manga-tools-detail"
  );
  assert.deepStrictEqual(
    unknownRow.props.children.filter((c) => typeof c === "string"),
    ["语言: ", "klingon"],
    'without a flag there must not be a double space in "语言:  klingon"'
  );

  // Label i18n: follows the UI language, falls back to English
  state.currentLocale = "ja-JP";
  assert.ok(
    hasText(
      detail({ "plugin.mangaTools.language": "ja" }).portal.node,
      "言語: "
    ),
    "should follow the UI language"
  );
  state.currentLocale = "de-DE";
  assert.ok(
    hasText(
      detail({ "plugin.mangaTools.language": "ja" }).portal.node,
      "Language: "
    ),
    "should fall back to English for a locale without the key"
  );
  state.currentLocale = "zh-CN";

  // Neither of our fields set: no panel at all — a fold whose only content is its
  // own heading is not worth a line, and the unset value stays quiet.
  r9 = detail({ author: "x" });
  assert.deepStrictEqual(
    r9.rest,
    { author: "x" },
    "nothing of ours to lift out"
  );
  assert.strictEqual(
    r9.portal,
    null,
    "with no value there is no panel to draw"
  );
  assert.ok(call("CustomFields", {}), "empty values must not throw");
  assert.ok(call("CustomFields", {}), "missing values must not throw");

  // Not on a gallery detail page (no .gallery-details): render nothing, do not throw
  galleryPanel.parentNode.children.splice(
    galleryPanel.parentNode.children.indexOf(galleryPanel),
    1
  );
  assert.strictEqual(
    detail({ "plugin.mangaTools.language": "ja" }).portal,
    null,
    "with no mount point it should safely return null"
  );
  documentRoot.appendChild(galleryPanel);
  console.log(
    "✓ detail page (lift out / portal target / pull back / label i18n / unknown / no mount point)"
  );

  // ── 9b. Edit page: the language field portals between studio and performers ──
  // Stand in for the edit form: studio row → performer row, with data-field as the anchor
  const editForm = makeEl("form");
  documentRoot.appendChild(editForm);

  const studioRow = makeEl("div");
  studioRow.className = "form-group row";
  studioRow.dataset.field = "studio_id";
  editForm.appendChild(studioRow);

  // The native field's label and control — the plugin copies their class names
  const studioLabel = makeEl("label");
  studioLabel.className = "form-label col-form-label col-sm-3";
  const studioControl = makeEl("div");
  studioControl.className = "col-sm-9";
  studioRow.appendChild(studioLabel);
  studioRow.appendChild(studioControl);

  const performerRow = makeEl("div");
  performerRow.className = "form-group row";
  performerRow.dataset.field = "performer_ids";
  editForm.appendChild(performerRow);

  const fieldPortal = editField({ "plugin.mangaTools.language": "ja" });
  assert.strictEqual(
    fieldPortal.__portal,
    true,
    "should render through a portal into the edit form"
  );

  const fieldHostEl = editForm.children[1];
  assert.strictEqual(
    fieldHostEl.className,
    "manga-tools-field-host hide-performers",
    "the mount point should carry the class that hides the performers row — " +
      "this is a manga gallery's edit page, and that is the default"
  );
  assert.strictEqual(
    fieldHostEl.previousElementSibling,
    studioRow,
    "the mount point should come right after the studio row"
  );
  assert.strictEqual(
    fieldHostEl.nextElementSibling,
    performerRow,
    "and right before the performer row — i.e. between studio and performers"
  );
  assert.strictEqual(fieldPortal.host, fieldHostEl);

  // Hiding the field is the whole of it: the row Stash drew is still there, still
  // holding its value, which is what stops a manga gallery that does have
  // performers from losing them when it is saved. The rule that hides it is in the
  // stylesheet — asserted in 10–10b — and needs this class and that row to be
  // siblings, which is the placement just above.
  assert.deepStrictEqual(
    performerRow.attributes,
    {},
    "the row itself must be left exactly as Stash rendered it — nothing of this " +
      "plugin's is written onto it, so nothing here can clear its value"
  );

  // With the setting off, Stash's field is back
  NS.hidePerformers = false;
  editField({ "plugin.mangaTools.language": "ja" });
  assert.strictEqual(
    fieldHostEl.className,
    "manga-tools-field-host",
    "and the class goes when the reader asks for the field back"
  );
  NS.hidePerformers = true;

  // What is portalled is the block — a header row and, below it, the field row.
  assert.strictEqual(fieldPortal.node.props.className, "manga-tools-panel");
  assert.ok(
    hasText(fieldPortal.node, "漫画信息"),
    "the block is headed like the one in the details tab"
  );
  assert.ok(
    hasText(fieldPortal.node, "语言"),
    "and the field row is in it, since that is what the header folds"
  );

  // Field structure: every class name is copied from the native field rather than
  // generated, so the column widths can never drift. The row is not *wrapped* by
  // the fold — it is shown or not shown by it — so its parent is still the mount
  // point whose `display: contents` lets the row's negative margins cancel against
  // the form's column.
  const fg = find(
    fieldPortal.node,
    (n) => n.props?.["data-field"] === "manga_tools_language"
  );
  assert.strictEqual(fg.type, "div");
  assert.strictEqual(fg.props.className, "form-group row");

  // This is a bug this project hit: xl:2 / xl:7 used to be hard-coded, but the
  // Stash build actually running has no xl in its defaults, so the label column
  // came out narrower than the native ones on wide screens and never lined up.
  // Copying the native class names matches whatever they happen to be.
  const labelEl = fg.props.children[0];
  assert.strictEqual(labelEl.type, "label");
  assert.strictEqual(
    labelEl.props.className,
    "form-label col-form-label col-sm-3",
    "the label classes should be copied verbatim (no extra col-xl-2)"
  );
  assert.strictEqual(labelEl.props.htmlFor, "manga_tools_language");
  assert.strictEqual(
    labelEl.props.children,
    "语言",
    "the label should come from Stash's locale files"
  );

  const controlEl = fg.props.children[1];
  assert.strictEqual(controlEl.type, "div");
  assert.strictEqual(
    controlEl.props.className,
    "col-sm-9",
    "the control classes should be copied verbatim (no extra col-xl-7)"
  );

  // When the native field changes width, follow it. The field row is looked up
  // inside the block rather than taken as its first child — the header row comes
  // first now.
  const fieldRowIn = (portal) =>
    find(
      portal.node,
      (n) => n.props?.["data-field"] === "manga_tools_language"
    );

  studioLabel.className = "form-label col-form-label col-xl-12 col-sm-3";
  studioControl.className = "col-xl-12 col-sm-9";
  const followed = fieldRowIn(
    editField({ "plugin.mangaTools.language": "ja" })
  );
  assert.strictEqual(
    followed.props.children[0].props.className,
    "form-label col-form-label col-xl-12 col-sm-3",
    "should follow the native field's widths"
  );
  assert.strictEqual(
    followed.props.children[1].props.className,
    "col-xl-12 col-sm-9"
  );
  studioLabel.className = "form-label col-form-label col-sm-3";
  studioControl.className = "col-sm-9";

  // Anchor present but unreadable internals: fall back to the default, do not throw
  studioRow.detach(studioLabel);
  studioRow.detach(studioControl);
  assert.strictEqual(
    fieldRowIn(editField({ "plugin.mangaTools.language": "ja" })).props
      .children[1].props.className,
    "col-sm-9",
    "should fall back to the default when the native classes cannot be read"
  );
  studioRow.appendChild(studioLabel);
  studioRow.appendChild(studioControl);

  // The dropdown itself
  const editSelect = find(fg, (n) => n.props?.options);
  assert.strictEqual(editSelect.props.value.value, "ja");
  assert.strictEqual(editSelect.props.value.flag, "jp");
  // The order is asserted in 5b; here it is only the selected value echoing back.
  assert.strictEqual(
    editSelect.props.options.find((o) => o.value === "ja").label,
    "日语"
  );

  // Appearance must match Stash's own dropdowns: no default separator rule, and
  // the same theme prefix
  assert.strictEqual(
    typeof editSelect.props.components.IndicatorSeparator,
    "function",
    "the react-select IndicatorSeparator should be removed (Stash's Select.tsx does the same)"
  );
  assert.strictEqual(editSelect.props.components.IndicatorSeparator(), null);
  assert.strictEqual(
    editSelect.props.classNamePrefix,
    "react-select",
    "should reuse Stash's react-select theme prefix"
  );
  assert.strictEqual(
    editSelect.props.inputId,
    "manga_tools_language",
    "should pair with the label's for"
  );

  // When a React re-render displaces the mount point, pull it back after studio
  editForm.insertBefore(makeEl("div"), performerRow);
  editField({ "plugin.mangaTools.language": "ja" });
  assert.strictEqual(
    fieldHostEl.previousElementSibling,
    studioRow,
    "a re-render should pull it back"
  );
  const fieldHosts = editForm.children.filter((c) =>
    c.classList.contains("manga-tools-field-host")
  );
  assert.strictEqual(
    fieldHosts.length,
    1,
    "the mount point must not be created twice"
  );

  // Nothing renders off a gallery page
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/scenes/5" } } },
  });
  assert.strictEqual(
    editField({ "plugin.mangaTools.language": "ja" }),
    null,
    "no language field on a scene page"
  );
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries/1" } } },
  });
  assert.notStrictEqual(
    editField({ "plugin.mangaTools.language": "ja" }),
    null,
    "restored when back on a gallery page"
  );

  // No studio anchor: return null safely, do not throw
  const firstChild = editForm.children[0];
  editForm.detach(studioRow);
  assert.strictEqual(
    editField({ "plugin.mangaTools.language": "ja" }),
    null,
    "with no studio field it should safely return null"
  );
  editForm.insertBefore(studioRow, firstChild);
  console.log(
    "✓ edit page (target between studio and performers / widths copied / pull back / no anchor)"
  );

  // ── 9c. The switch, before the plugin's own answer arrives ─────────
  //
  // The store is null until the first fetch settles, and this section runs
  // before that (see smoke.js). Null is *not* an answer, so the switch falls
  // back to the custom fields Stash handed the page — the old behaviour, kept
  // deliberately for this one window. Reading null as "nothing is manga" would
  // draw an unmarked switch on a marked gallery for as long as the fetch takes,
  // which is a flicker the reader sees.
  //
  // Both ways, and the unmarked one is what makes this test mean something:
  // gallery 1 *is* in the fixture map, so a switch reading the store here would
  // say marked no matter what the values hold. This asserting false is the
  // proof that the values are what it read.
  galleryToolbarDom();
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries/1" } } },
  });

  const switchFor = (fields) => {
    const el = call("CustomFields", { values: fields }).props.children[2];
    return el.type(el.props).node.props.children[0];
  };
  assert.strictEqual(
    switchFor({
      [NS.FIELD_NAME]: "ja",
      "plugin.mangaTools.manga": "true",
    }).props["aria-pressed"],
    true,
    "before the store answers, the values Stash handed in are what the switch reads"
  );
  assert.strictEqual(
    switchFor({ [NS.FIELD_NAME]: "ja" }).props["aria-pressed"],
    false,
    "…and an unmarked gallery reads unmarked the same way"
  );
  assert.strictEqual(
    switchFor({ [NS.FIELD_NAME]: "ja" }).props.className,
    "minimal manga-tools-manga-toggle btn btn-secondary",
    "which is also what decides the state class the CSS colours"
  );
  console.log(
    "✓ the switch before the store answers (falls back to Stash's values)"
  );
};
