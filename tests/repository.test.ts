import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendEvent,
  commitMetadata,
  commitTaskWorktree,
  ensureProjectRepository,
  ensureTaskWorktree,
  git,
  integrateTask,
  projectFiles,
  readEvents,
  readProject,
  readTasks,
  removeTaskWorktree,
  taskChangedFiles,
  taskWorktree,
  writeJson,
} from '../src/main/services/repository';
import type { CollaborationEvent, Project, Task } from '../src/shared/types';

const withTemporaryWorkspace = async <T>(run: (workspace: string) => Promise<T>): Promise<T> => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'llm-collaboration-test-'));
  try {
    return await run(workspace);
  } finally {
    const [actualParent, expectedParent] = await Promise.all([
      realpath(path.dirname(workspace)),
      realpath(os.tmpdir()),
    ]);
    if (actualParent !== expectedParent || !path.basename(workspace).startsWith('llm-collaboration-test-')) {
      throw new Error(`Refusing to remove an unexpected test directory: ${workspace}`);
    }
    await rm(workspace, { recursive: true, force: true });
  }
};

const fixtureProject = (projectPath: string): Project => ({
  id: 'project-one',
  name: 'Example',
  path: projectPath,
  goal: 'Deliver a reviewed result',
  charter: 'Keep a searchable audit trail',
  defaultDebateRounds: 2,
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
});

const fixtureTask = (): Task => ({
  id: 'task-one',
  title: 'Implement a feature',
  description: 'Add a small file',
  acceptanceCriteria: ['The file is committed'],
  mode: 'manual',
  executor: { provider: 'codex', model: '' },
  reviewer: { provider: 'claude', model: '' },
  dependsOn: [],
  debateRounds: 2,
  status: 'draft',
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
  artifacts: [],
});

const fixtureEvent = (id: string, taskId?: string): CollaborationEvent => ({
  id,
  projectId: 'project-one',
  taskId,
  actor: id === 'decision' ? 'user' : 'codex',
  type: id === 'decision' ? 'decision' : 'proposal',
  message: `Message ${id}\nSecond line with 한글`,
  timestamp: '2026-09-29T00:00:00.000Z',
  round: 2,
});

const firstCommit = async (projectPath: string): Promise<void> => {
  await writeFile(path.join(projectPath, 'README.md'), '# Initial project\n', 'utf8');
  await git(projectPath, ['add', '--', 'README.md']);
  await git(projectPath, [
    '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
    'commit', '-m', 'Initial project',
  ]);
};

describe('local project persistence', () => {
  it('round trips project, tasks, and ordered multiline event records', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    const files = projectFiles(projectPath);
    const project = fixtureProject(projectPath);
    const task = fixtureTask();
    const events = [fixtureEvent('first', task.id), fixtureEvent('decision'), fixtureEvent('last', task.id)];

    expect(await readTasks(projectPath)).toEqual([]);
    expect(await readEvents(projectPath)).toEqual([]);
    await writeJson(files.project, project);
    await writeJson(files.tasks, [task]);
    await events.reduce<Promise<void>>(
      (previous, event) => previous.then(() => appendEvent(projectPath, event)),
      Promise.resolve(),
    );

    expect(await readProject(projectPath)).toEqual(project);
    expect(await readTasks(projectPath)).toEqual([task]);
    expect((await readEvents(projectPath)).map(({ id }) => id)).toEqual(events.map(({ id }) => id));
    expect(await readEvents(projectPath)).toEqual(events);
    expect((await readFile(files.events, 'utf8')).trimEnd().split('\n')).toHaveLength(events.length);
  }));

  it('commits only collaboration metadata while preserving an unrelated staged change', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    await ensureProjectRepository(projectPath);
    await writeJson(projectFiles(projectPath).project, fixtureProject(projectPath));
    await commitMetadata(projectPath, 'Save project');
    expect(await git(projectPath, ['show', '--pretty=format:', '--name-only', 'HEAD'])).toBe('.llm-collaboration/project.json');

    await writeFile(path.join(projectPath, 'user-work.txt'), 'Already staged by the user\n', 'utf8');
    await git(projectPath, ['add', '--', 'user-work.txt']);
    await appendEvent(projectPath, fixtureEvent('decision'));
    await commitMetadata(projectPath, 'Record decision');

    expect(await git(projectPath, ['show', '--pretty=format:', '--name-only', 'HEAD'])).toBe('.llm-collaboration/events.jsonl');
    expect(await git(projectPath, ['diff', '--cached', '--name-only'])).toBe('user-work.txt');
    expect(await readEvents(projectPath)).toEqual([fixtureEvent('decision')]);
  }));

  it('rejects a nested project folder inside a different Git repository', () => withTemporaryWorkspace(async (workspace) => {
    const root = path.join(workspace, 'root');
    await ensureProjectRepository(root);
    const nested = path.join(root, 'nested');
    await mkdir(nested);
    await expect(ensureProjectRepository(nested)).rejects.toThrow('저장소 루트를 선택하세요');
    expect(await realpath(await git(nested, ['rev-parse', '--show-toplevel']))).toBe(await realpath(root));
  }));
});

describe('isolated task worktrees', () => {
  it('commits an artifact in its task branch, lets the base inspect it, and integrates it after review', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    await ensureProjectRepository(projectPath);
    await firstCommit(projectPath);

    const task = await ensureTaskWorktree(projectPath, 'project-one', 'task-one');
    expect(task.directory).toBe(taskWorktree(projectPath, 'project-one', 'task-one'));
    expect(await git(task.directory, ['branch', '--show-current'])).toBe(task.branch);
    expect(await ensureTaskWorktree(projectPath, 'project-one', 'task-one')).toEqual(task);

    await writeFile(path.join(task.directory, 'feature.txt'), 'Implemented in the task worktree\n', 'utf8');
    expect(await commitTaskWorktree(task.directory, 'Implement feature')).toEqual(['feature.txt']);
    await expect(readFile(path.join(projectPath, 'feature.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await taskChangedFiles(projectPath, task.branch)).toEqual(['feature.txt']);

    await integrateTask(projectPath, task.branch);
    expect((await readFile(path.join(projectPath, 'feature.txt'), 'utf8')).replace(/\r\n/gu, '\n'))
      .toBe('Implemented in the task worktree\n');
    expect(await git(projectPath, ['log', '-1', '--format=%s'])).toBe(`Integrate ${task.branch}`);
    await removeTaskWorktree(projectPath, task.directory, task.branch);
    expect(await git(projectPath, ['branch', '--list', task.branch])).toBe('');
  }));

  it('keeps collaboration metadata outside a task artifact commit', () => withTemporaryWorkspace(async (workspace) => {
    const projectPath = path.join(workspace, 'project');
    await ensureProjectRepository(projectPath);
    await writeJson(projectFiles(projectPath).project, fixtureProject(projectPath));
    await commitMetadata(projectPath, 'Save project');

    const task = await ensureTaskWorktree(projectPath, 'project-one', 'task-two');
    await writeFile(path.join(task.directory, 'result.txt'), 'User artifact\n', 'utf8');
    await writeFile(path.join(task.directory, '.llm-collaboration', 'project.json'), '{"modified":true}\n', 'utf8');
    expect(await commitTaskWorktree(task.directory, 'Save artifact')).toEqual(['result.txt']);
    expect(await taskChangedFiles(projectPath, task.branch)).toEqual(['result.txt']);
    expect(await git(task.directory, ['status', '--short'])).toContain('.llm-collaboration/project.json');
    await integrateTask(projectPath, task.branch);
    expect(await readProject(projectPath)).toEqual(fixtureProject(projectPath));
    await removeTaskWorktree(projectPath, task.directory, task.branch);
  }));
});
