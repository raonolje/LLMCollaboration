import { contextBridge, ipcRenderer } from 'electron';
import type { CollaborationAPI, CollaborationEvent, LaunchRequest } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: CollaborationAPI = {
  bootstrap: () => invoke('collab:bootstrap'),
  chooseDirectory: () => invoke('collab:chooseDirectory'),
  chooseCliExecutable: () => invoke('collab:chooseCliExecutable'),
  setCliExecutable: (provider, filePath) => invoke('collab:setCliExecutable', provider, filePath),
  refreshCliStatus: () => invoke('collab:refreshCliStatus'),
  refreshModelCatalogs: () => invoke('collab:refreshModelCatalogs'),
  checkAppUpdate: () => invoke('collab:checkAppUpdate'),
  downloadAppUpdate: (draft) => invoke('collab:downloadAppUpdate', draft),
  readUpdateDraft: () => invoke('collab:readUpdateDraft'),
  clearUpdateDraft: () => invoke('collab:clearUpdateDraft'),
  updateReady: (state) => invoke('collab:updateReady', state),
  remoteStatus: () => invoke('collab:remoteStatus'),
  setRemoteEnabled: (enabled) => invoke('collab:setRemoteEnabled', enabled),
  rotateRemoteToken: () => invoke('collab:rotateRemoteToken'),
  createProject: (input) => invoke('collab:createProject', input),
  reconnectProject: (projectPath) => invoke('collab:reconnectProject', projectPath),
  chooseChatFiles: () => invoke('collab:chooseChatFiles'),
  sendProjectMessage: (projectPath, message, target, models, files, discussion, discussionRounds) => invoke('collab:sendProjectMessage', projectPath, message, target, models, files, discussion, discussionRounds),
  continueProjectDiscussion: (projectPath, messageId) => invoke('collab:continueProjectDiscussion', projectPath, messageId),
  cancelProjectMessage: (projectPath) => invoke('collab:cancelProjectMessage', projectPath),
  listLocalConversations: (target) => invoke('collab:listLocalConversations', target),
  consumeLaunchRequest: () => invoke('collab:consumeLaunchRequest'),
  installChatSkills: () => invoke('collab:installChatSkills'),
  onLaunchRequest: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: LaunchRequest): void => listener(value);
    ipcRenderer.on('collab:launchRequest', handler);
    return () => ipcRenderer.removeListener('collab:launchRequest', handler);
  },
  chooseConversationFile: () => invoke('collab:chooseConversationFile'),
  importConversation: (projectPath, provider, filePath) => invoke('collab:importConversation', projectPath, provider, filePath),
  readImportedConversation: (projectPath, conversationId) => invoke('collab:readImportedConversation', projectPath, conversationId),
  readImportedConversationRaw: (projectPath, conversationId) => invoke('collab:readImportedConversationRaw', projectPath, conversationId),
  deleteProject: (projectPath, projectId, confirmation) => invoke('collab:deleteProject', projectPath, projectId, confirmation),
  unregisterProjectOnly: (projectPath, projectId, confirmation) => invoke('collab:unregisterProjectOnly', projectPath, projectId, confirmation),
  forgetMissingProject: (projectPath) => invoke('collab:forgetMissingProject', projectPath),
  openProject: (projectPath) => invoke('collab:openProject', projectPath),
  updateCharter: (projectPath, charter) => invoke('collab:updateCharter', projectPath, charter),
  updateProjectRounds: (projectPath, rounds) => invoke('collab:updateProjectRounds', projectPath, rounds),
  updateProjectChatModel: (projectPath, provider, settings) => invoke('collab:updateProjectChatModel', projectPath, provider, settings),
  createTask: (projectPath, input) => invoke('collab:createTask', projectPath, input),
  planTasks: (projectPath, request) => invoke('collab:planTasks', projectPath, request),
  updateTask: (projectPath, task) => invoke('collab:updateTask', projectPath, task),
  autoAssign: (projectPath, taskId) => invoke('collab:autoAssign', projectPath, taskId),
  runDebate: (projectPath, taskId) => invoke('collab:runDebate', projectPath, taskId),
  continueDebate: (projectPath, taskId, followUp) => invoke('collab:continueDebate', projectPath, taskId, followUp),
  executeTask: (projectPath, taskId) => invoke('collab:executeTask', projectPath, taskId),
  cancelRun: (projectPath, taskId) => invoke('collab:cancelRun', projectPath, taskId),
  search: (projectPath, query) => invoke('collab:search', projectPath, query),
  readTranscript: (projectPath, transcript) => invoke('collab:readTranscript', projectPath, transcript),
  readSessionHistory: (projectPath, sessionId) => invoke('collab:readSessionHistory', projectPath, sessionId),
  openSession: (projectPath, sessionId) => invoke('collab:openSession', projectPath, sessionId),
  handoffClaudeSession: (projectPath, sessionId) => invoke('collab:handoffClaudeSession', projectPath, sessionId),
  openDesktopSession: (projectPath, sessionId, provider) => invoke('collab:openDesktopSession', projectPath, sessionId, provider),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: CollaborationEvent): void => listener(value);
    ipcRenderer.on('collab:event', handler);
    return () => ipcRenderer.removeListener('collab:event', handler);
  },
};

contextBridge.exposeInMainWorld('collab', api);
