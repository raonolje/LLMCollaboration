import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createService } from '../src/main/services';
import { git } from '../src/main/services/repository';
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
