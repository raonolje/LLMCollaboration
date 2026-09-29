import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { execFileAsync, spawnCli, spawnPty } = vi.hoisted(() => ({ execFileAsync: vi.fn(), spawnCli: vi.fn(), spawnPty: vi.fn() }));

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:child_process')>();
  const { promisify } = await import('node:util');
  const execFile = vi.fn();
  Object.defineProperty(execFile, promisify.custom, { value: execFileAsync });
  return { ...original, execFile, spawn: spawnCli };
});
vi.mock('node-pty', () => ({ spawn: spawnPty }));

import { assertSubscription, cliArguments, cliStatus, handoffClaudeToDesktop, openCliSession, resolveCliExecutable, runCli } from '../src/main/services/cli';

const savedEnvironment = {
  path: process.env.PATH,
  localAppData: process.env.LOCALAPPDATA,
};

afterEach(() => {
  if (savedEnvironment.path === undefined) delete process.env.PATH;
  else process.env.PATH = savedEnvironment.path;
  if (savedEnvironment.localAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = savedEnvironment.localAppData;
  execFileAsync.mockReset();
  spawnCli.mockReset();
  spawnPty.mockReset();
});

const withTemporaryWorkspace = async <T>(run: (workspace: string) => Promise<T>): Promise<T> => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'llm-collaboration-cli-test-'));
  try {
    return await run(workspace);
  } finally {
    const [actualParent, expectedParent] = await Promise.all([
      realpath(path.dirname(workspace)),
      realpath(os.tmpdir()),
    ]);
    if (actualParent !== expectedParent || !path.basename(workspace).startsWith('llm-collaboration-cli-test-')) {
      throw new Error(`Refusing to remove an unexpected test directory: ${workspace}`);
    }
    await rm(workspace, { recursive: true, force: true });
  }
};

const missingFromPath = Object.assign(new Error('spawn codex ENOENT'), { code: 'ENOENT' });

describe.skipIf(process.platform !== 'win32')('Windows CLI discovery and execution', () => {
  it('attaches images to new and resumed Codex prompts', () => {
    const request = { projectPath: 'project', cwd: 'project', choice: { provider: 'codex' as const, model: 'default' },
      prompt: 'Inspect the screenshot', phase: 'chat', readOnly: true, signal: new AbortController().signal, imagePaths: ['screenshot.png'] };
    expect(cliArguments(request)).toContain('--image');
    expect(cliArguments({ ...request, sessionId: 'session-1' })).toEqual(expect.arrayContaining(['resume', '--image', 'screenshot.png', 'session-1', '-']));
  });
  it('finds npm command shims for both providers on PATH', () => withTemporaryWorkspace(async (workspace) => {
    const binaries = ['codex.cmd', 'claude.cmd'].map((name) => path.join(workspace, name));
    await Promise.all(binaries.map((binary) => writeFile(binary, '@echo off\r\n', 'utf8')));
    const options = {
      platform: 'win32' as const,
      env: { PATH: workspace, LOCALAPPDATA: workspace, USERPROFILE: workspace, APPDATA: workspace },
    };

    expect(await Promise.all(['codex', 'claude'].map((provider) =>
      resolveCliExecutable(provider as 'codex' | 'claude', options)))).toEqual(binaries);
  }));

  it('executes npm command shims for status checks and model output', () => withTemporaryWorkspace(async (workspace) => {
    process.env.PATH = workspace;
    process.env.LOCALAPPDATA = workspace;
    const scripts = {
      codex: [
        '@echo off',
        'if "%~1"=="--version" goto version',
        'if "%~1"=="login" goto auth',
        'echo {"type":"thread.started","thread_id":"00000000-0000-4000-8000-000000000001"}',
        'echo {"type":"item.completed","item":{"type":"agent_message","text":"Codex completed"}}',
        'exit /b 0',
        ':version',
        'echo codex-cli 0.158.0',
        'exit /b 0',
        ':auth',
        'echo Logged in using ChatGPT',
        'exit /b 0',
      ],
      claude: [
        '@echo off',
        'if "%~1"=="--version" goto version',
        'if "%~1"=="auth" goto auth',
        'echo {"type":"system","session_id":"00000000-0000-4000-8000-000000000002"}',
        'echo {"type":"result","result":"Claude completed"}',
        'exit /b 0',
        ':version',
        'echo Claude Code 2.0.0',
        'exit /b 0',
        ':auth',
        'echo {"loggedIn":true,"authMethod":"claude.ai","subscriptionType":"max"}',
        'exit /b 0',
      ],
    } as const;
    await Promise.all((['codex', 'claude'] as const).map((provider) =>
      writeFile(path.join(workspace, `${provider}.cmd`), `${scripts[provider].join('\r\n')}\r\n`, 'utf8')));

    const statuses = await Promise.all((['codex', 'claude'] as const).map((provider) => cliStatus(provider, workspace)));
    expect(statuses.map(({ installed, authentication }) => [installed, authentication])).toEqual([
      [true, 'ChatGPT 구독 로그인'],
      [true, 'Claude 구독 로그인 (max)'],
    ]);
    const results = await Promise.all((['codex', 'claude'] as const).map((provider) => runCli({
      projectPath: workspace,
      cwd: workspace,
      choice: { provider, model: '' },
      prompt: 'Check the shim execution path',
      phase: 'shim-smoke',
      readOnly: true,
      signal: new AbortController().signal,
    })));
    expect(results.map(({ text, sessionId }) => [text, sessionId])).toEqual([
      ['Codex completed', '00000000-0000-4000-8000-000000000001'],
      ['Claude completed', '00000000-0000-4000-8000-000000000002'],
    ]);
  }), 20_000);

  it('finds the Codex desktop executable when it is absent from PATH', () => withTemporaryWorkspace(async (workspace) => {
    const binary = path.join(workspace, 'OpenAI', 'Codex', 'bin', 'desktop-build', 'codex.exe');
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, '', 'utf8');

    expect(await resolveCliExecutable('codex', {
      platform: 'win32',
      env: { PATH: workspace, LOCALAPPDATA: workspace, USERPROFILE: workspace, APPDATA: workspace },
    })).toBe(binary);
  }));

  it('prefers PATH over the desktop bundle and honors an explicit executable path', () => withTemporaryWorkspace(async (workspace) => {
    const pathBinary = path.join(workspace, 'on-path', 'codex.exe');
    const bundleBinary = path.join(workspace, 'OpenAI', 'Codex', 'bin', 'desktop-build', 'codex.exe');
    await Promise.all([mkdir(path.dirname(pathBinary), { recursive: true }), mkdir(path.dirname(bundleBinary), { recursive: true })]);
    await Promise.all([writeFile(pathBinary, '', 'utf8'), writeFile(bundleBinary, '', 'utf8')]);
    const options = {
      platform: 'win32' as const,
      env: { PATH: path.dirname(pathBinary), LOCALAPPDATA: workspace, USERPROFILE: workspace, APPDATA: workspace },
    };

    expect(await resolveCliExecutable('codex', options)).toBe(pathBinary);
    expect(await resolveCliExecutable('codex', { ...options, configuredPath: bundleBinary })).toBe(bundleBinary);
    expect(await resolveCliExecutable('codex', { ...options, configuredPath: path.join(workspace, 'missing.exe') })).toBeUndefined();
  }));

  it('does not report a provider executable when no candidate exists', () => withTemporaryWorkspace(async (workspace) => {
    expect(await resolveCliExecutable('claude', {
      platform: 'win32',
      env: { PATH: workspace, LOCALAPPDATA: workspace, USERPROFILE: workspace, APPDATA: workspace },
    })).toBeUndefined();
  }));

  it('reports the bundled Codex CLI as installed when it is absent from PATH', () => withTemporaryWorkspace(async (workspace) => {
    process.env.PATH = workspace;
    process.env.LOCALAPPDATA = workspace;
    const binary = path.join(workspace, 'OpenAI', 'Codex', 'bin', 'desktop-build', 'codex.exe');
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, '', 'utf8');
    execFileAsync.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'codex') throw missingFromPath;
      if (file !== binary) throw new Error(`Unexpected executable: ${file}`);
      return args.join(' ') === '--version'
        ? { stdout: 'codex-cli 0.158.0\n', stderr: '' }
        : { stdout: '', stderr: 'Logged in using ChatGPT\n' };
    });

    expect(await cliStatus('codex', workspace)).toEqual({
      provider: 'codex',
      installed: true,
      executable: binary,
      configured: false,
      version: 'codex-cli 0.158.0',
      authentication: 'ChatGPT 구독 로그인',
    });
    await expect(assertSubscription('codex', workspace)).resolves.toBeUndefined();
    expect(execFileAsync.mock.calls.some(([file]) => file === binary)).toBe(true);
  }));

  it('keeps installation and subscription status separate', () => withTemporaryWorkspace(async (workspace) => {
    process.env.PATH = workspace;
    process.env.LOCALAPPDATA = workspace;
    const binary = path.join(workspace, 'OpenAI', 'Codex', 'bin', 'desktop-build', 'codex.exe');
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, '', 'utf8');
    execFileAsync.mockImplementation(async (file: string, args: string[]) => {
      if (file === 'codex') throw missingFromPath;
      if (file !== binary) throw new Error(`Unexpected executable: ${file}`);
      return args.join(' ') === '--version'
        ? { stdout: 'codex-cli 0.158.0\n', stderr: '' }
        : { stdout: 'Not logged in\n', stderr: '' };
    });

    expect(await cliStatus('codex', workspace)).toEqual({
      provider: 'codex',
      installed: true,
      executable: binary,
      configured: false,
      version: 'codex-cli 0.158.0',
      authentication: 'Codex의 ChatGPT 구독 로그인이 필요합니다.',
    });
    await expect(assertSubscription('codex', workspace)).rejects.toThrow('구독 로그인');
  }));

  it('runs a task through the resolved desktop executable', () => withTemporaryWorkspace(async (workspace) => {
    process.env.PATH = workspace;
    process.env.LOCALAPPDATA = workspace;
    const binary = path.join(workspace, 'OpenAI', 'Codex', 'bin', 'desktop-build', 'codex.exe');
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, '', 'utf8');
    execFileAsync.mockResolvedValue({ stdout: 'Logged in using ChatGPT\n', stderr: '' });
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    spawnCli.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-000000000001' })}\n`);
        child.stdout.write(`${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Completed' } })}\n`);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0);
      });
      return child;
    });

    const result = await runCli({
      projectPath: workspace,
      cwd: workspace,
      choice: { provider: 'codex', model: '' },
      prompt: 'Perform a small task',
      phase: 'task-execution',
      readOnly: true,
      signal: new AbortController().signal,
    });
    expect(result.text).toBe('Completed');
    expect(result.sessionId).toBe('00000000-0000-4000-8000-000000000001');
    expect(spawnCli.mock.calls[0]?.[0]).toBe(binary);
  }));

  it('opens an existing Codex session using the resolved desktop executable', () => withTemporaryWorkspace(async (workspace) => {
    process.env.PATH = workspace;
    process.env.LOCALAPPDATA = workspace;
    const binary = path.join(workspace, 'OpenAI', 'Codex', 'bin', 'desktop-build', 'codex.exe');
    const sessionId = '00000000-0000-4000-8000-000000000001';
    await mkdir(path.dirname(binary), { recursive: true });
    await writeFile(binary, '', 'utf8');
    execFileAsync.mockResolvedValue({ stdout: 'Logged in using ChatGPT\n', stderr: '' });
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    spawnCli.mockImplementation(() => {
      queueMicrotask(() => child.emit('spawn'));
      return child;
    });

    await openCliSession('codex', sessionId, workspace);
    expect(spawnCli).toHaveBeenCalledWith('cmd.exe', ['/d', '/k', `"${binary}" resume --include-non-interactive ${sessionId}`], expect.any(Object));
    expect(child.unref).toHaveBeenCalledOnce();
  }));

  it('sends /desktop once when the interactive Claude prompt is ready', () => withTemporaryWorkspace(async (workspace) => {
    process.env.PATH = workspace;
    const binary = path.join(workspace, 'claude.exe');
    const sessionId = '00000000-0000-4000-8000-000000000003';
    await writeFile(binary, '', 'utf8');
    execFileAsync.mockResolvedValue({ stdout: '{"loggedIn":true,"authMethod":"claude.ai"}', stderr: '' });
    let onData: ((chunk: string) => void) | undefined;
    let onExit: ((event: { exitCode: number }) => void) | undefined;
    const terminal = {
      onData: vi.fn((callback: typeof onData) => { onData = callback; }),
      onExit: vi.fn((callback: typeof onExit) => { onExit = callback; }),
      write: vi.fn(() => onExit?.({ exitCode: 0 })),
      kill: vi.fn(),
    };
    spawnPty.mockReturnValue(terminal);
    const handoff = handoffClaudeToDesktop(sessionId, workspace);
    await vi.waitFor(() => expect(onData).toBeDefined());
    onData?.('────────────────────────────────────────────────────────────────>\r\nshift+tab to cycle');
    await handoff;
    expect(spawnPty).toHaveBeenCalledWith(binary, ['--resume', sessionId], expect.objectContaining({ cwd: workspace }));
    expect(terminal.write).toHaveBeenCalledExactlyOnceWith('/desktop\r');
    expect(terminal.kill).toHaveBeenCalledOnce();
  }));

  it('does not approve Claude project trust prompts automatically', () => withTemporaryWorkspace(async (workspace) => {
    process.env.PATH = workspace;
    await writeFile(path.join(workspace, 'claude.exe'), '', 'utf8');
    execFileAsync.mockResolvedValue({ stdout: '{"loggedIn":true,"authMethod":"claude.ai"}', stderr: '' });
    let onData: ((chunk: string) => void) | undefined;
    const terminal = {
      onData: vi.fn((callback: typeof onData) => { onData = callback; }),
      onExit: vi.fn(),
      write: vi.fn(),
      kill: vi.fn(),
    };
    spawnPty.mockReturnValue(terminal);
    const handoff = handoffClaudeToDesktop('00000000-0000-4000-8000-000000000004', workspace);
    await vi.waitFor(() => expect(onData).toBeDefined());
    onData?.('Quick safety check: Is this a project you created? Yes, I trust this folder');
    await expect(handoff).rejects.toThrow('폴더 신뢰 확인');
    expect(terminal.write).not.toHaveBeenCalled();
    expect(terminal.kill).toHaveBeenCalledOnce();
  }));
});
