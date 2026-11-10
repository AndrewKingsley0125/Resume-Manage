/* Profile job links and live local-extension connection dashboard. */
(function () {
  const $ = id => document.getElementById(id);
  const workflow = window.App.ProfileWorkflow;
  let currentProfile = null;
  let saveLinks = null;
  let editProfile = null;
  let initialized = false;
  let token = 0;
  let pollTimer = null;
  let liveState = null;
  let pollBusy = false;

  function renderJobs(links) {
    $('extension-job-count').textContent = String(links.length);
    $('extension-jobs-empty').hidden = links.length > 0;
    const items = links.map(link => {
      const item = document.createElement('li');
      const url = document.createElement('span');
      url.textContent = link;
      url.className = 'extension-job-url';
      const status = document.createElement('span');
      status.className = 'muted small';
      const assigned = liveState && liveState.jobs.filter(job => job.profileId === currentProfile.id && job.url === link).at(-1);
      status.textContent = assigned ? `${assigned.status}${assigned.company ? ' - ' + assigned.company : ''}${assigned.error ? ' - ' + assigned.error : ''}` : 'Saved - Not assigned';
      item.append(url, status);
      if (window.api && window.api.extensionAssign) {
        const send = document.createElement('button');send.className = 'btn btn-ghost btn-sm';send.type = 'button';send.textContent = 'Send to extension';
        send.disabled = !!assigned && !['completed','unlinked'].includes(assigned.status);
        send.addEventListener('click', async () => {
          const active = token, profile = currentProfile;
          send.disabled = true;
          try {
            const connectionId = $('extension-target').value;
            if (!connectionId) throw new Error('Choose a linked extension first.');
            let style = {};
            try {style = JSON.parse(localStorage.getItem(`style:${profile.id}:${profile.templateId || 'classic'}`) || '{}');} catch (_) { /* use defaults */ }
            await window.api.extensionAssign({profileId:profile.id,url:link,connectionId,style});
            if (active !== token) return;
            $('extension-dispatch-status').textContent = 'Job sent. Chrome will open the job site and ChatGPT automatically. Use the extension side panel to continue.';
            await refreshConnections();
          } catch (error) {if (active === token) {$('extension-dispatch-status').textContent = error.message;send.disabled = false;}}
        });
        item.append(send);
      }
      return item;
    });
    $('extension-job-list').replaceChildren(...items);
  }

  async function refreshConnections() {
    if (!currentProfile || !window.api || !window.api.extensionState || pollBusy) return;
    const active = token;
    pollBusy = true;
    try {
      const state = await window.api.extensionState();
      if (active !== token) return;
      liveState = state;
      $('extension-connected-count').textContent = `${state.connections.filter(c => c.connected).length} / ${state.maxConnections}`;
      $('extension-bridge-notice').textContent = state.error || (state.running ? `Local connection service running. ${state.connections.length} of ${state.maxConnections} extension slots linked.` : 'Local connection service is offline.');
      $('extension-pairing-code').value = state.pairingCode;
      const previous = $('extension-target').value;
      const options = state.connections.map(client => {
        const option = document.createElement('option');option.value = client.id;option.textContent = `${client.name} (${client.connected ? 'online' : 'offline'})`;return option;
      });
      if (!options.length) {const option = document.createElement('option');option.value = '';option.textContent = 'Link an extension first';options.push(option);}
      $('extension-target').replaceChildren(...options);
      if (state.connections.some(c => c.id === previous)) $('extension-target').value = previous;
      const slots = Array.from({length:workflow.MAX_EXTENSIONS}, (_,index) => {
        const client = state.connections[index], slot = document.createElement('div');slot.className = 'extension-slot';
        const title = document.createElement('strong');title.textContent = client ? client.name : `Extension ${index + 1}`;
        const status = document.createElement('span');status.className = 'muted small';status.textContent = client ? client.connected ? 'Connected' : 'Offline' : 'Not linked';slot.append(title,status);
        if (client) {
          const remove = document.createElement('button');remove.className = 'btn btn-ghost btn-sm';remove.type = 'button';remove.textContent = 'Unlink';
          remove.addEventListener('click', async () => {
            if (!confirm(`Unlink ${client.name}?`)) return;
            try {await window.api.extensionUnlink(client.id);await refreshConnections();} catch (e) {$('extension-dispatch-status').textContent = e.message;}
          });slot.append(remove);
        }
        return slot;
      });
      $('extension-slots').replaceChildren(...slots);
      renderJobs(workflow.normalizeJobLinks(currentProfile.extensionJobLinks));
    } catch (error) {if (active === token) $('extension-bridge-notice').textContent = error.message;}
    finally {pollBusy = false;}
  }

  function initialize() {
    if (initialized) return;
    initialized = true;
    if (window.api && window.api.extensionState) {
      $('extension-copy-code').addEventListener('click', async () => {
        try {await navigator.clipboard.writeText($('extension-pairing-code').value);$('extension-dispatch-status').textContent = 'Pairing code copied.';} catch (_) {$('extension-pairing-code').select();}
      });
      $('extension-rotate-code').addEventListener('click', async () => {try {await window.api.extensionRotateCode();await refreshConnections();} catch (e) {$('extension-dispatch-status').textContent = e.message;}});
    }
    $('extension-edit-profile').addEventListener('click', () => editProfile && editProfile());
    $('extension-job-links').addEventListener('input', () => {
      $('extension-links-status').textContent = 'Unsaved changes';
    });
    $('extension-save-links').addEventListener('click', async () => {
      if (!currentProfile || !saveLinks) return;
      const activeToken = token;
      const button = $('extension-save-links');
      const input = $('extension-job-links');
      const draft = input.value;
      try {
        const links = workflow.parseJobLinks(draft);
        button.disabled = true;
        $('extension-links-status').textContent = 'Saving...';
        await saveLinks(links);
        if (activeToken !== token) return;
        renderJobs(links);
        if (input.value === draft) {
          input.value = links.join('\n');
          $('extension-links-status').textContent = 'Saved';
        } else {
          $('extension-links-status').textContent = 'Unsaved changes';
        }
      } catch (error) {
        if (activeToken === token) $('extension-links-status').textContent = error.message || 'Could not save job links.';
      } finally {
        if (activeToken === token) button.disabled = false;
      }
    });
  }

  function open(profile, onSave, onEdit) {
    initialize();
    token++;
    currentProfile = profile;
    liveState = null;
    saveLinks = onSave;
    editProfile = onEdit;
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unnamed profile';
    $('extension-profile-name').textContent = name;
    $('subtitle').textContent = `${name} - Chrome extension mode`;
    $('extension-job-links').value = workflow.normalizeJobLinks(profile.extensionJobLinks).join('\n');
    $('extension-links-status').textContent = '';
    $('extension-save-links').disabled = false;
    $('extension-connected-count').textContent = `0 / ${workflow.MAX_EXTENSIONS}`;
    const slots = Array.from({ length: workflow.MAX_EXTENSIONS }, (_, index) => {
      const slot = document.createElement('div');
      slot.className = 'extension-slot';
      const title = document.createElement('strong');
      title.textContent = `Extension ${index + 1}`;
      const status = document.createElement('span');
      status.className = 'muted small';
      status.textContent = 'Not linked';
      slot.append(title, status);
      return slot;
    });
    $('extension-slots').replaceChildren(...slots);
    renderJobs(workflow.normalizeJobLinks(profile.extensionJobLinks));
    if (window.api && window.api.extensionState) {
      $('extension-dispatch-status').textContent = '';
      refreshConnections();
      clearInterval(pollTimer);
      pollTimer = setInterval(refreshConnections, 3000);
    }
  }

  function close() {
    if (pollTimer !== null) clearInterval(pollTimer);pollTimer = null;
    token++;
    currentProfile = null;
    saveLinks = null;
    editProfile = null;
  }

  window.App.ExtensionWorkspace = { open, close };
})();
