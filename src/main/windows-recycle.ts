import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sharingViolation = -2147024864;
const accessDenied = -2147024891;

export const recycleError = (output: string): Error => {
  const code = Number(output.match(/RECYCLE_ERROR_CODE=(-?\d+)/u)?.[1]);
  if (code === sharingViolation) return new Error('다른 프로그램이 이 폴더를 사용 중입니다. 해당 폴더를 연 터미널이나 앱을 닫고 다시 시도하세요.');
  if (code === accessDenied) return new Error('Windows가 이 폴더에 대한 이동 권한을 거부했습니다. 폴더 권한을 확인해 주세요.');
  return new Error(Number.isFinite(code) && code !== 0
    ? `Windows 휴지통 이동에 실패했습니다. 오류 코드: ${code}`
    : 'Windows 휴지통 이동에 실패했습니다. 폴더가 다른 프로그램에서 사용 중인지 확인해 주세요.');
};

export const recycleDirectoryWithWindows = async (target: string): Promise<void> => {
  try {
    await execFileAsync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; try { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($env:LLM_COLLAB_TRASH_TARGET, [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs, [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin) } catch { $exception = $_.Exception; while ($exception.InnerException) { $exception = $exception.InnerException }; [Console]::Error.WriteLine('RECYCLE_ERROR_CODE=' + $exception.HResult); exit 1 }",
    ], { env: { ...process.env, LLM_COLLAB_TRASH_TARGET: target }, windowsHide: true, timeout: 120_000 });
  } catch (error) {
    throw recycleError(String((error as { stderr?: unknown }).stderr ?? ''));
  }
};
