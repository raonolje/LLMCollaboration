import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import type { CollaborationEvent, LaunchRequest, Provider } from '../shared/types';
import { createService } from './services';
import { installChatSkills, parseLaunchUrl } from './chat-link';
import { recycleDirectoryWithWindows } from './windows-recycle';
import { checkAppUpdate, downloadAppUpdate, launchDownloadedUpdate } from './updater';
import { createRemote } from './remote';
import { windowsAppId, windowsLaunchDetails } from './windows-launch';

const windowsLaunch = process.platform === 'win32'
  ? windowsLaunchDetails(process.execPath, process.env.PORTABLE_EXECUTABLE_FILE,
    process.defaultApp ? process.argv[1] : undefined)
  : null;
if (windowsLaunch) app.setAppUserModelId(windowsAppId);

let mainWindow: BrowserWindow | null = null;
let closeRemote: (() => Promise<void>) | null = null;
const trashItemWithFallback = async (target: string): Promise<void> => {
  try { await shell.trashItem(target); }
  catch (error) {
    if (process.platform !== 'win32') throw error;
    await recycleDirectoryWithWindows(target);
  }
};
let pendingLaunch: LaunchRequest | null = process.argv.map(parseLaunchUrl).find((item) => item !== null) ?? null;
const receiveLaunch = (value: string): void => {
  const request = parseLaunchUrl(value);
  if (!request) return;
  pendingLaunch = request;
  mainWindow?.show();
  mainWindow?.focus();
  mainWindow?.webContents.send('collab:launchRequest', request);
};

const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) app.quit();
app.on('second-instance', (_event, commandLine) => commandLine.map(parseLaunchUrl).filter((item) => item !== null)
  .forEach((item) => receiveLaunch(`llmcollaboration://new-project?provider=${item.provider}&sessionId=${item.sessionId}`)));
app.on('open-url', (event, url) => { event.preventDefault(); receiveLaunch(url); });

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#10141c',
    title: 'LLM Collaboration',
    icon: path.join(app.getAppPath(), 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (windowsLaunch) window.setAppDetails(windowsLaunch.appDetails);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('before-input-event', (event, input) => {
    if (!(process.platform === 'darwin' ? input.meta : input.control) || input.alt) return;
    const key = input.key.toLowerCase();
    if (!['+', '=', 'add', '-', '_', 'subtract', '0'].includes(key)) return;
    event.preventDefault();
    const current = window.webContents.getZoomFactor();
    const next = key === '0' ? 1 : Math.min(2, Math.max(1, Math.round(current * 4 + (['+', '=', 'add'].includes(key) ? 1 : -1)) / 4));
    window.webContents.setZoomFactor(next);
  });
  if (process.platform !== 'darwin') window.setMenuBarVisibility(false);
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  const devUrl = process.env.ELECTRON_DEV_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(app.getAppPath(), 'dist-renderer', 'index.html'));
  }

  window.on('closed', () => { mainWindow = null; });
  return window;
};

const registerHandlers = (): void => {
  let remote: ReturnType<typeof createRemote> | undefined;
  const service = createService({
    registryPath: path.join(app.getPath('userData'), 'projects.json'),
    emit: (event: CollaborationEvent) => { mainWindow?.webContents.send('collab:event', event); remote?.publishEvent(event); },
    trashItem: trashItemWithFallback,
  });
  remote = createRemote(service, app.getPath('userData'), { webRoot: path.join(app.getAppPath(), 'mobile', 'web-dist') });
  closeRemote = remote.close;
  void remote.initialize();

  ipcMain.handle('collab:bootstrap', () => service.bootstrap());
  ipcMain.handle('collab:chooseDirectory', async () => {
    const options: Electron.OpenDialogOptions = {
      title: '프로젝트 폴더 선택',
      properties: ['openDirectory', 'createDirectory'],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('collab:chooseCliExecutable', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'CLI 실행 파일 선택',
      properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: 'CLI 실행 파일', extensions: ['exe', 'cmd'] }] } : {}),
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('collab:chooseConversationFile', async () => {
    const options: Electron.OpenDialogOptions = {
      title: 'Codex 또는 Claude 대화 JSONL 선택',
      properties: ['openFile'],
      filters: [{ name: '대화 기록', extensions: ['jsonl'] }],
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle('collab:setCliExecutable', (_event, provider, filePath) => service.setCliExecutable(provider, filePath));
  ipcMain.handle('collab:refreshCliStatus', () => service.refreshCliStatus());
  ipcMain.handle('collab:refreshModelCatalogs', () => service.refreshModelCatalogs());
  ipcMain.handle('collab:remoteStatus', () => remote.status());
  ipcMain.handle('collab:setRemoteEnabled', (_event, enabled: boolean) => remote.setEnabled(enabled));
  ipcMain.handle('collab:rotateRemoteToken', () => remote.rotateToken());
  ipcMain.handle('collab:checkAppUpdate', () => checkAppUpdate(app.getVersion(), process.platform, process.arch, !!process.env.PORTABLE_EXECUTABLE_FILE));
  ipcMain.handle('collab:downloadAppUpdate', async () => {
    const downloaded = await downloadAppUpdate(app.getVersion(), process.platform, process.arch,
      !!process.env.PORTABLE_EXECUTABLE_FILE, app.getPath('userData'));
    launchDownloadedUpdate(downloaded);
    setTimeout(() => app.quit(), 200);
    return downloaded;
  });
  ipcMain.handle('collab:createProject', (_event, input) => service.createProject(input));
  ipcMain.handle('collab:reconnectProject', (_event, projectPath) => service.reconnectProject(projectPath));
  ipcMain.handle('collab:chooseChatFiles', async () => {
    const options: Electron.OpenDialogOptions = { title: '채팅에 첨부할 이미지 또는 파일 선택', properties: ['openFile', 'multiSelections'] };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('collab:sendProjectMessage', (_event, projectPath, message, target, models, files, discussion, discussionRounds) => service.sendProjectMessage(projectPath, message, target, models, files, discussion, discussionRounds));
  ipcMain.handle('collab:continueProjectDiscussion', (_event, projectPath, messageId) => service.continueProjectDiscussion(projectPath, messageId));
  ipcMain.handle('collab:cancelProjectMessage', (_event, projectPath) => service.cancelProjectMessage(projectPath));
  ipcMain.handle('collab:listLocalConversations', (_event, target?: LaunchRequest) => service.listLocalConversations(target));
  ipcMain.handle('collab:consumeLaunchRequest', () => {
    const request = pendingLaunch;
    pendingLaunch = null;
    return request;
  });
  ipcMain.handle('collab:installChatSkills', () => installChatSkills());
  ipcMain.handle('collab:importConversation', (_event, projectPath, provider, filePath) => service.importConversation(projectPath, provider, filePath));
  ipcMain.handle('collab:readImportedConversation', (_event, projectPath, conversationId) => service.readImportedConversation(projectPath, conversationId));
  ipcMain.handle('collab:readImportedConversationRaw', (_event, projectPath, conversationId) => service.readImportedConversationRaw(projectPath, conversationId));
  ipcMain.handle('collab:deleteProject', (_event, projectPath, projectId, confirmation) => service.deleteProject(projectPath, projectId, confirmation));
  ipcMain.handle('collab:unregisterProjectOnly', (_event, projectPath, projectId, confirmation) => service.unregisterProjectOnly(projectPath, projectId, confirmation));
  ipcMain.handle('collab:forgetMissingProject', (_event, projectPath) => service.forgetMissingProject(projectPath));
  ipcMain.handle('collab:openProject', (_event, projectPath) => service.openProject(projectPath));
  ipcMain.handle('collab:updateCharter', (_event, projectPath, charter) => service.updateCharter(projectPath, charter));
  ipcMain.handle('collab:updateProjectRounds', (_event, projectPath, rounds) => service.updateProjectRounds(projectPath, rounds));
  ipcMain.handle('collab:updateProjectChatModel', (_event, projectPath, provider, settings) => service.updateProjectChatModel(projectPath, provider, settings));
  ipcMain.handle('collab:createTask', (_event, projectPath, input) => service.createTask(projectPath, input));
  ipcMain.handle('collab:planTasks', (_event, projectPath, request) => service.planTasks(projectPath, request));
  ipcMain.handle('collab:updateTask', (_event, projectPath, task) => service.updateTask(projectPath, task));
  ipcMain.handle('collab:autoAssign', (_event, projectPath, taskId) => service.autoAssign(projectPath, taskId));
  ipcMain.handle('collab:runDebate', (_event, projectPath, taskId) => service.runDebate(projectPath, taskId));
  ipcMain.handle('collab:continueDebate', (_event, projectPath, taskId, followUp) => service.continueDebate(projectPath, taskId, followUp));
  ipcMain.handle('collab:executeTask', (_event, projectPath, taskId) => service.executeTask(projectPath, taskId));
  ipcMain.handle('collab:cancelRun', (_event, projectPath, taskId) => service.cancelRun(projectPath, taskId));
  ipcMain.handle('collab:search', (_event, projectPath, query) => service.search(projectPath, query));
  ipcMain.handle('collab:readTranscript', (_event, projectPath, transcript) => service.readTranscript(projectPath, transcript));
  ipcMain.handle('collab:readSessionHistory', (_event, projectPath, sessionId) => service.readSessionHistory(projectPath, sessionId));
  ipcMain.handle('collab:openSession', (_event, projectPath, sessionId) => service.openSession(projectPath, sessionId));
  ipcMain.handle('collab:handoffClaudeSession', (_event, projectPath, sessionId) => service.handoffClaudeSession(projectPath, sessionId));
  ipcMain.handle('collab:openDesktopSession', async (_event, projectPath, sessionId, provider: Provider) => {
    if (provider !== 'codex' && provider !== 'claude') throw new Error('지원하지 않는 모델입니다.');
    const current = await service.openProject(projectPath);
    const session = [
      ...(current.project.sessions ?? []),
      ...current.tasks.flatMap((task) => task.sessions ?? []),
    ].find((item) => item.sessionId === sessionId && item.hostId === current.localHostId && item.provider === provider);
    if (!session) throw new Error('이 컴퓨터의 모델 대화 세션을 찾을 수 없습니다.');
    const url = provider === 'codex'
      ? `codex://threads/${encodeURIComponent(session.sessionId)}`
      : `claude://resume?session=${encodeURIComponent(session.sessionId)}`;
    await shell.openExternal(url);
  });
};

void app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  if (windowsLaunch) {
    app.setAsDefaultProtocolClient('llmcollaboration', windowsLaunch.target, windowsLaunch.args);
  } else if (process.defaultApp && process.argv[1]) {
    app.setAsDefaultProtocolClient('llmcollaboration', process.execPath, [path.resolve(process.argv[1])]);
  } else app.setAsDefaultProtocolClient('llmcollaboration');
  void installChatSkills().catch(() => undefined);
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  registerHandlers();
  mainWindow = createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { void closeRemote?.(); });
