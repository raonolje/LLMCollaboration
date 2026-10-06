import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, mkdir, lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DownloadedUpdate } from './updater';
import type { AppUpdateReady } from '../shared/types';
import { newerVersion } from './updater';
import { writeJson } from './services/repository';
import { windowsUpdateScript } from './windows-update-script';

export type WindowsUpdateOptions = {
  target: string; directory: string; portable: boolean; currentVersion: string;
  runtimePid: number; launcherPid: number; projectPaths: string[];
};
export const validateWindowsUpdatePaths = (update: DownloadedUpdate, options: WindowsUpdateOptions, updatesDirectory = path.win32.join(options.directory, 'updates')): void => {
  const local = (value: string): boolean => /^[A-Za-z]:\\/u.test(value) && path.win32.isAbsolute(value);
  const expectedName = /^LLM[ .]Collaboration(?:[ .]\d+\.\d+\.\d+)?\.exe$/iu;
  const relative = path.win32.relative(updatesDirectory, update.filePath);
  if (!local(options.target) || !local(update.filePath) || !local(updatesDirectory) || path.win32.basename(updatesDirectory).toLowerCase() !== 'updates' || !expectedName.test(path.win32.basename(options.target))
    || !relative || relative.startsWith('..') || path.win32.isAbsolute(relative) || !/\.exe$/iu.test(update.filePath)
    || !/^[0-9a-f]{64}$/u.test(update.sha256) || !newerVersion(update.version, options.currentVersion)
    || path.win32.resolve(options.target).toLowerCase() === path.win32.resolve(update.filePath).toLowerCase()) {
    throw new Error('업데이트 파일의 버전 또는 설치 경로가 올바르지 않습니다.');
  }
};
export const prepareWindowsUpdate = async (update: DownloadedUpdate, options: WindowsUpdateOptions): Promise<string> => {
  validateWindowsUpdatePaths(update, options);
  for (const file of [update.filePath, options.target]) {
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error('업데이트에는 실제 EXE 파일만 사용할 수 있습니다.');
    if (!(await readFile(file)).subarray(0, 2).equals(Buffer.from('MZ'))) throw new Error('Windows 실행 파일 형식이 올바르지 않습니다.');
  }
  const source = await readFile(update.filePath);
  if (createHash('sha256').update(source).digest('hex') !== update.sha256) throw new Error('설치 직전 업데이트 파일 검증에 실패했습니다.');
  const realSource = await realpath(update.filePath);
  const realTarget = await realpath(options.target);
  const realDirectory = await realpath(options.directory);
  // Windows package virtualization can redirect only newly created AppData files.
  // Resolve the private updates folder itself; keep the data directory for backups.
  const updatesDirectory = await realpath(path.join(options.directory, 'updates'));
  validateWindowsUpdatePaths({ ...update, filePath: realSource }, { ...options, target: realTarget, directory: realDirectory }, updatesDirectory);
  const folder = path.join(updatesDirectory, randomUUID());
  await mkdir(folder, { recursive: true });
  const manifest = path.join(folder, 'manifest.json');
  const worker = path.join(folder, 'worker.ps1');
  await writeFile(worker, '\ufeff' + windowsUpdateScript, 'utf8');
  await writeJson(manifest, { ...options, directory: realDirectory, updatesDirectory, target: realTarget, filePath: realSource,
    version: update.version, sha256: update.sha256, folder, nonce: path.basename(folder),
    targetHash: createHash('sha256').update(await readFile(options.target)).digest('hex') });
  return manifest;
};
// Execute the application's own embedded commands, without changing script policy.
export const windowsUpdateCommand = (manifest: string): string => `& { ${windowsUpdateScript} } -Manifest '${manifest.replaceAll("'", "''")}'`;
export const launchWindowsUpdate = async (manifest: string): Promise<void> => {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
    windowsUpdateCommand(manifest)], { detached: true, windowsHide: true, stdio: 'ignore' });
  await new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
  // Do not quit or discard the draft until the helper has validated its manifest.
  try {
    const statusFile = path.join(path.dirname(manifest), 'status.json');
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        const status = JSON.parse(await readFile(statusFile, 'utf8').then(text => text.replace(/^\ufeff/u, ''))) as { state: string };
        if (status.state === 'waiting-exit') return;
        throw new Error('업데이트 설치 준비에 실패했습니다. 앱을 계속 사용할 수 있습니다.');
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (child.exitCode !== null) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('업데이트 설치 도우미를 시작하지 못했습니다. 앱을 계속 사용할 수 있습니다.');
  } finally { child.unref(); }
};
export const acknowledgeWindowsUpdate = async (directory: string, version: string, manifestPath: string | undefined, ui: AppUpdateReady): Promise<void> => {
  if (!manifestPath) return;
  if (ui?.sidebarViewport !== true || ui?.independentScroll !== true || ui?.draftRestored !== true) throw new Error('새 앱의 화면이나 초안 복구를 확인하지 못했습니다. 이전 버전으로 복구합니다.');
  const updatesDirectory = await realpath(path.join(directory, 'updates'));
  manifestPath = await realpath(manifestPath);
  const relative = path.relative(updatesDirectory, manifestPath);
  if (relative.startsWith('..') || path.isAbsolute(relative) || path.basename(manifestPath) !== 'manifest.json') throw new Error('업데이트 복구 경로가 올바르지 않습니다.');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string; nonce: string };
  if (manifest.version !== version || path.basename(path.dirname(manifestPath)) !== manifest.nonce) throw new Error('재시작 버전이 업데이트와 일치하지 않습니다.');
  await writeJson(path.join(path.dirname(manifestPath), 'ready.json'), { version, nonce: manifest.nonce, readyAt: new Date().toISOString(), ui });
};
