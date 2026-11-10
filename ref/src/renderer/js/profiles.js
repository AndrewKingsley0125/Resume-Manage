// Screen 1: the profiles, each with Edit and Open.
import { $, el, fullName } from './dom.js';
import { runs, FINISHED, log } from './state.js';
import { openEditor } from './editor.js';
import { openWorkspace } from './workspace.js';

export async function loadProfiles() {
  const profiles = await window.api.listProfiles();
  const cards = profiles.map(p => {
    const mine = [...runs.values()].filter(r => r.profileId === p.id);
    const running = mine.filter(r => !FINISHED.has(r.status)).length;
    const waiting = mine.filter(r => r.ask).length;
    return el('div', { class: 'profile-card' },
      el('div', { class: 'avatar', style: `background:${p.color || '#6c8cff'}` }, (p.firstName || p.id || '?')[0].toUpperCase()),
      el('div', { class: 'profile-info' },
        el('strong', {}, fullName(p)),
        el('span', { class: 'muted' }, p.title || 'No target title'),
        el('span', { class: 'muted small' }, [p.email, p.location].filter(Boolean).join(' · ')),
        running ? el('span', { class: 'running-badge' }, `${running} running${waiting ? `, ${waiting} need you` : ''}`) : null),
      el('div', { class: 'row' },
        el('button', { class: 'btn ghost', type: 'button', onclick: () => openEditor(p) }, 'Edit'),
        el('button', { class: 'btn primary', type: 'button', onclick: () => openWorkspace(p) }, 'Open')));
  });
  $('profile-grid').replaceChildren(...(cards.length ? cards : [el('p', { class: 'muted' }, 'No profiles yet. Import them from Resume Manager or create one.')]));
}

export function initProfiles() {
  $('import-btn').addEventListener('click', async () => {
    const res = await window.api.importProfiles();
    if (res && res.error) log(`Import failed: ${res.error}`);
    else if (res && !res.canceled) log(`Imported ${res.profiles} new profile(s), ${res.styles} template style(s)`);
    await loadProfiles();
  });
  $('new-profile-btn').addEventListener('click', () => openEditor(null));
}
