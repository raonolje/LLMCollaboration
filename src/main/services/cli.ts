import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import crossSpawn from 'cross-spawn';
import type { CliStatus, ModelChoice, Provider } from '../../shared/types';
import { projectFiles } from './repository';

const exec = promisify(execFile);
const names: Record<Provider, string> = { codex: 'codex', claude: 'claude' };

export type CliResolutionOptions = Readonly<{
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  configuredPath?: string;
}>;

const isFile = async (candidate: string): Promise<boolean> =>
  stat(candidate).then((entry) => entry.isFile()).catch(() => false);

const bundledCodexWindows = async (localAppData: string | undefined): Promise<string[]> => {
  if (!localAppData) return [];
  const directory = path.win32.join(localAppData, 'OpenAI', 'Codex', 'bin');
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const candidates = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const executable = path.win32.join(directory, entry.name, 'codex.exe');
    const modified = await stat(executable).then((value) => value.isFile() ? value.mtimeMs : -1).catch(() => -1);
    return { executable, modified };
  }));
  return candidates.filter((candidate) => candidate.modified >= 0)
    .sort((left, right) => right.modified - left.modified)
    .map((candidate) => candidate.executable);
};

export const resolveCliExecutable = async (
  provider: Provider,
  { env = process.env, platform = process.platform, configuredPath }: CliResolutionOptions = {},
): Promise<string | undefined> => {
  if (configuredPath !== undefined) {
    const selected = path.resolve(configuredPath);
    return await isFile(selected) ? selected : undefined;
  }
  const paths = Object.entries(env).find(([key]) => key.toLocaleLowerCase() === 'path')?.[1] ?? '';
  const pathModule = platform === 'win32' ? path.win32 : path.posix;
  const separator = platform === 'win32' ? ';' : ':';
  const binaries = platform === 'win32'
    ? [`${names[provider]}.exe`, `${names[provider]}.cmd`]
    : [names[provider]];
  const fromPath = paths.split(separator).map((directory) => directory.trim().replace(/^"|"$/gu, ''))
    .filter(Boolean).flatMap((directory) => binaries.map((binary) => pathModule.join(directory, binary)));
  const userHome = env.USERPROFILE || env.HOME || os.homedir();
  const common = platform === 'win32'
    ? binaries.map((binary) => path.win32.join(userHome, '.local', 'bin', binary))
    : [path.posix.join(userHome, '.local', 'bin', binaries[0]), `/opt/homebrew/bin/${binaries[0]}`, `/usr/local/bin/${binaries[0]}`];
  const bundled = platform === 'win32' && provider === 'codex'
    ? await bundledCodexWindows(env.LOCALAPPDATA)
    : [];
  const candidates = [...new Set([...fromPath, ...bundled, ...common])];
  return candidates.reduce<Promise<string | undefined>>(
    (previous, candidate) => previous.then(async (found) => {
      if (found) return found;
      return await isFile(candidate) ? candidate : undefined;
    }),
    Promise.resolve(undefined),
  );
};

const subscriptionEnvironment = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_PROFILE|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|CODEX_API_KEY|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_USE_GATEWAY|AWS_PROFILE|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS)$/iu.test(key),
    ),
  );

const isWindowsShim = (executable: string): boolean => process.platform === 'win32' && /\.cmd$/iu.test(executable);

const executeWindowsShim = (executable: string, args: string[], cwd: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = crossSpawn(executable, args, {
      cwd,
      env: subscriptionEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let tooLarge = false;
    const append = (previous: string, chunk: Buffer): string => {
      const next = previous + chunk.toString('utf8');
      if (Buffer.byteLength(next) > 1024 * 1024) {
        tooLarge = true;
        child.kill();
      }
      return next;
    };
    child.stdout!.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr!.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timeout = setTimeout(() => { timedOut = true; child.kill(); }, 12_000);
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (timedOut) reject(new Error(`${executable} 실행 시간이 초과됐습니다.`));
      else if (tooLarge) reject(new Error(`${executable} 출력이 너무 큽니다.`));
      else if (code !== 0) reject(new Error((stderr || stdout).trim() || `${executable} 실행 실패 (${code ?? 'unknown'})`));
      else resolve(stdout.trim() || stderr.trim());
    });
  });

const execute = async (executable: string, args: string[], cwd: string): Promise<string> => {
  if (isWindowsShim(executable)) return executeWindowsShim(executable, args, cwd);
  const { stdout, stderr } = await exec(executable, args, {
    cwd,
    env: subscriptionEnvironment(),
    timeout: 12_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim() || stderr.trim();
};

const command = async (provider: Provider, args: string[], cwd: string, configuredPath?: string): Promise<string> => {
  const executable = await resolveCliExecutable(provider, { configuredPath });
  if (!executable) throw new Error(`${provider} CLI 실행 파일을 찾을 수 없습니다.`);
  return execute(executable, args, cwd);
};

export const cliStatus = async (provider: Provider, cwd: string, configuredPath?: string): Promise<CliStatus> => {
  const executable = await resolveCliExecutable(provider, { configuredPath });
  if (!executable) return { provider, installed: false, authentication: 'CLI 실행 파일을 찾을 수 없습니다.', configured: configuredPath !== undefined };
  try {
    const version = await execute(executable, ['--version'], cwd);
    const authentication = await subscriptionStatus(provider, cwd, configuredPath).catch((error: unknown) =>
      error instanceof Error ? error.message : '로그인 상태를 확인할 수 없습니다.',
    );
    return { provider, installed: true, version, authentication, executable, configured: configuredPath !== undefined };
  } catch (error) {
    return { provider, installed: true, executable, configured: configuredPath !== undefined,
      authentication: `CLI 실행 오류: ${error instanceof Error ? error.message : String(error)}` };
  }
};

const subscriptionStatus = async (provider: Provider, cwd: string, configuredPath?: string): Promise<string> => {
  if (provider === 'codex') {
    const status = await command(provider, ['login', 'status'], cwd, configuredPath);
    if (!/ChatGPT/iu.test(status)) throw new Error('Codex의 ChatGPT 구독 로그인이 필요합니다.');
    return 'ChatGPT 구독 로그인';
  }
  const raw = await command(provider, ['auth', 'status'], cwd, configuredPath);
  const status = JSON.parse(raw) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
  if (!status.loggedIn || status.authMethod !== 'claude.ai') {
    throw new Error('Claude Code의 Claude 구독 로그인이 필요합니다.');
  }
  return `Claude 구독 로그인${status.subscriptionType ? ` (${status.subscriptionType})` : ''}`;
};

export const assertSubscription = async (provider: Provider, cwd: string, configuredPath?: string): Promise<void> => {
  await subscriptionStatus(provider, cwd, configuredPath);
};

const extractText = (raw: string): string | undefined => {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.type === 'result' && typeof value.result === 'string') return value.result;
    const item = value.item as Record<string, unknown> | undefined;
    if (value.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
      return item.text;
    }
    const message = value.message as Record<string, unknown> | undefined;
    if (value.type === 'assistant' && Array.isArray(message?.content)) {
      return message.content
        .filter((part): part is { type: string; text: string } =>
          Boolean(part) && typeof part === 'object' && (part as { type?: string }).type === 'text',
        )
        .map((part) => part.text)
        .join('\n');
    }
  } catch {
    return raw;
  }
  return undefined;
};

export type CliRequest = Readonly<{
  projectPath: string;
  cwd: string;
  choice: ModelChoice;
  prompt: string;
  phase: string;
  readOnly: boolean;
  effort?: string;
  signal: AbortSignal;
  sessionId?: string;
  configuredPath?: string;
  imagePaths?: string[];
}>;

export type CliResult = Readonly<{
  text: string;
  transcript: string;
  sessionId?: string;
}>;

export const cliArguments = (request: CliRequest): string[] => {
  const modelArgs = request.choice.model && request.choice.model !== 'default'
    ? ['--model', request.choice.model] : [];
  const effortArgs = request.effort
    ? request.choice.provider === 'codex' ? ['--config', `model_reasoning_effort="${request.effort}"`] : ['--effort', request.effort]
    : [];
  const imageArgs = (request.imagePaths ?? []).flatMap((file) => ['--image', file]);
  return request.choice.provider === 'codex'
    ? ['exec', '--json', '--cd', request.cwd, '--sandbox', request.readOnly ? 'read-only' : 'workspace-write', ...modelArgs, ...effortArgs, ...(request.sessionId ? ['resume', ...imageArgs, request.sessionId, '-'] : [...imageArgs, '-'])]
    : ['-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', request.readOnly ? 'plan' : 'acceptEdits', '--permission-prompts', 'none', '--tools', request.readOnly ? 'Read,Glob,Grep' : 'Read,Glob,Grep,Edit,Write,Bash', ...modelArgs, ...effortArgs, ...(request.sessionId ? ['--resume', request.sessionId] : []), 'Follow the full task instructions supplied on standard input.'];
};

const isSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);

const shellQuoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const appleQuoted = (value: string): string => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export const openCliSession = async (provider: Provider, sessionId: string, cwd: string, configuredPath?: string): Promise<void> => {
  if (!isSessionId(sessionId)) throw new Error('대화 세션 ID가 올바르지 않습니다.');
  const executable = await resolveCliExecutable(provider, { configuredPath });
  if (!executable) throw new Error(`${provider} CLI 실행 파일을 찾을 수 없습니다.`);
  await assertSubscription(provider, cwd, configuredPath);
  const resumeArgs = provider === 'codex' ? `resume --include-non-interactive ${sessionId}` : `--resume ${sessionId}`;
  const commandLine = process.platform === 'win32'
    ? `"${executable}" ${resumeArgs}`
    : `${shellQuoted(executable)} ${resumeArgs}`;
  const terminalExecutable = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'osascript' : undefined;
  if (!terminalExecutable) throw new Error('현재는 Windows와 macOS의 터미널 열기를 지원합니다.');
  const args = process.platform === 'win32'
    ? ['/d', '/k', commandLine]
    : ['-e', `tell application "Terminal" to do script ${appleQuoted(`cd ${shellQuoted(cwd)} && ${commandLine}`)}`];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(terminalExecutable, args, {
      cwd,
      env: subscriptionEnvironment(),
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
    });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
};

export const runCli = async (request: CliRequest): Promise<CliResult> => {
  const executable = await resolveCliExecutable(request.choice.provider, { configuredPath: request.configuredPath });
  if (!executable) throw new Error(`${request.choice.provider} CLI 실행 파일을 찾을 수 없습니다.`);
  await assertSubscription(request.choice.provider, request.cwd, request.configuredPath);
  const runId = randomUUID();
  const relative = path.join('.llm-collaboration', 'runs', `${runId}.jsonl`);
  const output = path.join(request.projectPath, relative);
  await mkdir(projectFiles(request.projectPath).runs, { recursive: true });
  const log = createWriteStream(output, { encoding: 'utf8', flags: 'wx' });
  log.write(`${JSON.stringify({ type: 'invocation', timestamp: new Date().toISOString(), provider: request.choice.provider, model: request.choice.model, effort: request.effort, phase: request.phase, prompt: request.prompt, cwd: request.cwd, sessionId: request.sessionId })}\n`);

  const args = cliArguments(request);

  const spawnCli = isWindowsShim(executable) ? crossSpawn : spawn;
  const child = spawnCli(executable, args, {
    cwd: request.cwd,
    env: subscriptionEnvironment(),
    windowsHide: true,
    signal: request.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin!.end(request.prompt);

  let latest = '';
  let stderr = '';
  let pendingOut = '';
  let pendingErr = '';
  let sessionId = request.sessionId;
  const flush = (stream: 'stdout' | 'stderr', chunk: string): void => {
    const combined = (stream === 'stdout' ? pendingOut : pendingErr) + chunk;
    const lines = combined.split(/\r?\n/u);
    const remainder = lines.pop() ?? '';
    if (stream === 'stdout') pendingOut = remainder;
    else pendingErr = remainder;
    lines.filter(Boolean).map((line) => {
      log.write(`${JSON.stringify({ type: stream, line })}\n`);
      if (stream === 'stdout') {
        latest = extractText(line) || latest;
        try {
          const record = JSON.parse(line) as { type?: string; thread_id?: unknown; session_id?: unknown };
          const candidate = record.type === 'thread.started' ? record.thread_id : record.session_id;
          if (isSessionId(candidate)) sessionId = candidate;
        } catch { /* Raw output remains available in the transcript. */ }
      }
      else stderr = `${stderr}${line}\n`.slice(-16_000);
      return line;
    });
  };
  child.stdout!.on('data', (data: Buffer) => flush('stdout', data.toString('utf8')));
  child.stderr!.on('data', (data: Buffer) => flush('stderr', data.toString('utf8')));

  const result = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  }).finally(async () => {
    if (pendingOut) flush('stdout', '\n');
    if (pendingErr) flush('stderr', '\n');
    log.end();
    await finished(log);
  });
  if (result !== 0) throw new Error(`${request.choice.provider} 실행 실패 (${result}): ${stderr.slice(-2000) || '자세한 내용은 실행 기록을 확인하세요.'}`);
  if (!latest.trim()) throw new Error(`${request.choice.provider}가 결과 문장을 반환하지 않았습니다. 실행 기록: ${relative}`);
  if (!sessionId) throw new Error(`${request.choice.provider}가 대화 세션 ID를 반환하지 않았습니다. 실행 기록: ${relative}`);
  return { text: latest.trim(), transcript: relative, sessionId };
};
