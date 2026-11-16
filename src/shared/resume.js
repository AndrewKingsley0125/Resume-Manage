(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.App = root.App || {}; root.App.Resume = api; }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const keys = ['company', 'title', 'summary', 'skills', 'experience', 'education'];
  const roleKeys = ['company', 'title', 'overview', 'sentences', 'technologies'];
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  function exact(value, expected, at) {
    if (!object(value) || Object.keys(value).length !== expected.length || expected.some(k => !Object.hasOwn(value, k))) throw new Error(`${at} must contain exactly: ${expected.join(', ')}`);
  }
  function string(value, at) { if (typeof value !== 'string') throw new Error(`${at} must be a string`); }
  function array(value, at) { if (!Array.isArray(value)) throw new Error(`${at} must be an array`); }
  function strings(value, at) { array(value, at); value.forEach((s,i) => string(s, `${at}[${i}]`)); }
  function validate(data, profile) {
    if (object(data) && Object.hasOwn(data, 'error')) throw new Error(String(data.error));
    exact(data, keys, 'Resume');
    for (const k of ['company', 'title', 'summary']) string(data[k], k);
    array(data.skills, 'skills');
    data.skills.forEach((group,i) => {
      if (!object(group) || Object.keys(group).length !== 1 || !Object.keys(group)[0].trim()) throw new Error(`skills[${i}] must contain one category`);
      strings(Object.values(group)[0], `skills[${i}]`);
    });
    array(data.experience, 'experience');
    data.experience.forEach((role,i) => {
      exact(role, roleKeys, `experience[${i}]`);
      for (const k of ['company','title','overview']) string(role[k], `experience[${i}].${k}`);
      for (const k of ['sentences','technologies']) strings(role[k], `experience[${i}].${k}`);
    });
    array(data.education, 'education');
    data.education.forEach((e,i) => { exact(e, ['degree'], `education[${i}]`); string(e.degree, `education[${i}].degree`); });
    if (profile) {
      // One role per profile employer. The JSON may word an employer's name its own way
      // ("Snowflake Inc."); that name is what the resume shows.
      const expected = (profile.workHistory || []).length;
      if (data.experience.length !== expected) throw new Error(`Experience must contain one entry per profile employer (${expected}), not ${data.experience.length}.`);
      if (data.experience.some(role => !role.company.trim())) throw new Error('Every experience entry needs a company name.');
    }
    return data;
  }
  function parse(input, profile) {
    const source = String(input).trim();
    // The resume is the first fenced block; iteration score lines before it are ignored.
    const fenced = /```json\s*\n?([\s\S]*?)\n?```/i.exec(source);
    return validate(JSON.parse(fenced ? fenced[1] : source), profile);
  }
  function seed(profile = {}) {
    return { company: '', title: '', summary: '', skills: [],
      experience: (profile.workHistory || []).map(w => ({company:w.company || '',title:'',overview:'',sentences:[],technologies:[]})),
      education: (profile.education || []).map(e => ({degree:e.degree || ''})) };
  }
  // Explicit compatibility boundary for resumes saved before overview/technologies existed.
  function migrate(data, profile) {
    const base = seed(profile);
    if (!object(data) || Object.hasOwn(data, 'error')) return base;
    for (const k of ['company','title','summary']) if (typeof data[k] === 'string') base[k] = data[k];
    if (Array.isArray(data.skills)) base.skills = data.skills;
    const old = Array.isArray(data.experience) ? data.experience : [];
    const used = new Set();
    base.experience = base.experience.map((role,i) => {
      let index = old.findIndex((r,j) => !used.has(j) && r && r.company === role.company);
      if (index < 0 && !used.has(i)) index = i;
      const source = old[index] || {}; used.add(index);
      return {...role, title: typeof source.title === 'string' ? source.title : '', overview: typeof source.overview === 'string' ? source.overview : '', sentences: Array.isArray(source.sentences) ? source.sentences.filter(s => typeof s === 'string') : [], technologies: Array.isArray(source.technologies) ? source.technologies.filter(s => typeof s === 'string') : []};
    });
    return base;
  }
  const plainName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  // Pairs each profile job with its JSON role: the same name, then the same name in
  // other wording ("Snowflake" / "Snowflake Inc."), then the same position.
  function pairRoles(work, roles) {
    const used = new Set(), pairs = new Array(work.length).fill(-1);
    const tests = [
      (w, r) => r.company === w.company,
      (w, r) => !!plainName(w.company) && plainName(r.company) === plainName(w.company),
      (w, r) => {const a = plainName(w.company), b = plainName(r.company);return !!a && !!b && (` ${b} `.includes(` ${a} `) || ` ${a} `.includes(` ${b} `));},
    ];
    for (const test of tests) work.forEach((w, i) => {
      if (pairs[i] >= 0) return;
      const j = roles.findIndex((r, k) => !used.has(k) && r && typeof r.company === 'string' && test(w, r));
      if (j >= 0) {pairs[i] = j;used.add(j);}
    });
    work.forEach((w, i) => {
      if (pairs[i] >= 0) return;
      const j = i < roles.length && !used.has(i) ? i : roles.findIndex((r, k) => !used.has(k));
      if (j >= 0) {pairs[i] = j;used.add(j);}
    });
    return pairs;
  }
  function experience(profile, data) {
    const roles = Array.isArray(data.experience) ? data.experience : [];
    const work = profile.workHistory || [];
    const pairs = pairRoles(work, roles);
    return work.map((work,i) => {
      const role = roles[pairs[i]] || {};
      const all = Array.isArray(role.sentences) ? role.sentences.filter(s => typeof s === 'string') : [];
      const count = typeof work.bulletsCount === 'number' && work.bulletsCount >= 0 ? work.bulletsCount : null;
      // The profile's employer name, unless the profile opts into the name written in the JSON.
      const jsonName = typeof role.company === 'string' ? role.company.trim() : '';
      const company = profile.useJsonEmployerNames === true && jsonName ? jsonName : work.company || '';
      return {company,location:work.location || '',period:work.period || '',workType:work.workType || '',workArrangement:work.workArrangement || '',title:typeof role.title === 'string' ? role.title : '',overview:typeof role.overview === 'string' ? role.overview : '',sentences:count === null ? all : all.slice(0,count),technologies:Array.isArray(role.technologies) ? role.technologies.filter(s => typeof s === 'string') : []};
    });
  }
  /**
   * Toolbar "Entry layout": each field goes on the title line or the meta line,
   * left or right aligned, or is hidden. Fields sharing a slot keep this order,
   * and work type carries the work arrangement. Shared by the templates and DOCX.
   */
  const entryFields = [
    { key: 'company', label: 'Company', default: 'titleLeft', value: r => [r.company] },
    { key: 'period', label: 'Period', default: 'metaLeft', value: r => [r.period] },
    { key: 'location', label: 'Location', default: 'metaLeft', value: r => [r.location] },
    { key: 'workType', label: 'Work type', default: 'metaLeft', value: r => [r.workType, r.workArrangement] },
  ];
  const entrySlotKey = field => `${field}Position`;
  /** Returns { titleLeft, titleRight, metaLeft, metaRight } as arrays of { key, text }. */
  function entryLayout(role, style) {
    style = style || {};
    const slots = { titleLeft: [], titleRight: [], metaLeft: [], metaRight: [], hidden: [] };
    if (role.title) slots.titleLeft.push({ key: 'title', text: role.title });
    for (const f of entryFields) {
      const chosen = style[entrySlotKey(f.key)];
      const slot = Object.hasOwn(slots, chosen) ? chosen : f.default;
      for (const text of f.value(role).filter(Boolean)) slots[slot].push({ key: f.key, text });
    }
    delete slots.hidden;
    return slots;
  }
  return { validate, parse, seed, migrate, experience, entryFields, entrySlotKey, entryLayout };
});
