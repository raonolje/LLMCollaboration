import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform, Writable } from 'node:stream';
import type { AppUpdateCheck } from '../shared/types';

const owner = 'raonolje';
const repository = 'LLMCollaboration';
const releaseApi = `https://api.github.com/repos/${owner}/${repository}/releases/latest`;

type ReleaseAsset = Readonly<{ name: string; browser_download_url: string; digest: string | null; size: number }>;
type LatestRelease = Readonly<{ tag_name: string; html_url: string; draft: boolean; prerelease: boolean; assets: ReleaseAsset[] }>;
export type DownloadedUpdate = Readonly<{ filePath: string; version: string; sha256: string }>;

export const newerVersion = (latest: string, current: string): boolean => {
  const numbers = (value: string): number[] => /^v?(\d+)\.(\d+)\.(\d+)$/u.exec(value)?.slice(1).map(Number) ?? [];
  const left = numbers(latest);
  const right = numbers(current);
  return left.length === 3 && right.length === 3 && left.some((part, index) => part > right[index] && left.slice(0, index).every((earlier, earlierIndex) => earlier === right[earlierIndex]));
};

const latestRelease = async (): Promise<LatestRelease> => {
  const response = await fetch(releaseApi, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LLM-Collaboration' }, signal: AbortSignal.timeout(12_000) });
  if (response.status === 404) throw new Error('아직 게시된 앱 릴리스가 없습니다.');
  if (!response.ok) throw new Error(`업데이트 서버 응답 오류: ${response.status}`);
  const release = await response.json() as LatestRelease;
  if (release.draft || release.prerelease || !Array.isArray(release.assets)) throw new Error('안정 버전 릴리스를 확인할 수 없습니다.');
  return release;
};

const assetFor = (release: LatestRelease, platform: NodeJS.Platform, architecture: string, portable: boolean): ReleaseAsset | undefined => {
  const version = release.tag_name.replace(/^v/u, '');
  const candidates = release.assets.filter((asset) => platform === 'win32'
    ? [
      `LLM Collaboration ${portable ? '' : 'Setup '}${version}.exe`,
      `LLM.Collaboration.${portable ? '' : 'Setup.'}${version}.exe`,
    ].includes(asset.name)
    : platform === 'darwin' && /\.dmg$/iu.test(asset.name));
  return platform === 'darwin'
    ? candidates.find((asset) => asset.name.includes(architecture)) ?? candidates[0]
    : candidates[0];
};

export const checkAppUpdate = async (currentVersion: string, platform: NodeJS.Platform, architecture: string, portable: boolean): Promise<AppUpdateCheck> => {
  const release = await latestRelease();
  const available = newerVersion(release.tag_name, currentVersion);
  const asset = assetFor(release, platform, architecture, portable);
  return { currentVersion, latestVersion: release.tag_name.replace(/^v/u, ''), available, releaseUrl: release.html_url,
    assetName: available ? asset?.name : undefined };
};

export const validAsset = (asset: ReleaseAsset): boolean => {
  let url: URL;
  try { url = new URL(asset.browser_download_url); } catch { return false; }
  return url.protocol === 'https:' && url.hostname === 'github.com'
    && !url.username && !url.password
    && url.pathname.startsWith(`/${owner}/${repository}/releases/download/`)
    && /^sha256:[0-9a-f]{64}$/iu.test(asset.digest ?? '') && Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size < 800_000_000;
};

export const downloadAppUpdate = async (currentVersion: string, platform: NodeJS.Platform, architecture: string, portable: boolean, directory: string): Promise<DownloadedUpdate> => {
  const release = await latestRelease();
  if (!newerVersion(release.tag_name, currentVersion)) throw new Error('현재 버전이 최신입니다.');
  const asset = assetFor(release, platform, architecture, portable);
  if (!asset || !validAsset(asset)) throw new Error('이 운영체제에 맞는 검증 가능한 업데이트 파일이 없습니다.');
  const folder = path.join(directory, 'updates');
  await mkdir(folder, { recursive: true });
  const destination = path.join(folder, path.basename(asset.name));
  const temporary = `${destination}.download`;
  await rm(temporary, { force: true });
  try {
    const response = await fetch(asset.browser_download_url, { headers: { 'User-Agent': 'LLM-Collaboration' }, signal: AbortSignal.timeout(300_000) });
    if (!response.ok || !response.body) throw new Error(`업데이트 다운로드 실패: ${response.status}`);
    let received = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > asset.size) callback(new Error('업데이트 파일 크기 검증에 실패했습니다.'));
      else callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(temporary, { flags: 'wx' }));
    if (received !== asset.size) throw new Error('업데이트 파일 크기 검증에 실패했습니다.');
    const hash = createHash('sha256');
    await pipeline(createReadStream(temporary), new Writable({ write(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      callback();
    } }));
    if (`sha256:${hash.digest('hex')}`.toLowerCase() !== asset.digest?.toLowerCase()) throw new Error('업데이트 파일의 SHA-256 검증에 실패했습니다.');
    await rm(destination, { force: true });
    await rename(temporary, destination);
    return { filePath: destination, version: release.tag_name.replace(/^v/u, ''), sha256: asset.digest!.slice(7).toLowerCase() };
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

export const launchDownloadedUpdate = (filePath: string): void => {
  const child = process.platform === 'win32'
    ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Start-Sleep -Seconds 2; Start-Process -FilePath '${filePath.replaceAll("'", "''")}'`],
    { detached: true, windowsHide: true, stdio: 'ignore' })
    : spawn('open', [filePath], { detached: true, stdio: 'ignore' });
  child.unref();
};
