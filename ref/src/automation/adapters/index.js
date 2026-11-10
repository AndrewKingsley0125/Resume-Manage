// Site adapter registry.
//
// Adapter contract:
//   id                                   string
//   matches(url: URL)                    boolean
//   extractJob(page)                     { title, company, location, remote, description, source }
//   openApplication(page, cursor)        page holding the form (may be a popup)
//   scan(page)                           fields (see form-scanner.js); field.done = filled in an earlier pass
//   markFilled(page)                     mark scanned fields as handled before rescanning for follow-ups
//   fill(page, field, value, cursor)     void
//   nextStep(page, cursor)               true if it moved to another step
//   findSubmit(page)                     Locator | null
//
// Site adapters (greenhouse, lever, workday, ...) spread `generic` and
// override what differs. They are added once real samples are analyzed.
const generic = require('./generic');

const adapters = [
  require('./greenhouse'),
  require('./ashby'),
  require('./rippling'),
  require('./recruiterflow'),
  require('./bamboohr'),
  require('./dover'),
  require('./gem'),
  require('./comeet'),
  require('./deel'),
  require('./lever'),
  require('./workable'),
  require('./workday'),
  generic,
];

function pickAdapter(url) {
  const u = new URL(url);
  return adapters.find(a => a.matches(u));
}

module.exports = { pickAdapter, adapters };
