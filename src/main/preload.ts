import { contextBridge, ipcRenderer } from 'electron';
import type { CollaborationAPI, CollaborationEvent } from '../shared/types';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: CollaborationAPI = {
  bootstrap: () => invoke('collab:bootstrap'),
  chooseDirectory: () => invoke('collab:chooseDirectory'),
  chooseCliExecutable: () => invoke('collab:chooseCliExecutable'),
  setCliExecutable: (provider, filePath) => invoke('collab:setCliExecutable', provider, filePath),
  refreshCliStatus: () => invoke('collab:refreshCliStatus'),
  createProject: (input) => invoke('collab:createProject', input),
  listLocalConversations: () => invoke('collab:listLocalConversations'),
  chooseConversationFile: () => invoke('collab:chooseConversationFile'),
  importConversation: (projectPath, provider, filePath) => invoke('collab:importConversation', projectPath, provider, filePath),
  readImportedConversation: (projectPath, conversationId) => invoke('collab:readImportedConversation', projectPath, conversationId),
  readImportedConversationRaw: (projectPath, conversationId) => invoke('collab:readImportedConversationRaw', projectPath, conversationId),
  deleteProject: (projectPath, projectId, confirmation) => invoke('collab:deleteProject', projectPath, projectId, confirmation),
  forgetMissingProject: (projectPath) => invoke('collab:forgetMissingProject', projectPath),
  openProject: (projectPath) => invoke('collab:openProject', projectPath),
  updateCharter: (projectPath, charter) => invoke('collab:updateCharter', projectPath, charter),
  updateProjectRounds: (projectPath, rounds) => invoke('collab:updateProjectRounds', projectPath, rounds),
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
  openDesktopSession: (projectPath, sessionId, provider) => invoke('collab:openDesktopSession', projectPath, sessionId, provider),
  onEvent: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: CollaborationEvent): void => listener(value);
    ipcRenderer.on('collab:event', handler);
    return () => ipcRenderer.removeListener('collab:event', handler);
  },
};

contextBridge.exposeInMainWorld('collab', api);
