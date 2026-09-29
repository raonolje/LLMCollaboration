import { spawn, execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { CliStatus, ModelChoice, Provider } from '../../shared/types';
import { projectFiles } from './repository';

const exec = promisify(execFile);
const names: Record<Provider, string> = { codex: 'codex', claude: 'claude' };

const subscriptionEnvironment = (): NodeJS.ProcessEnv =>
  Object.fromEntries(
    Object.entries(process.env).filter(([key]) =>
      !/^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_PROFILE|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|CODEX_API_KEY|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_USE_GATEWAY|AWS_PROFILE|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|GOOGLE_APPLICATION_CREDENTIALS)$/iu.test(key),
    ),
  );

const command = async (provider: Provider, args: string[], cwd: string): Promise<string> => {
  const { stdout, stderr } = await exec(names[provider], args, {
    cwd,
    env: subscriptionEnvironment(),
    timeout: 12_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim() || stderr.trim();
};

export const cliStatus = async (provider: Provider, cwd: string): Promise<CliStatus> => {
  try {
    const version = await command(provider, ['--version'], cwd);
    const authentication = await subscriptionStatus(provider, cwd).catch((error: unknown) =>
      error instanceof Error ? error.message : '로그인 상태를 확인할 수 없습니다.',
    );
    return { provider, installed: true, version, authentication };
  } catch {
    return { provider, installed: false, authentication: 'CLI를 찾을 수 없습니다.' };
  }
};

const subscriptionStatus = async (provider: Provider, cwd: string): Promise<string> => {
  if (provider === 'codex') {
    const status = await command(provider, ['login', 'status'], cwd);
    if (!/ChatGPT/iu.test(status)) throw new Error('Codex의 ChatGPT 구독 로그인이 필요합니다.');
    return 'ChatGPT 구독 로그인';
  }
  const raw = await command(provider, ['auth', 'status'], cwd);
  const status = JSON.parse(raw) as { loggedIn?: boolean; authMethod?: string; subscriptionType?: string };
  if (!status.loggedIn || status.authMethod !== 'claude.ai') {
    throw new Error('Claude Code의 Claude 구독 로그인이 필요합니다.');
  }
  return `Claude 구독 로그인${status.subscriptionType ? ` (${status.subscriptionType})` : ''}`;
};

export const assertSubscription = async (provider: Provider, cwd: string): Promise<void> => {
  await subscriptionStatus(provider, cwd);
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
  signal: AbortSignal;
  sessionId?: string;
}>;

export type CliResult = Readonly<{
  text: string;
  transcript: string;
  sessionId?: string;
}>;

const isSessionId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);

const shellQuoted = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
const appleQuoted = (value: string): string => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

export const openCliSession = async (provider: Provider, sessionId: string, cwd: string): Promise<void> => {
  if (!isSessionId(sessionId)) throw new Error('대화 세션 ID가 올바르지 않습니다.');
  await assertSubscription(provider, cwd);
  const commandLine = provider === 'codex' ? `codex resume --include-non-interactive ${sessionId}` : `claude --resume ${sessionId}`;
  const executable = process.platform === 'win32' ? 'cmd.exe' : process.platform === 'darwin' ? 'osascript' : undefined;
  if (!executable) throw new Error('현재는 Windows와 macOS의 터미널 열기를 지원합니다.');
  const args = process.platform === 'win32'
    ? ['/k', commandLine]
    : ['-e', `tell application "Terminal" to do script ${appleQuoted(`cd ${shellQuoted(cwd)} && ${commandLine}`)}`];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
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
  await assertSubscription(request.choice.provider, request.cwd);
  const runId = randomUUID();
  const relative = path.join('.llm-collaboration', 'runs', `${runId}.jsonl`);
  const output = path.join(request.projectPath, relative);
  await mkdir(projectFiles(request.projectPath).runs, { recursive: true });
  const log = createWriteStream(output, { encoding: 'utf8', flags: 'wx' });
  log.write(`${JSON.stringify({ type: 'invocation', timestamp: new Date().toISOString(), provider: request.choice.provider, model: request.choice.model, phase: request.phase, prompt: request.prompt, cwd: request.cwd, sessionId: request.sessionId })}\n`);

  const modelArgs = request.choice.model && request.choice.model !== 'default'
    ? ['--model', request.choice.model]
    : [];
  const args = request.choice.provider === 'codex'
    ? ['exec', '--json', '--cd', request.cwd, '--sandbox', request.readOnly ? 'read-only' : 'workspace-write', ...modelArgs, ...(request.sessionId ? ['resume', request.sessionId, '-'] : ['-'])]
    : ['-p', '--verbose', '--output-format', 'stream-json', '--permission-mode', request.readOnly ? 'plan' : 'acceptEdits', '--permission-prompts', 'none', '--tools', request.readOnly ? 'Read,Glob,Grep' : 'default', ...modelArgs, ...(request.sessionId ? ['--resume', request.sessionId] : []), 'Follow the full task instructions supplied on standard input.'];

  const child = spawn(names[request.choice.provider], args, {
    cwd: request.cwd,
    env: subscriptionEnvironment(),
    windowsHide: true,
    signal: request.signal,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(request.prompt);

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
  child.stdout.on('data', (data: Buffer) => flush('stdout', data.toString('utf8')));
  child.stderr.on('data', (data: Buffer) => flush('stderr', data.toString('utf8')));

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
