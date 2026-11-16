// One tab group per job: the job site and ChatGPT, side by side in a native split view.
// The extension itself opens in its own narrow window docked to the right of this one.
export async function arrangeWorkspace(api, jobTabId, chatTabId) {
  let job = await api.tabs.get(jobTabId), chat = await api.tabs.get(chatTabId);
  const sharedSplit = job.splitViewId >= 0 && job.splitViewId === chat.splitViewId && job.windowId === chat.windowId;
  if (sharedSplit && job.groupId >= 0 && job.groupId === chat.groupId) return {layout:'split',groupId:job.groupId,splitViewId:job.splitViewId};
  if (!sharedSplit && typeof api.tabs.unsplit === 'function') {
    for (const id of new Set([job.splitViewId,chat.splitViewId].filter(id => id >= 0))) await api.tabs.unsplit(id);
  }
  if (job.windowId !== chat.windowId) await api.tabs.move(chat.id,{windowId:job.windowId,index:-1});
  job = await api.tabs.get(jobTabId);chat = await api.tabs.get(chatTabId);
  if (chat.index !== job.index + 1) await api.tabs.move(chat.id,{index:chat.index < job.index ? job.index : job.index + 1});
  job = await api.tabs.get(jobTabId);chat = await api.tabs.get(chatTabId);
  const groupId = job.groupId >= 0 && job.groupId === chat.groupId ? job.groupId : await api.tabs.group({tabIds:[job.id,chat.id]});
  if (sharedSplit) return {layout:'split',groupId,splitViewId:job.splitViewId};
  if (typeof api.tabs.createSplit === 'function') {
    try {
      const splitViewId = await api.tabs.createSplit([job.id,chat.id]);
      return {layout:'split',groupId,splitViewId};
    } catch (error) {
      return {layout:'grouped',groupId,layoutNotice:`Chrome could not create split view: ${error.message}. The job site and ChatGPT are grouped together.`};
    }
  }
  return {layout:'grouped',groupId,layoutNotice:'Automatic split view needs Chrome 155 or newer. The job site and ChatGPT are grouped together.'};
}
// Where the extension's window goes: docked to the right edge of the job window, same
// height. It must stay inside the screen area; the job window gives up the room if needed.
export function panelBounds(jobWindow, area, width) {
  const job = {left:jobWindow.left || 0, top:jobWindow.top || 0, width:jobWindow.width || 0, height:jobWindow.height || 0};
  let jobWidth = job.width;
  if (area && job.left + job.width + width > area.left + area.width) jobWidth = Math.max(600, area.left + area.width - width - job.left);
  return {job:{width:jobWidth}, panel:{left:job.left + jobWidth, top:job.top, width, height:job.height}};
}
