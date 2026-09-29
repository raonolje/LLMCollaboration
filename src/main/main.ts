import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import type { CollaborationEvent, Provider } from '../shared/types';
import { createService } from './services';

let mainWindow: BrowserWindow | null = null;

const createWindow = (): BrowserWindow => {
  const window = new BrowserWindow({
    width: 1500,
    height: 960,
    minWidth: 1050,
    minHeight: 720,
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

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
  const service = createService({
    registryPath: path.join(app.getPath('userData'), 'projects.json'),
    emit: (event: CollaborationEvent) => mainWindow?.webContents.send('collab:event', event),
    trashItem: (target: string) => shell.trashItem(target),
  });

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
  ipcMain.handle('collab:setCliExecutable', (_event, provider, filePath) => service.setCliExecutable(provider, filePath));
  ipcMain.handle('collab:refreshCliStatus', () => service.refreshCliStatus());
  ipcMain.handle('collab:createProject', (_event, input) => service.createProject(input));
  ipcMain.handle('collab:deleteProject', (_event, projectPath, projectId, confirmation) => service.deleteProject(projectPath, projectId, confirmation));
  ipcMain.handle('collab:openProject', (_event, projectPath) => service.openProject(projectPath));
  ipcMain.handle('collab:updateCharter', (_event, projectPath, charter) => service.updateCharter(projectPath, charter));
  ipcMain.handle('collab:updateProjectRounds', (_event, projectPath, rounds) => service.updateProjectRounds(projectPath, rounds));
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
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  registerHandlers();
  mainWindow = createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
