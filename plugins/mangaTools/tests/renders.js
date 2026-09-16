/**
 * The two surfaces more than one section file drives.
 *
 * Both are called from a section that runs straight away and from one that waits
 * for the plugin's first refresh, so neither can live in the section that
 * happens to introduce it. `detail` renders what the plugin puts in the details
 * tab; `editField` what it puts in the edit form.
 *
 * The DOM each one's portal targets — the `.gallery-details` element, the edit
 * form — is built by 03-detail-edit.js, which has to have run before either is
 * called.
 */
const { asManga, call } = require("./helpers.js");

const detail = (values) => {
  const frag = call("CustomFields", {
    values: asManga(values),
    fullWidth: true,
  });
  const rest = frag.props.children[0].props.values;
  // children[1] is the guard around the panel; the panel is what returns the
  // portal. The guard is a class, so it is instantiated rather than called.
  const guarded = frag.props.children[1];
  const panelEl = guarded?.props?.children;
  return { rest, portal: panelEl ? panelEl.type(panelEl.props) : null };
};

const editField = (values, onChange) => {
  // children[0] is the guard around the row, and the row is what returns the
  // portal; the second child is the bulk-edit rows' own host.
  const el = call("CustomFieldsInput", {
    values: asManga(values),
    onChange: onChange || (() => {}),
  }).props.children[0];
  return el.type(el.props);
};

module.exports = { detail, editField };
