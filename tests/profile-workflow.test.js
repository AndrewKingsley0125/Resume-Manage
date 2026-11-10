const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const workflow = require('../src/shared/profile-workflow');

test('legacy profiles use manual mode and saved links are normalized safely', () => {
  for (const value of [undefined, null, '', 'auto', 'manual']) assert.equal(workflow.normalizeMode(value), 'manual');
  assert.equal(workflow.normalizeMode('extension'), 'extension');
  assert.deepEqual(workflow.normalizeJobLinks(['https://example.com/job', null, 'javascript:alert(1)', 'https://example.com/job']), ['https://example.com/job']);
  assert.equal(workflow.MAX_EXTENSIONS, 8);
});

test('job links preserve query parameters, remove duplicates, and reject invalid input', () => {
  assert.deepEqual(workflow.parseJobLinks(' https://example.com/job?id=1&source=a\r\n\nhttps://example.com/job?id=1&source=a\nhttps://example.com/job?id=2'), ['https://example.com/job?id=1&source=a', 'https://example.com/job?id=2']);
  assert.deepEqual(workflow.parseJobLinks('  \n'), []);
  for (const bad of ['invalid', 'file:///tmp/job', 'javascript:alert(1)', 'https://user:secret@example.com']) {
    assert.throws(() => workflow.parseJobLinks('https://example.com/job\n' + bad), /Line 2/);
  }
});

function dashboard() {
  const elements = new Map();
  const node = () => ({value:'',textContent:'',hidden:false,disabled:false,children:[],events:{},
    addEventListener(name, callback) {this.events[name] = callback;},
    append(...items) {this.children.push(...items);},
    replaceChildren(...items) {this.children = items;},
  });
  const element = id => {if (!elements.has(id)) elements.set(id, node());return elements.get(id);};
  const context = {window:{App:{ProfileWorkflow:workflow}},document:{getElementById:element,createElement:node}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/renderer/extension-workspace'), 'utf8'), context);
  return {element, api:context.window.App.ExtensionWorkspace};
}

test('extension dashboard has eight unlinked slots and isolates profile job lists', async () => {
  const d = dashboard(), writes = [];
  d.api.open({id:'one',firstName:'One',extensionJobLinks:[]}, async links => writes.push(links));
  assert.equal(d.element('extension-slots').children.length, 8);
  assert.equal(d.element('extension-connected-count').textContent, '0 / 8');
  d.element('extension-job-links').value = 'https://example.com/job';
  await d.element('extension-save-links').events.click();
  assert.deepEqual(writes, [['https://example.com/job']]);
  assert.equal(d.element('extension-job-count').textContent, '1');
  d.api.close();
  d.api.open({id:'two',firstName:'Two'}, async () => {});
  assert.equal(d.element('extension-job-links').value, '');
  assert.equal(d.element('extension-job-count').textContent, '0');
});

test('invalid links and save failures do not become saved jobs', async () => {
  const d = dashboard(); let writes = 0;
  d.api.open({}, async () => {writes++; throw new Error('Disk unavailable');});
  d.element('extension-job-links').value = 'not a url';
  await d.element('extension-save-links').events.click();
  assert.equal(writes, 0);
  assert.match(d.element('extension-links-status').textContent, /Line 1/);
  d.element('extension-job-links').value = 'https://example.com/job';
  await d.element('extension-save-links').events.click();
  assert.equal(d.element('extension-links-status').textContent, 'Disk unavailable');
  assert.equal(d.element('extension-job-count').textContent, '0');
  assert.equal(d.element('extension-save-links').disabled, false);
});

test('late save completion cannot overwrite another profile dashboard', async () => {
  const d = dashboard(); let finish;
  d.api.open({id:'one'}, () => new Promise(resolve => {finish = resolve;}));
  d.element('extension-job-links').value = 'https://example.com/job';
  const pending = d.element('extension-save-links').events.click();
  d.api.close();
  d.api.open({id:'two'}, async () => {});
  finish(); await pending;
  assert.equal(d.element('extension-job-count').textContent, '0');
  assert.equal(d.element('extension-job-links').value, '');
  assert.equal(d.element('extension-links-status').textContent, '');
});
