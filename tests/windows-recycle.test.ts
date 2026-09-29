import { mkdtemp, mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { recycleDirectoryWithWindows, recycleError } from '../src/main/windows-recycle';

describe('Windows Recycle Bin fallback', () => {
  it('explains the sharing violation without exposing the PowerShell command', () => {
    expect(recycleError('RECYCLE_ERROR_CODE=-2147024864').message).toContain('다른 프로그램이 이 폴더를 사용 중');
  });

  (process.platform === 'win32' ? it : it.skip)('moves a folder containing Git files to the Recycle Bin', async () => {
    const workspace = path.resolve(process.cwd());
    const work = path.join(workspace, 'work');
    await mkdir(work, { recursive: true });
    const target = await mkdtemp(path.join(work, "recycle-'quoted'-"));
    if (path.relative(workspace, target).startsWith('..')) throw new Error('Test target escaped the workspace');
    await mkdir(path.join(target, '.git'));
    await writeFile(path.join(target, '.git', 'config'), 'probe', 'utf8');
    await recycleDirectoryWithWindows(target);
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);
});
