// Native browser layout; page content is never embedded in extension frames.
export async function arrangeWorkspace(api, jobTabId, chatTabId) {
  let job = await api.tabs.get(jobTabId), chat = await api.tabs.get(chatTabId);
  const sharedSplit = job.splitViewId >= 0 && job.splitViewId === chat.splitViewId && job.windowId === chat.windowId;
  if (sharedSplit) return {layout:'split',groupId:job.groupId,splitViewId:job.splitViewId};
  if (typeof api.tabs.unsplit === 'function') {
    for (const id of new Set([job.splitViewId,chat.splitViewId].filter(id => id >= 0))) await api.tabs.unsplit(id);
  }
  if (job.windowId !== chat.windowId) await api.tabs.move(chat.id,{windowId:job.windowId,index:-1});
  job = await api.tabs.get(jobTabId);chat = await api.tabs.get(chatTabId);
  if (chat.index !== job.index + 1) await api.tabs.move(chat.id,{index:chat.index < job.index ? job.index : job.index + 1});
  job = await api.tabs.get(jobTabId);chat = await api.tabs.get(chatTabId);
  const groupId = job.groupId >= 0 && job.groupId === chat.groupId ? job.groupId : await api.tabs.group({tabIds:[job.id,chat.id]});
  if (typeof api.tabs.createSplit === 'function') {
    try {
      const splitViewId = await api.tabs.createSplit([job.id,chat.id]);
      return {layout:'split',groupId,splitViewId};
    } catch (error) {
      return {layout:'grouped',groupId,layoutNotice:`Chrome could not create split view: ${error.message}. The two tabs are grouped together.`};
    }
  }
  return {layout:'grouped',groupId,layoutNotice:'Automatic split view needs Chrome 155 or newer. The two tabs are grouped together.'};
}
