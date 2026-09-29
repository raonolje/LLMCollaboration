import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createService } from '../src/main/services';
import { ensureTaskWorktree, git, projectWorktreeDirectory } from '../src/main/services/repository';
import { cliStatus, type CliRequest, type CliResult } from '../src/main/services/cli';
import type { CollaborationEvent, TaskInput } from '../src/shared/types';

vi.mock('../src/main/services/cli', () => ({
  assertSubscription: vi.fn(async () => undefined),
  cliStatus: vi.fn(async (provider: 'codex' | 'claude') => ({ provider, installed: true, authentication: 'mock subscription' })),
  runCli: vi.fn(async () => { throw new Error('A test must inject runModel; do not invoke a real model CLI.'); }),
}));

const withTemporaryWorkspace = async <T>(run: (workspace: string) => Promise<T>): Promise<T> => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'llm-collaboration-service-test-'));
  try {
    return await run(workspace);
  } finally {
    const [actualParent, expectedParent] = await Promise.all([
      realpath(path.dirname(workspace)),
      realpath(os.tmpdir()),
    ]);
    if (actualParent !== expectedParent || !path.basename(workspace).startsWith('llm-collaboration-service-test-')) {
      throw new Error(`Refusing to remove an unexpected test directory: ${workspace}`);
    }
    await rm(workspace, { recursive: true, force: true });
  }
};

const taskInput = (overrides: Partial<TaskInput> = {}): TaskInput => ({
  title: 'Implement project search',
  description: 'Create a searchable local project artifact',
  acceptanceCriteria: ['The artifact exists in Git', 'Another model reviews the artifact'],
  mode: 'manual',
  executor: { provider: 'codex', model: 'codex-selected' },
  reviewer: { provider: 'claude', model: 'claude-selected' },
  dependsOn: [],
  debateRounds: 2,
  ...overrides,
});

const recordMockTranscript = async (request: CliRequest, text: string): Promise<CliResult> => {
  const relative = path.join('.llm-collaboration', 'runs', `${randomUUID()}.jsonl`);
  const filename = path.join(request.projectPath, relative);
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, [
    JSON.stringify({ type: 'invocation', provider: request.choice.provider, phase: request.phase, timestamp: '2026-09-29T00:00:00.000Z', prompt: request.prompt, sessionId: request.sessionId }),
    JSON.stringify({ type: 'stdout', line: `RAW_ONLY_SEARCH_NEEDLE ${text}` }),
    '',
  ].join('\n'), 'utf8');
  return { text, transcript: relative };
};

describe('service orchestration with an injected model', () => {
  it('runs two debate rounds, accepts a targeted follow-up, gets a second-model review, and merges approved work', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const calls: CliRequest[] = [];
    const reviewContents: string[] = [];
    const emitted: CollaborationEvent[] = [];
    const runModel = vi.fn(async (request: CliRequest): Promise<CliResult> => {
      calls.push(request);
      const artifact = path.join(request.cwd, 'deliverables', 'result.txt');
      if (request.phase === 'task-execution' || request.phase === 'task-revision-1') {
        await mkdir(path.dirname(artifact), { recursive: true });
        await writeFile(artifact, request.phase === 'task-execution' ? 'version one\n' : 'version two\n', 'utf8');
      }
      if (request.phase.startsWith('cross-review-')) {
        reviewContents.push((await readFile(artifact, 'utf8')).replace(/\r\n/gu, '\n'));
      }
      const result = request.phase === 'cross-review-1' ? 'CHANGES_REQUESTED\nFix result.txt'
        : request.phase === 'cross-review-2' ? 'APPROVED\nresult.txt meets the criteria'
        : `${request.choice.provider} ${request.phase} answer`;
      return recordMockTranscript(request, result);
    });
    const service = createService({ registryPath: path.join(workspace, 'registry.json'), emit: (event) => emitted.push(event), runModel, autoStartSessions: false });
    const created = await service.createProject({ path: projectPath, name: 'Example', goal: 'Ship a reviewed file', defaultDebateRounds: 2 });
    await service.updateCharter(projectPath, 'Never lose the source history.');
    const task = (await service.createTask(projectPath, taskInput())).tasks[0];

    await service.runDebate(projectPath, task.id);
    const initialDebate = calls.map(({ phase }) => phase);
    expect(initialDebate.filter((phase) => phase === 'debate-proposal')).toHaveLength(2);
    expect(initialDebate.filter((phase) => phase === 'debate-critique-1')).toHaveLength(2);
    expect(initialDebate.filter((phase) => phase === 'debate-response-2')).toHaveLength(2);
    expect(initialDebate.filter((phase) => phase === 'debate-evaluation')).toHaveLength(2);
    expect(initialDebate.at(-1)).toBe('debate-synthesis');
    expect(Math.max(...initialDebate.map((phase, index) => phase === 'debate-critique-1' ? index : -1)))
      .toBeLessThan(initialDebate.findIndex((phase) => phase === 'debate-response-2'));
    expect(calls.filter(({ phase }) => phase === 'debate-response-2').map(({ prompt }) => prompt.includes('debate-critique-1 answer')))
      .toEqual([true, true]);
    expect(calls.filter(({ phase }) => phase === 'debate-evaluation').map(({ prompt }) => prompt.includes('debate-response-2 answer')))
      .toEqual([true, true]);
    expect(calls.filter(({ phase }) => phase.startsWith('debate-')).every(({ readOnly, cwd }) => readOnly && cwd === projectPath)).toBe(true);
    expect((await service.openProject(projectPath)).tasks[0]).toMatchObject({ status: 'ready', debateSummary: 'claude debate-synthesis answer' });

    const callCount = calls.length;
    const question = 'Compare the storage cost and defend your choice.';
    await service.continueDebate(projectPath, task.id, { message: question, target: 'codex', additionalRounds: 1 });
    const additional = calls.slice(callCount);
    expect(additional.filter(({ phase }) => phase === 'debate-followUp').map(({ choice }) => choice.provider)).toEqual(['codex']);
    expect(additional.find(({ phase }) => phase === 'debate-followUp')?.prompt).toContain(question);
    expect(additional.filter(({ phase }) => phase === 'debate-response-3')).toHaveLength(2);
    expect(additional.filter(({ phase }) => phase === 'debate-evaluation')).toHaveLength(2);
    expect(additional.at(-1)?.phase).toBe('debate-synthesis');
    expect((await service.openProject(projectPath)).events.find(({ actor, message }) => actor === 'user' && message === question)?.metadata)
      .toMatchObject({ target: 'codex', additionalRounds: 1 });

    await service.executeTask(projectPath, task.id);
    const snapshot = await service.openProject(projectPath);
    expect(reviewContents).toEqual(['version one\n', 'version two\n']);
    expect(calls.filter(({ phase }) => phase.startsWith('task-')).map(({ choice, readOnly }) => [choice.provider, readOnly]))
      .toEqual([['codex', false], ['codex', false]]);
    expect(calls.filter(({ phase }) => phase.startsWith('cross-review-')).map(({ choice, readOnly }) => [choice.provider, readOnly]))
      .toEqual([['claude', true], ['claude', true]]);
    expect(calls.filter(({ phase }) => phase.startsWith('cross-review-')).map(({ prompt }) => prompt.includes('result.txt')))
      .toEqual([true, true]);
    expect(snapshot.tasks[0]).toMatchObject({ status: 'approved', reviewSummary: 'APPROVED\nresult.txt meets the criteria', artifacts: ['deliverables/result.txt'] });
    expect((await readFile(path.join(projectPath, 'deliverables', 'result.txt'), 'utf8')).replace(/\r\n/gu, '\n')).toBe('version two\n');
    expect(await git(projectPath, ['log', '-1', '--format=%s'])).toContain('Record artifact');
    expect(snapshot.events.filter(({ type }) => type === 'review').map(({ actor }) => actor)).toEqual(['claude', 'claude']);
    expect(emitted).toEqual(snapshot.events);

    const rawMatches = await service.search(projectPath, 'RAW_ONLY_SEARCH_NEEDLE');
    expect(rawMatches).toHaveLength(calls.length);
    expect(rawMatches.every(({ metadata }) => metadata?.source === 'raw' && typeof metadata.line === 'number')).toBe(true);
    const reviewTranscript = snapshot.events.find(({ type }) => type === 'review')?.metadata?.transcript;
    expect(typeof reviewTranscript).toBe('string');
    expect(await service.readTranscript(projectPath, String(reviewTranscript))).toContain('RAW_ONLY_SEARCH_NEEDLE');
  }), 60_000);

  it('turns a model-produced plan into assigned tasks with a valid dependency chain', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const calls: CliRequest[] = [];
    const runModel = vi.fn(async (request: CliRequest): Promise<CliResult> => {
      calls.push(request);
      return recordMockTranscript(request, JSON.stringify([
        { title: 'Implement TypeScript search', description: 'Build search code', acceptanceCriteria: ['A query returns matching events'], dependsOnIndexes: [] },
        { title: 'Write a report', description: 'Document the search behavior', acceptanceCriteria: ['The report explains the query'], dependsOnIndexes: [0] },
      ]));
    });
    const service = createService({ registryPath: path.join(workspace, 'registry.json'), emit: () => undefined, runModel, autoStartSessions: false });
    await service.createProject({ path: projectPath, name: 'Example', goal: 'Search project history', defaultDebateRounds: 3 });
    await service.updateCharter(projectPath, 'Every task must have a reviewer.');

    const snapshot = await service.planTasks(projectPath, 'Build search and its documentation');
    expect(calls.map(({ phase, readOnly, choice }) => [phase, readOnly, choice.provider])).toEqual([['task-planning', true, 'codex']]);
    expect(calls[0].prompt).toContain('Build search and its documentation');
    expect(calls[0].prompt).toContain('Every task must have a reviewer.');
    expect(snapshot.tasks.map(({ title }) => title)).toEqual(['Implement TypeScript search', 'Write a report']);
    expect(snapshot.tasks.map(({ executor, reviewer }) => [executor.provider, reviewer.provider]))
      .toEqual([['codex', 'claude'], ['claude', 'codex']]);
    expect(snapshot.tasks.map(({ debateRounds }) => debateRounds)).toEqual([3, 3]);
    expect(snapshot.tasks[1].dependsOn).toEqual([snapshot.tasks[0].id]);
    expect(snapshot.events.some(({ type, metadata }) => type === 'decision' && Boolean(metadata?.transcript))).toBe(true);
  }), 30_000);

  it('starts both project sessions and reuses separate provider sessions throughout task debate', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const calls: CliRequest[] = [];
    const sessionIds: Record<string, string> = {
      'project:codex': '00000000-0000-4000-8000-000000000001',
      'project:claude': '00000000-0000-4000-8000-000000000002',
      'debate:codex': '00000000-0000-4000-8000-000000000003',
      'debate:claude': '00000000-0000-4000-8000-000000000004',
    };
    const runModel = vi.fn(async (request: CliRequest): Promise<CliResult> => {
      calls.push(request);
      const purpose = request.phase === 'project-kickoff' ? 'project' : 'debate';
      const sessionId = sessionIds[`${purpose}:${request.choice.provider}`];
      if (!sessionId) throw new Error(`Unexpected mock phase: ${request.phase}`);
      return { ...await recordMockTranscript(request, `${request.choice.provider} ${request.phase} answer`), sessionId };
    });
    const service = createService({ registryPath: path.join(workspace, 'registry.json'), emit: () => undefined, runModel });

    const created = await service.createProject({ path: projectPath, name: 'Session project', goal: 'Keep model conversations', defaultDebateRounds: 2 });
    const kickoffCalls = calls.filter(({ phase }) => phase === 'project-kickoff');
    expect(kickoffCalls.map(({ choice }) => choice.provider).sort()).toEqual(['claude', 'codex']);
    expect(kickoffCalls.every(({ sessionId, readOnly, cwd }) => sessionId === undefined && readOnly && cwd === projectPath)).toBe(true);
    expect(created.project.sessions?.map(({ provider, sessionId, purpose }) => [provider, sessionId, purpose]).sort())
      .toEqual([
        ['claude', sessionIds['project:claude'], 'project'],
        ['codex', sessionIds['project:codex'], 'project'],
      ]);
    const projectHosts = created.project.sessions?.map(({ hostId }) => hostId) ?? [];
    expect(projectHosts).toHaveLength(2);
    expect(projectHosts.every((hostId) => typeof hostId === 'string' && hostId.length > 0)).toBe(true);
    expect(new Set(projectHosts).size).toBe(1);
    expect(created.events.filter(({ type, actor }) => type === 'system' && (actor === 'codex' || actor === 'claude'))
      .map(({ actor, metadata }) => [actor, metadata?.sessionId]).sort())
      .toEqual([
        ['claude', sessionIds['project:claude']],
        ['codex', sessionIds['project:codex']],
      ]);
    const offlineReader = createService({
      registryPath: path.join(workspace, 'another-user', 'registry.json'),
      emit: () => undefined,
      runModel,
      autoStartSessions: false,
    });
    expect(await offlineReader.readSessionHistory(projectPath, sessionIds['project:claude'])).toMatchObject([
      { event: { message: 'claude project-kickoff answer' }, prompt: expect.stringContaining('프로젝트 Session project') },
    ]);
    await expect(offlineReader.readSessionHistory(projectPath, randomUUID())).rejects.toThrow('세션을 찾을 수 없습니다');

    await service.createProject({ path: projectPath, name: 'Session project', goal: 'Keep model conversations' });
    expect(calls.filter(({ phase }) => phase === 'project-kickoff')).toHaveLength(2);

    const task = (await service.createTask(projectPath, taskInput())).tasks[0];
    await service.runDebate(projectPath, task.id);
    const debateCalls = calls.filter(({ phase }) => phase.startsWith('debate-'));
    const perProvider = (provider: 'codex' | 'claude') => debateCalls.filter(({ choice }) => choice.provider === provider);
    expect(perProvider('codex').map(({ phase }) => phase))
      .toEqual(['debate-proposal', 'debate-critique-1', 'debate-response-2', 'debate-evaluation']);
    expect(perProvider('claude').map(({ phase }) => phase))
      .toEqual(['debate-proposal', 'debate-critique-1', 'debate-response-2', 'debate-evaluation', 'debate-synthesis']);
    expect((['codex', 'claude'] as const).map((provider) => perProvider(provider)
      .map(({ sessionId }) => sessionId)))
      .toEqual([
        [undefined, ...Array(3).fill(sessionIds['debate:codex'])],
        [undefined, ...Array(4).fill(sessionIds['debate:claude'])],
      ]);

    const snapshot = await service.openProject(projectPath);
    expect(snapshot.tasks[0].sessions?.map(({ provider, sessionId, purpose }) => [provider, sessionId, purpose]).sort())
      .toEqual([
        ['claude', sessionIds['debate:claude'], 'debate'],
        ['codex', sessionIds['debate:codex'], 'debate'],
      ]);
    expect(new Set(snapshot.tasks[0].sessions?.map(({ hostId }) => hostId))).toEqual(new Set(projectHosts));
    expect(snapshot.events.filter(({ taskId }) => taskId === task.id)
      .filter(({ actor }) => actor === 'codex' || actor === 'claude')
      .every(({ actor, metadata }) => metadata?.sessionId === sessionIds[`debate:${actor}`])).toBe(true);
    const committedProject = JSON.parse(await git(projectPath, ['show', 'HEAD:.llm-collaboration/project.json'])) as { sessions?: { sessionId: string; hostId: string }[] };
    const committedTasks = JSON.parse(await git(projectPath, ['show', 'HEAD:.llm-collaboration/tasks.json'])) as { sessions?: { sessionId: string; hostId: string }[] }[];
    expect(committedProject.sessions?.map(({ sessionId }) => sessionId).sort())
      .toEqual([sessionIds['project:claude'], sessionIds['project:codex']].sort());
    expect(committedTasks[0].sessions?.map(({ sessionId }) => sessionId).sort())
      .toEqual([sessionIds['debate:claude'], sessionIds['debate:codex']].sort());
    expect(new Set(committedProject.sessions?.map(({ hostId }) => hostId))).toEqual(new Set(projectHosts));
    expect(new Set(committedTasks[0].sessions?.map(({ hostId }) => hostId))).toEqual(new Set(projectHosts));

    const otherCalls: CliRequest[] = [];
    const otherSessionIds: Record<string, string> = {
      'project:codex': '00000000-0000-4000-8000-000000000005',
      'project:claude': '00000000-0000-4000-8000-000000000006',
      'debate:codex': '00000000-0000-4000-8000-000000000007',
      'debate:claude': '00000000-0000-4000-8000-000000000008',
    };
    const otherService = createService({
      registryPath: path.join(workspace, 'other-host', 'registry.json'),
      emit: () => undefined,
      runModel: async (request): Promise<CliResult> => {
        otherCalls.push(request);
        const purpose = request.phase === 'project-kickoff' ? 'project' : 'debate';
        const sessionId = otherSessionIds[`${purpose}:${request.choice.provider}`];
        if (!sessionId) throw new Error(`Unexpected mock phase: ${request.phase}`);
        return { ...await recordMockTranscript(request, `${request.choice.provider} ${request.phase} on another host`), sessionId };
      },
    });
    const openedElsewhere = await otherService.createProject({ path: projectPath, name: 'Session project', goal: 'Keep model conversations' });
    expect(openedElsewhere.localHostId).not.toBe(created.localHostId);
    expect(otherCalls.filter(({ phase }) => phase === 'project-kickoff')).toHaveLength(2);
    expect(otherCalls.filter(({ phase }) => phase === 'project-kickoff').every(({ sessionId }) => sessionId === undefined)).toBe(true);
    expect(openedElsewhere.project.sessions?.filter(({ hostId }) => hostId === openedElsewhere.localHostId)).toHaveLength(2);

    await otherService.runDebate(projectPath, task.id);
    const otherDebateCalls = otherCalls.filter(({ phase }) => phase.startsWith('debate-'));
    expect((['codex', 'claude'] as const).map((provider) => otherDebateCalls.filter(({ choice }) => choice.provider === provider)
      .map(({ sessionId }) => sessionId)))
      .toEqual([
        [undefined, ...Array(3).fill(otherSessionIds['debate:codex'])],
        [undefined, ...Array(4).fill(otherSessionIds['debate:claude'])],
      ]);
    const afterOtherHost = await otherService.openProject(projectPath);
    expect(afterOtherHost.tasks[0].sessions?.filter(({ hostId }) => hostId === afterOtherHost.localHostId)).toHaveLength(2);
    expect(afterOtherHost.tasks[0].sessions?.filter(({ hostId }) => hostId === created.localHostId)).toHaveLength(2);
  }), 60_000);
});

describe('local CLI executable settings', () => {
  it('persists a selected executable beside the registry and restores automatic discovery', () => withTemporaryWorkspace(async (workspace) => {
    const registryPath = path.join(workspace, 'app-data', 'registry.json');
    const settingsPath = path.join(workspace, 'app-data', 'cli-settings.json');
    const selected = path.join(workspace, 'custom-cli', 'codex.exe');
    await mkdir(path.dirname(selected), { recursive: true });
    await writeFile(selected, '', 'utf8');
    const mockedStatus = vi.mocked(cliStatus);
    const originalImplementation = mockedStatus.getMockImplementation();
    mockedStatus.mockImplementation(async (provider, _cwd, configuredPath) => ({
      provider,
      installed: true,
      version: provider === 'codex' ? 'codex-cli 0.158.0' : 'Claude Code 2.0.0',
      authentication: provider === 'codex' ? 'ChatGPT 구독 로그인' : 'Claude 구독 로그인',
      executable: configuredPath ?? `${provider}-auto`,
      configured: configuredPath !== undefined,
    }));
    try {
      const firstService = createService({ registryPath, emit: () => undefined, autoStartSessions: false });
      const configured = await firstService.setCliExecutable('codex', selected);
      expect(configured.find(({ provider }) => provider === 'codex'))
        .toMatchObject({ executable: selected, configured: true, installed: true });
      expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({ codex: selected });

      const restartedService = createService({ registryPath, emit: () => undefined, autoStartSessions: false });
      expect((await restartedService.refreshCliStatus()).find(({ provider }) => provider === 'codex'))
        .toMatchObject({ executable: selected, configured: true });
      expect((await restartedService.setCliExecutable('codex', null)).find(({ provider }) => provider === 'codex'))
        .toMatchObject({ executable: 'codex-auto', configured: false });
      expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({});
    } finally {
      if (originalImplementation) mockedStatus.mockImplementation(originalImplementation);
    }
  }));
});

describe('project deletion', () => {
  it('removes a registered project from the app while keeping its existing folder and Git history', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const registryPath = path.join(workspace, 'registry.json');
    const trashed: string[] = [];
    const service = createService({ registryPath, emit: () => undefined, autoStartSessions: false,
      trashItem: async (target) => { trashed.push(target); } });
    const created = await service.createProject({ path: projectPath, name: 'Keep local files', goal: 'Remove only the app entry' });
    const userFile = path.join(projectPath, 'keep.txt');
    await writeFile(userFile, 'Keep this file', 'utf8');
    await expect(service.unregisterProjectOnly(projectPath, created.project.id, 'wrong name')).rejects.toThrow('일치하지 않습니다');
    await service.unregisterProjectOnly(projectPath, created.project.id, created.project.name);
    expect(trashed).toEqual([]);
    expect(await readFile(userFile, 'utf8')).toBe('Keep this file');
    expect(await readFile(path.join(projectPath, '.llm-collaboration', 'project.json'), 'utf8')).toContain(created.project.id);
    expect(JSON.parse(await readFile(registryPath, 'utf8'))).toEqual([]);
  }), 30_000);

  it('offers registration-only cleanup after the operating system aborts trashing an existing folder', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const service = createService({ registryPath: path.join(workspace, 'registry.json'), emit: () => undefined,
      autoStartSessions: false, trashItem: async () => { throw new Error('Operation was aborted'); } });
    const created = await service.createProject({ path: projectPath, name: 'Recycle failure', goal: 'Keep the files' });
    await expect(service.deleteProject(projectPath, created.project.id, created.project.name))
      .rejects.toThrow('앱 목록에서만 제거');
    expect((await service.bootstrap()).projects).toHaveLength(1);
    await service.unregisterProjectOnly(projectPath, created.project.id, created.project.name);
    expect((await service.bootstrap()).projects).toEqual([]);
    expect(await readFile(path.join(projectPath, '.llm-collaboration', 'project.json'), 'utf8')).toContain(created.project.id);
  }), 30_000);

  it('requires the project name and moves its folder and managed worktrees before removing the registry entry', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const registryPath = path.join(workspace, 'app-data', 'registry.json');
    const trashed: string[] = [];
    const service = createService({
      registryPath,
      emit: () => undefined,
      autoStartSessions: false,
      trashItem: async (target) => {
        if (!path.relative(workspace, target) || path.relative(workspace, target).startsWith('..')) {
          throw new Error(`Test refused to delete outside its temporary workspace: ${target}`);
        }
        trashed.push(target);
        await rm(target, { recursive: true });
      },
    });
    const created = await service.createProject({ path: projectPath, name: 'Delete me', goal: 'Test deletion' });
    const task = (await service.createTask(projectPath, taskInput())).tasks[0];
    const worktree = await ensureTaskWorktree(projectPath, created.project.id, task.id);
    await writeFile(path.join(projectPath, 'user-artifact.txt'), 'User content', 'utf8');

    await expect(service.deleteProject(projectPath, created.project.id, 'wrong name')).rejects.toThrow('일치하지 않습니다');
    expect(trashed).toHaveLength(0);
    expect(await readFile(path.join(projectPath, 'user-artifact.txt'), 'utf8')).toBe('User content');

    await service.deleteProject(projectPath, created.project.id, created.project.name);
    expect(trashed).toContain(projectWorktreeDirectory(projectPath, created.project.id));
    expect(trashed).toContain(projectPath);
    await expect(readFile(path.join(projectPath, 'user-artifact.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(worktree.directory, '.git'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await readFile(registryPath, 'utf8'))).toEqual([]);
    expect((await service.bootstrap()).projects).toEqual([]);
  }), 30_000);

  it('stops deletion when a Git worktree is outside the app-owned directory', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const externalWorktree = path.join(workspace, 'external-worktree');
    const trashed: string[] = [];
    const service = createService({
      registryPath: path.join(workspace, 'app-data', 'registry.json'),
      emit: () => undefined,
      autoStartSessions: false,
      trashItem: async (target) => { trashed.push(target); },
    });
    const created = await service.createProject({ path: projectPath, name: 'Keep me', goal: 'Protect external worktrees' });
    await git(projectPath, ['worktree', 'add', '-b', 'external-test', externalWorktree, 'HEAD']);

    await expect(service.deleteProject(projectPath, created.project.id, created.project.name)).rejects.toThrow('관리 범위 밖');
    expect(trashed).toEqual([]);
    expect((await service.bootstrap()).projects).toHaveLength(1);
  }), 30_000);

  it('removes only the registration when the project folder was already deleted', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const trashed: string[] = [];
    const service = createService({
      registryPath: path.join(workspace, 'registry.json'), emit: () => undefined, autoStartSessions: false,
      trashItem: async (target) => { trashed.push(target); },
    });
    const created = await service.createProject({ path: projectPath, name: 'Already gone', goal: 'Clean stale registration' });
    await rm(projectPath, { recursive: true });
    expect((await service.bootstrap()).missingProjectPaths).toEqual([projectPath]);
    expect(await service.deleteProject(projectPath, created.project.id, created.project.name)).toBe('unregistered');
    expect(trashed).toEqual([]);
    expect((await service.bootstrap()).missingProjectPaths).toEqual([]);
  }), 30_000);

  it('offers a separate cleanup action for a missing folder after restart', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const service = createService({ registryPath: path.join(workspace, 'registry.json'), emit: () => undefined, autoStartSessions: false });
    await service.createProject({ path: projectPath, name: 'Missing later', goal: 'Clean registration' });
    await expect(service.forgetMissingProject(projectPath)).rejects.toThrow('아직 있습니다');
    await rm(projectPath, { recursive: true });
    await service.forgetMissingProject(projectPath);
    expect((await service.bootstrap()).missingProjectPaths).toEqual([]);
  }), 30_000);

  it('unregisters without touching an existing folder when its project record is gone', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const service = createService({ registryPath: path.join(workspace, 'registry.json'), emit: () => undefined, autoStartSessions: false });
    const created = await service.createProject({ path: projectPath, name: 'Metadata missing', goal: 'Keep unrelated files' });
    const userFile = path.join(projectPath, 'keep.txt');
    await writeFile(userFile, 'Keep this file', 'utf8');
    await rm(path.join(projectPath, '.llm-collaboration', 'project.json'));
    expect((await service.bootstrap()).missingProjectPaths).toEqual([projectPath]);
    expect(await service.deleteProject(projectPath, created.project.id, created.project.name)).toBe('unregistered');
    expect(await readFile(userFile, 'utf8')).toBe('Keep this file');
  }), 30_000);
});

describe('conversation import', () => {
  it('archives a prior chat and carries it into a new collaboration task', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const source = path.join(workspace, 'prior-codex-chat.jsonl');
    const raw = [
      { type: 'session_meta', payload: { session_id: 'prior-session' } },
      { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Continue the search feature from our prior chat' }] } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'The search index still needs tests' }] } },
    ].map(JSON.stringify).join('\n');
    await writeFile(source, raw, 'utf8');
    const service = createService({ registryPath: path.join(workspace, 'registry.json'), emit: () => undefined, autoStartSessions: false });
    await service.createProject({ path: projectPath, name: 'Imported chat project', goal: 'Finish existing work' });
    const importedSnapshot = await service.importConversation(projectPath, 'codex', source);
    const imported = importedSnapshot.project.importedConversations?.[0];
    expect(imported?.sessionId).toBe('prior-session');
    expect(await service.readImportedConversation(projectPath, imported!.id)).toHaveLength(2);
    expect(await readFile(path.join(projectPath, '.llm-collaboration', 'imports', `${imported!.id}.jsonl`), 'utf8')).toBe(raw);
    expect(await service.readImportedConversationRaw(projectPath, imported!.id)).toBe(raw);
    const task = (await service.createTask(projectPath, taskInput({ sourceConversationIds: [imported!.id] }))).tasks[0];
    expect(task.sourceContext).toContain('The search index still needs tests');
    expect(task.sourceContext).toContain(`imports/${imported!.id}.jsonl`);
    expect((await service.search(projectPath, 'index still needs tests')).some((result) => result.metadata?.conversationId === imported!.id)).toBe(true);
    await expect(service.importConversation(projectPath, 'codex', source)).rejects.toThrow('이미 가져온');
    await expect(service.createTask(projectPath, taskInput({ sourceConversationIds: ['invalid'] }))).rejects.toThrow('저장된 대화만');
  }), 30_000);

  it('starts a new project with a prior chat in both model kickoff prompts', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'existing-work');
    const source = path.join(workspace, 'prior-claude-chat.jsonl');
    const raw = [
      { type: 'user', sessionId: 'prior-claude', message: { role: 'user', content: 'Build an offline screenplay workflow' } },
      { type: 'assistant', sessionId: 'prior-claude', message: { role: 'assistant', content: [{ type: 'text', text: 'The scene editor is already in progress' }] } },
    ].map(JSON.stringify).join('\n');
    await mkdir(projectPath);
    await writeFile(path.join(projectPath, 'existing-work.txt'), 'Keep existing work', 'utf8');
    await writeFile(source, raw, 'utf8');
    const prompts: string[] = [];
    const service = createService({
      registryPath: path.join(workspace, 'registry.json'), emit: () => undefined,
      runModel: async (request) => { prompts.push(request.prompt); return recordMockTranscript(request, 'Understood'); },
    });
    const created = await service.createProject({
      path: projectPath, name: 'Collaborative screenplay', goal: 'Finish the screenplay app',
      initialConversation: { provider: 'claude', filePath: source },
    });
    expect(created.project.importedConversations?.[0].sessionId).toBe('prior-claude');
    expect(prompts).toHaveLength(2);
    expect(prompts.every((prompt) => prompt.includes('The scene editor is already in progress'))).toBe(true);
    expect(await readFile(path.join(projectPath, 'existing-work.txt'), 'utf8')).toBe('Keep existing work');
  }), 30_000);
});
