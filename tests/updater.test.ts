import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UpdateGate } from '../src/main/update-gate';
import { downloadAppUpdate, validAsset } from '../src/main/updater';
import { saveUpdateDraft, readUpdateDraft, clearUpdateDraft } from '../src/main/update-recovery';
import { acknowledgeWindowsUpdate, prepareWindowsUpdate, validateWindowsUpdatePaths } from '../src/main/windows-update';
import type { AppUpdateDraft } from '../src/shared/types';

const directories: string[] = [];
const temp = async (): Promise<string> => { const directory = await mkdtemp(path.join(os.tmpdir(), 'llm-update-test-')); directories.push(directory); return directory; };
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const draft: AppUpdateDraft = { version: 1, text: '한국어 조합 😀\n작성 중', files: [{name:'첨부.txt',data:Buffer.from('attachment').toString('base64')}], target: 'both', models: {}, discussion: true, discussionRounds: -1, composerOpen: false, projectPath: 'C:\\project' };
const asset = { name:'LLM Collaboration 0.5.19.exe', browser_download_url:'https://github.com/raonolje/LLMCollaboration/releases/download/v0.5.19/LLM.Collaboration.0.5.19.exe', digest:'sha256:'+'a'.repeat(64), size: 2 };

describe('safe automatic update', () => {
  it('acknowledges only the expected private update and confirmed UI recovery', async () => {
    const directory = await temp(); const folder = path.join(directory, 'updates', 'expected-nonce');
    await mkdir(folder, { recursive: true }); const manifest = path.join(folder, 'manifest.json');
    await writeFile(manifest, JSON.stringify({ version: '0.5.19', nonce: 'expected-nonce' }));
    const ready = { sidebarViewport: true, independentScroll: true, draftRestored: true };
    await expect(acknowledgeWindowsUpdate(directory, '0.5.18', manifest, ready)).rejects.toThrow();
    await expect(acknowledgeWindowsUpdate(directory, '0.5.19', manifest, { ...ready, draftRestored: false })).rejects.toThrow();
    expect(await readdir(folder)).toEqual(['manifest.json']);
    await acknowledgeWindowsUpdate(directory, '0.5.19', manifest, ready);
    expect(JSON.parse(await readFile(path.join(folder, 'ready.json'), 'utf8'))).toMatchObject({ version: '0.5.19', nonce: 'expected-nonce', ui: ready });
    const foreign = path.join(directory, 'manifest.json'); await writeFile(foreign, JSON.stringify({ version: '0.5.19', nonce: 'expected-nonce' }));
    await expect(acknowledgeWindowsUpdate(directory, '0.5.19', foreign, ready)).rejects.toThrow();
  });

  it('waits for accepted work without aborting it, blocks new work and duplicate updates, then resumes after failure', async () => {
    const gate = new UpdateGate(); let finish!: () => void; let completed = false;
    const work = gate.run(async () => { await new Promise<void>(resolve => { finish = resolve; }); completed = true; });
    await Promise.resolve(); const paused = gate.freeze();
    await expect(gate.run(async () => 'new request')).rejects.toThrow('업데이트');
    await expect(gate.freeze()).rejects.toThrow('이미');
    expect(completed).toBe(false); finish(); await work;
    const resume = await paused; expect(completed).toBe(true); resume();
    await expect(gate.run(async () => 'retry')).resolves.toBe('retry');
  });

  it('saves and restores the exact draft and attachments atomically, including collapsed composer and endless discussion', async () => {
    const directory = await temp(); await saveUpdateDraft(directory, draft);
    expect(await readUpdateDraft(directory)).toEqual(draft);
    expect((await readdir(directory)).filter(name=>name.endsWith('.tmp'))).toEqual([]);
    await clearUpdateDraft(directory); expect(await readUpdateDraft(directory)).toBeNull();
  });

  it('rejects corrupt or oversized recovery data rather than reporting a successful restore', async () => {
    const directory = await temp();
    await expect(saveUpdateDraft(directory, {...draft,text:'x'.repeat(20_001)})).rejects.toThrow('초안');
    await writeFile(path.join(directory,'update-draft.json'),'{bad json');
    await expect(readUpdateDraft(directory)).rejects.toThrow();
  });

  it('accepts only the existing trusted repository and a SHA256 digest', () => {
    expect(validAsset(asset)).toBe(true);
    for(const url of ['http://github.com/raonolje/LLMCollaboration/releases/download/v1/file.exe','https://example.com/file.exe','https://github.com/other/LLMCollaboration/releases/download/v1/file.exe','not a url','https://user:pass@github.com/raonolje/LLMCollaboration/releases/download/v1/file.exe']) expect(validAsset({...asset,browser_download_url:url})).toBe(false);
    expect(validAsset({...asset,digest:null})).toBe(false);
  });

  it('verifies downloaded bytes and returns the exact version/hash used by the installation worker', async () => {
    const directory = await temp(); const data = Buffer.from('MZupdate'); const sha256 = createHash('sha256').update(data).digest('hex');
    const release = {tag_name:'v0.5.19',draft:false,prerelease:false,assets:[{...asset,digest:'sha256:'+sha256,size:data.length}]};
    vi.stubGlobal('fetch',vi.fn(async (url: string) => url.includes('api.github.com') ? Response.json(release) : new Response(data)));
    const result = await downloadAppUpdate('0.5.18','win32','x64',true,directory);
    expect(result.version).toBe('0.5.19');expect(result.sha256).toBe(sha256);
    expect(await readFile(result.filePath)).toEqual(data);
  });

  it('leaves the installed executable untouched when download hash validation fails', async () => {
    const directory = await temp(); const release = {tag_name:'v0.5.19',draft:false,prerelease:false,assets:[{...asset,size:7}]};
    vi.stubGlobal('fetch',vi.fn(async (url: string) => url.includes('api.github.com') ? Response.json(release) : new Response('MZwrong')));
    await expect(downloadAppUpdate('0.5.18','win32','x64',true,directory)).rejects.toThrow('SHA-256');
    expect(await readdir(path.join(directory,'updates'))).toEqual([]);
  });

  it('rejects network/root/foreign targets, source traversal and version downgrades', () => {
    const update = {filePath:'C:\\profile\\updates\\LLM Collaboration 0.5.19.exe',version:'0.5.19',sha256:'a'.repeat(64)};
    const options = {target:'D:\\app\\LLM Collaboration.exe',directory:'C:\\profile',currentVersion:'0.5.18',portable:true,runtimePid:1,launcherPid:2,projectPaths:[]};
    expect(()=>validateWindowsUpdatePaths(update,options)).not.toThrow();
    for(const target of ['\\\\server\\app.exe','C:\\','C:\\Windows\\notepad.exe'])expect(()=>validateWindowsUpdatePaths(update,{...options,target})).toThrow();
    expect(()=>validateWindowsUpdatePaths({...update,filePath:'C:\\profile\\other.exe'},options)).toThrow();
    expect(()=>validateWindowsUpdatePaths({...update,version:'0.5.18'},options)).toThrow();
    const redirected = 'C:\\package-cache\\Roaming\\profile\\updates';
    expect(()=>validateWindowsUpdatePaths({...update,filePath:redirected+'\\LLM Collaboration 0.5.19.exe'},options,redirected)).not.toThrow();
    expect(()=>validateWindowsUpdatePaths(update,options,redirected)).toThrow();
  });

  it.skipIf(process.platform!=='win32')('prepares a private worker without changing the old executable and rechecks the source hash', async () => {
    const directory=await temp();const folder=path.join(directory,'updates');await mkdir(folder);
    const target=path.join(directory,'LLM Collaboration.exe'),source=path.join(folder,'LLM Collaboration 0.5.19.exe');
    await writeFile(target,'MZold');await writeFile(source,'MZnew');
    const sha256=createHash('sha256').update('MZnew').digest('hex');
    const options={target,directory,currentVersion:'0.5.18',portable:true,runtimePid:1,launcherPid:2,projectPaths:[]};
    const manifest=await prepareWindowsUpdate({filePath:source,version:'0.5.19',sha256},options);
    expect(await readFile(target,'utf8')).toBe('MZold');
    expect(JSON.parse(await readFile(manifest,'utf8')).sha256).toBe(sha256);
    await writeFile(source,'MZchanged');
    await expect(prepareWindowsUpdate({filePath:source,version:'0.5.19',sha256},options)).rejects.toThrow('검증');
  });
});
