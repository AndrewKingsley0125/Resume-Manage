const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_EXTENSIONS, parseJobLinks } = require('../shared/profile-workflow');
const { normalize: applicationDetails } = require('../shared/application-profile');
const PORT = 17373;
const originPattern = /^chrome-extension:\/\/[a-p]{32}$/;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const text = (value, limit = 200000) => typeof value === 'string' ? value.slice(0, limit) : '';

function createExtensionBridge({statePath, getProfiles, buildPrompt, exportResume, now = Date.now}) {
  let state = {connections:[], jobs:[]};
  let server = null, error = '', pairingCode = crypto.randomBytes(16).toString('hex');
  const busy = new Set();
  const eventWaiters = new Map();
  if (statePath && fs.existsSync(statePath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      if (Array.isArray(saved.connections) && Array.isArray(saved.jobs)) state = saved;
    } catch (_) { error = 'Saved extension state could not be read.'; }
  }
  state.connections.forEach(c => {c.lastSeen = 0;});
  function persist() {
    if (!statePath) return;
    const tmp = statePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), {encoding:'utf8', mode:0o600});
    fs.renameSync(tmp, statePath);
  }
  function profileFor(job) {
    const profile = getProfiles().find(p => p.id === job.profileId);
    if (!profile) throw fail('Profile no longer exists.', 404);
    return profile;
  }
  const safeConnection = c => ({id:c.id, name:c.name, connected:c.lastSeen > 0 && now() - c.lastSeen < 90000, lastSeen:c.lastSeen});
  const summary = job => ({id:job.id, profileId:job.profileId, connectionId:job.connectionId, url:job.url, company:job.company || '', title:job.title || '', status:job.status, completedAt:job.completedAt || null, exported:!!job.files, error:job.error || ''});
  function dashboard() {
    return {port:PORT, running:!!server && server.listening, error, pairingCode, maxConnections:MAX_EXTENSIONS,
      connections:state.connections.map(safeConnection), jobs:state.jobs.map(summary)};
  }
  function assign(profileId, url, connectionId, style = {}) {
    if (!server || !server.listening) throw fail('The local extension service is offline.');
    const profile = getProfiles().find(p => p.id === profileId);
    if (!profile || profile.applicationMode !== 'extension') throw fail('Choose an extension-mode profile.');
    const links = parseJobLinks(url);
    if (links.length !== 1 || !(profile.extensionJobLinks || []).includes(links[0])) throw fail('Save this job link on the profile first.');
    if (!state.connections.some(c => c.id === connectionId)) throw fail('Select a linked extension.');
    if (state.jobs.some(j => j.profileId === profileId && j.url === links[0] && !['completed','unlinked'].includes(j.status))) throw fail('This job is already assigned.');
    if (!style || typeof style !== 'object' || Array.isArray(style)) style = {};
    const job = {id:crypto.randomUUID(), profileId, connectionId, url:links[0], status:'assigned', createdAt:now(), style};
    state.jobs.push(job);persist();
    for (const finish of [...(eventWaiters.get(connectionId) || [])]) finish();
    return summary(job);
  }
  function unlink(id) {
    state.connections = state.connections.filter(c => c.id !== id);
    for (const job of state.jobs) if (job.connectionId === id && job.status !== 'completed') job.status = 'unlinked';
    persist();
    for (const finish of [...(eventWaiters.get(id) || [])]) finish();
    return true;
  }
  function pair(body, origin) {
    if (body.code !== pairingCode) throw fail('Pairing code is invalid. Copy the current code from Resume Manager.', 403);
    if (state.connections.length >= MAX_EXTENSIONS) throw fail('All 8 extension slots are linked. Unlink one in the app first.', 409);
    const token = crypto.randomBytes(32).toString('hex');
    const client = {id:crypto.randomUUID(), name:text(body.name, 80).trim() || 'Chrome extension', origin, tokenHash:digest(token), lastSeen:now()};
    state.connections.push(client);persist();return {id:client.id, token};
  }
  function authenticate(req, origin) {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const hash = digest(token);
    // Chrome omits Origin on some extension GET requests. Those still require the paired bearer token.
    const client = state.connections.find(c => (c.origin === origin || !origin && req.method === 'GET') && c.tokenHash === hash);
    if (!client) throw fail('Extension is not linked. Pair with the app again.', 401);
    client.lastSeen = now();return client;
  }
  function questionProfile(profile) {
    return Object.fromEntries(['firstName','lastName','location','email','phone','linkedin','github','workHistory','education','certifications'].map(key => [key,profile[key] || '']).concat([['applicationDetails',applicationDetails(profile.applicationDetails)]]));
  }
  function detail(job) {
    const profile = profileFor(job);
    let prompt = '';
    if (job.jd) {
      const base = buildPrompt(profile);
      prompt = base.includes('[PASTE THE JOB DESCRIPTION HERE]') ? base.replace('[PASTE THE JOB DESCRIPTION HERE]', () => job.jd) : base + '\n\nJOB DESCRIPTION:\n' + job.jd;
    }
    return {...summary(job), jd:job.jd || '', resumePrompt:prompt, profile:questionProfile(profile), resume:job.resume || null,
      files:job.files ? {pdf:job.files.path, docx:job.files.docxPath, jd:job.files.jdPath} : null};
  }
  async function action(client, id, kind, body) {
    const job = state.jobs.find(j => j.id === id && j.connectionId === client.id);
    if (!job) throw fail('Assigned job not found.', 404);
    if (kind === 'detail') return detail(job);
    if (kind === 'docx') {
      const file=job.files && job.files.docxPath;
      if(!file)throw fail('Generate and export the resume DOCX first.',409);
      const absolute=path.resolve(file);
      if(path.extname(absolute).toLowerCase()!=='.docx')throw fail('This job has no generated DOCX.',409);
      if(job.files.folder && path.dirname(absolute)!==path.resolve(job.files.folder))throw fail('Invalid generated-file location.',403);
      let stat;try{stat=fs.lstatSync(absolute);}catch(_){throw fail('Generated DOCX no longer exists. Export it again.',404);}
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size>10*1024*1024)throw fail('Generated DOCX is not available for upload.',409);
      return {name:'resume.docx',type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',base64:fs.readFileSync(absolute).toString('base64')};
    }
    if (job.status === 'completed') throw fail('Application already marked ended.', 409);
    if (busy.has(id)) throw fail('Another operation for this job is in progress.', 409);
    if (kind === 'jd') {
      if (job.files) throw fail('Files already exported. Start a new assignment to change its JD.', 409);
      if (!text(body.description).trim()) throw fail('Job description is empty.');
      job.jd = text(body.description).trim();job.company = text(body.company, 250).trim();job.title = text(body.title, 250).trim();
      job.status = 'jd-received';job.error = '';persist();return detail(job);
    }
    if (kind === 'resume') {
      if (!job.jd) throw fail('Send the job description first.');
      if (job.files) throw fail('Files are already exported for this job.', 409);
      busy.add(id);
      try {
        const result = await exportResume(profileFor(job), text(body.response), job);
        if (!result || result.error) throw fail(result && result.error || 'Resume export failed.');
        job.files = result.files;job.resume = result.resume;job.status = 'resume-exported';job.error = '';persist();return detail(job);
      } catch (e) {job.error = e.message;persist();throw fail(e.message, e.status || 400);} finally {busy.delete(id);}
    }
    if (kind === 'status') {
      if (!['tabs-opened','tabs-ready','questions-scanned','answers-reviewed','filled'].includes(body.status)) throw fail('Invalid job status.');
      job.status = body.status;persist();return summary(job);
    }
    if (kind === 'complete') {
      if (body.confirmed !== true) throw fail('Confirm manually that the application ended.');
      job.status = 'completed';job.completedAt = now();persist();return summary(job);
    }
    throw fail('Unknown operation.', 404);
  }
  function clientState(client) {
    const jobs = state.jobs.filter(j => j.connectionId === client.id);
    return {client:safeConnection(client),jobs:jobs.map(summary),cursor:jobs.at(-1)?.id || ''};
  }
  function waitForAssignment(client, res) {
    return new Promise(resolve => {
      const waiting = eventWaiters.get(client.id) || new Set();
      eventWaiters.set(client.id,waiting);
      let timer;
      const finish = () => {
        clearTimeout(timer);waiting.delete(finish);res.removeListener('close',finish);
        if (!waiting.size) eventWaiters.delete(client.id);
        resolve();
      };
      waiting.add(finish);res.once('close',finish);timer = setTimeout(finish,20000);
    });
  }
  async function handle(req, res) {
    const origin = req.headers.origin || '';
    const reply = (status, data) => {res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      if (!originPattern.test(origin) && !(req.method === 'GET' && !origin)) throw fail('Only paired Chrome extensions may use this service.', 403);
      if (!/^127\.0\.0\.1:\d+$/.test(req.headers.host || '')) throw fail('Invalid host.', 403);
      if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      if (req.method === 'OPTIONS') {res.writeHead(204);res.end();return;}
      let body = {};
      if (req.method === 'POST') {
        let size = 0; const chunks = [];
        for await (const chunk of req) {size += chunk.length;if (size > 1024 * 1024) throw fail('Request too large.', 413);chunks.push(chunk);}
        try {body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');} catch (_) {throw fail('Invalid JSON.');}
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw fail('Invalid request body.');
      }
      if (req.url === '/v1/pair' && req.method === 'POST') return reply(200, pair(body, origin));
      const client = authenticate(req, origin);
      if (req.url === '/v1/state' && req.method === 'GET') return reply(200, clientState(client));
      const eventUrl = new URL(req.url,'http://127.0.0.1');
      if (eventUrl.pathname === '/v1/events' && req.method === 'GET') {
        const cursor = eventUrl.searchParams.get('after') || '';
        if (clientState(client).cursor === cursor) await waitForAssignment(client,res);
        if (res.destroyed) return;
        if (!state.connections.some(c => c.id === client.id)) throw fail('Extension was unlinked.',401);
        client.lastSeen = now();
        return reply(200,clientState(client));
      }
      const match = /^\/v1\/jobs\/([a-f0-9-]+)(?:\/(jd|resume|status|complete|docx))?$/.exec(req.url);
      if (!match || req.method !== (!match[2] || match[2]==='docx' ? 'GET' : 'POST')) throw fail('Unknown endpoint.', 404);
      return reply(200, await action(client, match[1], match[2] || 'detail', body));
    } catch (e) {reply(e.status || 500, {error:e.status ? e.message : 'Local extension service failed. See the app log.'});if (!e.status) console.error('Extension bridge:', e);}
  }
  async function start(port = PORT) {
    if (server) return;
    server = http.createServer(handle);
    server.requestTimeout = 120000;
    await new Promise(resolve => {
      server.once('error', e => {error = e.code === 'EADDRINUSE' ? 'Port 17373 is in use. Close the other Resume Manager instance.' : e.message;server = null;resolve();});
      server.listen(port, '127.0.0.1', resolve);
    });
    return server && server.address();
  }
  async function stop() {if (server) {const current = server;server = null;current.closeAllConnections();await new Promise(resolve => current.close(resolve));}}
  return {start, stop, dashboard, assign, unlink, rotateCode:() => {pairingCode = crypto.randomBytes(16).toString('hex');return dashboard();}};
}
module.exports = { createExtensionBridge, PORT };
