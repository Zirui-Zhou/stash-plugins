/**
 * 14: the bulk edit dialog — where its rows go, what they prefill with, and what
 * an Apply sends. Like 08, it waits for the plugin's first refresh.
 */

const assert = require("node:assert");
const {
  NS,
  call,
  callAfter,
  documentRoot,
  find,
  globalListeners,
  loggedErrors,
  makeEl,
  mutationWrites,
  patchedBefore,
  runSection,
  state,
} = require("../helpers.js");

module.exports = () => {
  // ── 14. Bulk edit dialog: the manga rows ride along with Apply ──
  // The rows' prefill comes from the plugin's gallery store, which only has data
  // once the refresh promise has settled — hence the timer this file runs in.
  //
  // Stand in for EditGalleriesDialog's form: BulkUpdateFormGroup renders each row
  // as a Bootstrap `.row` carrying data-field, so that is the anchor.
  const bulkForm = makeEl("form");
  documentRoot.appendChild(bulkForm);

  const bulkStudioRow = makeEl("div");
  bulkStudioRow.className = "row";
  bulkStudioRow.dataset.field = "studio";
  const bulkStudioLabel = makeEl("label");
  bulkStudioLabel.className = "col-form-label col-3";
  const bulkStudioControl = makeEl("div");
  bulkStudioControl.className = "col-9";
  bulkStudioRow.appendChild(bulkStudioLabel);
  bulkStudioRow.appendChild(bulkStudioControl);
  bulkForm.appendChild(bulkStudioRow);

  const bulkPerformerRow = makeEl("div");
  bulkPerformerRow.className = "row";
  bulkPerformerRow.dataset.field = "performers";
  bulkForm.appendChild(bulkPerformerRow);

  // The selection is read from GalleryList, which the plugin observes rather
  // than replaces.
  const selectGalleries = (ids) =>
    patchedBefore.GalleryList({ selectedIds: new Set(ids) }, undefined);

  // The rows are mounted by the RatingSystem patch; render the fragment it
  // returns and follow the portal it makes.
  // Stash's own rating control, as the `after` patch is handed it.
  const ratingResult = { type: "RatingSystem", props: {} };

  const bulkRow = () => {
    const frag = callAfter("RatingSystem", { value: 0 }, ratingResult);
    const rowEl = frag.props.children[1];
    return rowEl.type(rowEl.props);
  };

  // The component draws a fragment of [warning?, mark, language?, censorship?].
  // The nulls are dropped, so this is exactly the rows that are on screen.
  const bulkChildren = () => {
    const kids = bulkRow().node.props.children;
    return (Array.isArray(kids) ? kids : [kids]).filter(Boolean);
  };
  const selectOf = (inputId) =>
    find(bulkRow().node, (n) => n.props && n.props.inputId === inputId);
  const mangaBox = () =>
    find(
      bulkRow().node,
      (n) =>
        n.props &&
        n.props.id === "manga_tools_manga" &&
        n.props.type === "checkbox"
    );

  // The mark's tri-state. React has no `indeterminate` prop, so the plugin sets
  // it on the DOM node through the ref — probe it the way a real node would be.
  const mangaState = () => {
    const box = mangaBox();
    const probe = {};
    box.props.ref(probe);
    return {
      checked: box.props.checked,
      indeterminate: probe.indeterminate === true,
    };
  };

  const b14 = bulkRow();
  assert.strictEqual(
    b14.__portal,
    true,
    "the bulk rows should render through a portal"
  );

  const bulkHost = bulkForm.children[1];
  assert.strictEqual(bulkHost.className, "manga-tools-field-host");
  assert.strictEqual(
    bulkHost.previousElementSibling,
    bulkStudioRow,
    "the rows should go right after the studio row"
  );
  assert.strictEqual(
    bulkHost.nextElementSibling,
    bulkPerformerRow,
    "and right before the performers row — i.e. between studio and performers"
  );
  assert.strictEqual(b14.host, bulkHost);

  // The mark is native organized-style markup (form-group wrapping a form-check,
  // checkbox then label), not the grid columns the selects below use. Nothing is
  // selected yet, so only the mark is drawn.
  const markRow = bulkChildren()[0];
  assert.strictEqual(markRow.props.className, "form-group");
  assert.strictEqual(markRow.props["data-field"], "manga_tools_manga");
  const markCheck = markRow.props.children;
  assert.strictEqual(
    markCheck.props.className,
    "form-check",
    "the mark should be a native form-check like Stash's organized field"
  );
  const markLabel = markCheck.props.children[1];
  assert.strictEqual(
    markLabel.props.className,
    "form-check-label",
    "with the label after the checkbox"
  );
  assert.strictEqual(
    markLabel.props.children,
    "是否为漫画",
    "named as the question it asks about the galleries, not as the field"
  );

  // ── The mark is the gate ──
  // Nothing selected reads as "not manga", so only the mark is drawn — no fields,
  // no warning.
  selectGalleries([]);
  assert.strictEqual(
    bulkChildren().length,
    1,
    "an empty selection draws only the mark"
  );
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });

  // All-manga: the two fields appear, pre-filled from the selection. Gallery 1
  // and 6 are zh-Hans; 1 is censored, 6 has no censorship value.
  selectGalleries(["1", "6"]);
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  assert.deepStrictEqual(
    bulkChildren().map((r) => r.props["data-field"]),
    ["manga_tools_manga", "manga_tools_language", "manga_tools_censorship"],
    "an all-manga selection shows the mark and both fields, in order"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.value.value,
    "zh-Hans",
    "the whole selection agreeing should prefill that language"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.value.label,
    "简体中文",
    "in the UI language"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.placeholder,
    "选择语言…",
    "the placeholder is this plugin's own string, so it follows the UI language too"
  );
  assert.strictEqual(
    selectOf("manga_tools_language").props.menuPortalTarget,
    global.document.body,
    "the menu has to escape the modal"
  );
  assert.strictEqual(selectOf("manga_tools_language").props.isClearable, true);

  // Both selects carry the "remove" option as their last entry, distinct from the
  // clear button (clear = "leave alone", remove = "delete").
  const langOptions = selectOf("manga_tools_language").props.options;
  const censorOptions = selectOf("manga_tools_censorship").props.options;
  const langRemove = langOptions[langOptions.length - 1];
  const censorRemove = censorOptions[censorOptions.length - 1];
  assert.strictEqual(langRemove.label, "移除");
  assert.strictEqual(censorRemove.label, "移除");
  assert.strictEqual(
    langRemove.value,
    censorRemove.value,
    "the same sentinel value is used by both selects"
  );

  // Censorship prefills the same way: a single censored gallery.
  selectGalleries(["1"]);
  assert.strictEqual(
    selectOf("manga_tools_censorship").props.value.value,
    "censored",
    "a censored selection prefills"
  );

  // A mixed language selection must not prefill.
  selectGalleries(["1", "2"]);
  assert.strictEqual(selectOf("manga_tools_language").props.value, null);

  // ── The mixed cycle: keep → mark → unmark → keep ──
  // Gallery 8 is not manga (it is not even in the store), so 1+8 is mixed.
  selectGalleries(["1", "8"]);
  assert.deepStrictEqual(mangaState(), { checked: false, indeterminate: true });
  assert.strictEqual(
    bulkChildren().length,
    1,
    "a mixed selection draws no fields yet"
  );

  mangaBox().props.onChange(); // mark — the safe direction first
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  assert.strictEqual(bulkChildren().length, 3, "marking reveals the fields");

  mangaBox().props.onChange(); // unmark
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });
  {
    const rows = bulkChildren();
    assert.strictEqual(
      rows.length,
      2,
      "unmarking draws the warning above the mark"
    );
    assert.strictEqual(rows[0].props.className, "alert alert-warning");
    assert.ok(
      String(rows[0].props.children).includes("移除"),
      "the warning names removal"
    );
    assert.strictEqual(rows[1].props["data-field"], "manga_tools_manga");
  }

  mangaBox().props.onChange(); // back to keep
  assert.deepStrictEqual(mangaState(), { checked: false, indeterminate: true });

  // An all-manga selection toggles keep ↔ unmark (no indeterminate state).
  selectGalleries(["1", "6"]);
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  mangaBox().props.onChange(); // unmark
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });
  mangaBox().props.onChange(); // keep again
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });

  // A none selection toggles keep ↔ mark.
  selectGalleries(["8"]);
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });
  mangaBox().props.onChange(); // mark
  assert.deepStrictEqual(mangaState(), { checked: true, indeterminate: false });
  mangaBox().props.onChange(); // keep again
  assert.deepStrictEqual(mangaState(), {
    checked: false,
    indeterminate: false,
  });

  // ── Apply: the picked values ride along with the dialog's own update ──
  /** Runs an operation through the plugin's link and reports what came out */
  const runLink = (variables, rootField) => {
    let forwarded = null;
    let completed = null;
    const forward = (op) => {
      forwarded = op;
      return {
        map(fn) {
          completed = fn({ data: {} });
          return this;
        },
      };
    };
    state.installedLink.__chain[0].request(
      {
        query: {
          kind: "Document",
          definitions: [
            {
              kind: "OperationDefinition",
              selectionSet: {
                selections: [
                  { name: { value: rootField ?? "bulkGalleryUpdate" } },
                ],
              },
            },
          ],
        },
        variables,
      },
      forward
    );
    return { forwarded, completed };
  };

  const bulkVars = () => ({ input: { ids: ["1", "2"], photographer: "x" } });

  // The link is installed the first time the rows render, and must not disturb
  // the chain Stash already had.
  assert.ok(state.installedLink, "the bulk rows should install the link hook");
  assert.strictEqual(
    state.installedLink.__chain[1].__original,
    true,
    "the existing link chain must be passed through untouched"
  );

  // Untouched: nothing pending, so a bulk edit of photographers goes out exactly
  // as Stash built it.
  let r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "an untouched selection must not add custom_fields"
  );
  assert.strictEqual(
    r14.completed,
    null,
    "nothing to clear when nothing was injected"
  );

  // A successful write refetches the store, or the badges go stale. The refetch
  // itself is checked at the end, once the microtask queue has drained — see the
  // note beside that assertion. This first write's shape is the immediate result.
  selectGalleries(["1", "6"]);
  const queriesBefore = state.galleryQueryCount;
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.language": "ja" },
  });

  // ...and the pending value is dropped, so a second Apply does not repeat it.
  r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "the value should only ever be sent once"
  );

  // Language set.
  selectOf("manga_tools_language").props.onChange({
    value: "zh-Hant",
    label: "繁体中文",
    flag: "tw",
  });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.language": "zh-Hant" },
  });
  assert.deepStrictEqual(
    r14.forwarded.variables.input.ids,
    ["1", "2"],
    "the rest of the input must be left alone"
  );
  assert.strictEqual(r14.forwarded.variables.input.photographer, "x");

  // Language remove — the one way to empty the field across a whole selection.
  selectOf("manga_tools_language").props.onChange(langRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    remove: ["plugin.mangaTools.language"],
  });

  // Censorship set.
  selectOf("manga_tools_censorship").props.onChange({ value: "uncensored" });
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.censorship": "uncensored" },
  });

  // Censorship remove.
  selectOf("manga_tools_censorship").props.onChange(censorRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    remove: ["plugin.mangaTools.censorship"],
  });

  // Mark: a none selection unified to manga.
  selectGalleries(["8"]);
  mangaBox().props.onChange(); // mark
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.manga": "true" },
  });

  // Mark + set + remove can coexist in one input.
  selectGalleries(["8"]);
  mangaBox().props.onChange(); // mark
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  selectOf("manga_tools_censorship").props.onChange(censorRemove);
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: {
      "plugin.mangaTools.manga": "true",
      "plugin.mangaTools.language": "ja",
    },
    remove: ["plugin.mangaTools.censorship"],
  });

  // Unmark wins over the other two: every field this plugin owns is removed, and
  // the language/censorship pendings are ignored.
  selectGalleries(["1", "6"]);
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  selectOf("manga_tools_censorship").props.onChange({ value: "censored" });
  mangaBox().props.onChange(); // unmark
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    remove: [
      "plugin.mangaTools.language",
      "plugin.mangaTools.censorship",
      "plugin.mangaTools.manga",
    ],
  });

  // Other entities' bulk updates are never touched, even with a value pending.
  selectGalleries(["1", "6"]);
  selectOf("manga_tools_language").props.onChange({
    value: "ja",
    label: "日语",
    flag: "jp",
  });
  r14 = runLink(bulkVars(), "bulkSceneUpdate");
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "a scene bulk update must not be given a language"
  );

  // ...and the value survives that, so it is still applied to the right operation.
  r14 = runLink(bulkVars());
  assert.deepStrictEqual(r14.forwarded.variables.input.custom_fields, {
    partial: { "plugin.mangaTools.language": "ja" },
  });

  // Clearing the x means "leave the language alone", exactly as clearing the
  // studio field means "leave the studio alone" — neither sends a value.
  selectOf("manga_tools_language").props.onChange(null);
  r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "clearing must not write anything"
  );
  assert.strictEqual(r14.completed, null);

  // The route is checked by the injection itself, not only by the rows being
  // mounted: a value left pending must not be written once the route has moved on.
  selectOf("manga_tools_language").props.onChange({
    value: "ko",
    label: "韩语",
    flag: "kr",
  });
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/scenes/5" } } },
  });
  r14 = runLink(bulkVars());
  assert.strictEqual(
    r14.forwarded.variables.input.custom_fields,
    undefined,
    "a pending value must never be written once the route has left the galleries"
  );

  // Off a gallery page there is no row at all
  const onScene14 = callAfter("RatingSystem", { value: 0 }, ratingResult);
  assert.strictEqual(
    onScene14.props.children[1].type(onScene14.props.children[1].props),
    null,
    "no bulk manga rows on a scene page"
  );
  globalListeners["stash:location"]({
    detail: { data: { location: { pathname: "/galleries" } } },
  });
  assert.notStrictEqual(bulkRow(), null, "restored on a gallery page");
  console.log(
    "✓ bulk edit (placement / gate+cycle / prefill / set+remove+mark+unmark / scene isolation / one-shot / route)"
  );

  // The badges read the plugin's own store, so a successful write refetches it —
  // otherwise the covers keep the old flag until the next poll. That refetch is
  // deliberately deferred until any fetch already in flight has settled (a fetch
  // started before the write would otherwise land afterwards and undo it), so the
  // count can only be checked once the microtask queue has drained. Every write
  // above coalesced onto that one in-flight fetch, so there is exactly one
  // refetch no matter how many fields were applied.
  setTimeout(() => {
    runSection("14 the refetch it defers", () => {
      assert.strictEqual(
        state.galleryQueryCount,
        queriesBefore + 1,
        "a successful bulk update should refetch the gallery map, so the badges update"
      );
      console.log("✓ bulk edit refetch (deferred past the in-flight fetch)");
    });

    // The toolbar's writes defer the same way, and this is the only place to
    // check it: they cost two fetches of their own, so anything counting them has
    // to have finished first.
    //
    // Why it matters, in the words of the function that does it: a fetch built
    // before a write answers with the state before it, so letting that response
    // land afterwards puts back what the write just changed — a mark the reader
    // has just removed, or one they just made.
    //
    // One burst, so this is one refetch however many writes it holds: the clicks
    // happen together, their refetches are all deferred onto the fetch the last
    // navigation started, and the first of them to run starts a request the rest
    // then share. What is being asserted is that the fetch happens at all —
    // deliberately *not* one per write, which is not what the code does.
    const beforeToolbar = state.galleryQueryCount;
    for (const id of ["995", "996"]) {
      globalListeners["stash:location"]({
        detail: { data: { location: { pathname: `/galleries/${id}` } } },
      });
      const toolbar = call("CustomFields", {
        values: { [NS.FIELD_NAME]: "ja", other: "x" },
      }).props.children[2];
      const drawn = toolbar.type(toolbar.props);
      drawn.node.props.children[0].props.onClick();
    }

    setTimeout(() => {
      runSection("14b a write's refresh waits its turn", () => {
        assert.strictEqual(
          state.galleryQueryCount - beforeToolbar,
          2,
          "each write should wait for the fetch in flight and then fetch again — " +
            "one deduplicated fetch would be an answer from before the write"
        );
      });

      // A write that fails *before* it is sent — no client — has to refetch for
      // the same reason, only more so: the store was changed optimistically, the
      // server never heard, and a page left without this refresh keeps a mark
      // that does not exist. In its own burst, because a burst shares one
      // refetch (above) and so cannot tell this one from the others'.
      //
      // The baseline is taken before the navigation, which is itself a refresh.
      // The client is only missing for the click: the refresh it leads to is a
      // promise away, by which time a Stash without a client would have one
      // again — and a refresh that could not happen either way is not what this
      // is about.
      const beforeMissing = state.galleryQueryCount;
      const errorsBefore = loggedErrors.length;
      const writesBefore = mutationWrites.length;
      globalListeners["stash:location"]({
        detail: { data: { location: { pathname: "/galleries/994" } } },
      });
      const toolbar = call("CustomFields", {
        values: { [NS.FIELD_NAME]: "ja", other: "x" },
      }).props.children[2];
      state.clientMissing = true;
      toolbar.type(toolbar.props).node.props.children[0].props.onClick();
      state.clientMissing = false;

      setTimeout(() => {
        runSection("14c a write with no client says so, and refetches", () => {
          assert.strictEqual(
            mutationWrites.length,
            writesBefore,
            "with no client there is nothing to write with, so nothing is sent"
          );
          assert.strictEqual(
            state.galleryQueryCount - beforeMissing,
            2,
            "one fetch for the navigation and one to undo the optimistic mark — " +
              "a write with nowhere to go must not leave the store lying"
          );
          // The one symptom this failure has: the page cannot be told apart from
          // a successful write any other way.
          assert.ok(
            loggedErrors
              .slice(errorsBefore)
              .some((line) => /could not write the manga mark/.test(line)),
            "a write that could not be sent must be reported as one"
          );
        });

        // 14d. And the one refresh that is not a write's: opening the translation
        // group's menu asks for a fresh list, so that the name just saved is in it
        // rather than offered as a new one. Here rather than in section 08 because
        // what it costs is a query, and a query's timing is this section's subject.
        setTimeout(() => {
          runSection("14d opening the group menu refetches", () => {
            // The edit field is drawn on a gallery's page, and the section before
            // this one left the route on the list.
            globalListeners["stash:location"]({
              detail: { data: { location: { pathname: "/galleries/1" } } },
            });

            // Taken after the navigation, which is itself a refresh.
            const beforeOpen = state.galleryQueryCount;
            const { editField } = require("../renders.js");
            const block = editField({
              [NS.TRANSLATION_GROUP_FIELD_NAME]: "Lily",
            });
            const groupSelect = find(
              block.node,
              (n) => n.props?.inputId === "manga_tools_translation_group"
            );
            assert.ok(groupSelect, "the field should be on the edit page");
            groupSelect.props.onMenuOpen();

            setTimeout(() => {
              runSection("14d …and it asked", () => {
                assert.strictEqual(
                  state.galleryQueryCount - beforeOpen,
                  1,
                  "opening the menu should refetch the groups it is offering"
                );
              });
            }, 0);
          });
        }, 0);
      }, 0);
    }, 0);
  }, 0);
};
