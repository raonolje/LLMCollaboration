import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { CollaborationEvent, Project, Task } from '../../shared/types';

const exec = promisify(execFile);
const metadataDirectory = '.llm-collaboration';
const gitIdentity = ['-c', 'user.name=LLM Collaboration', '-c', 'user.email=local@llm-collaboration.invalid'];

export const projectFiles = (projectPath: string) => {
  const directory = path.join(projectPath, metadataDirectory);
  return {
    directory,
    project: path.join(directory, 'project.json'),
    tasks: path.join(directory, 'tasks.json'),
    events: path.join(directory, 'events.jsonl'),
    runs: path.join(directory, 'runs'),
  };
};

const readJson = async <T>(file: string): Promise<T> =>
  JSON.parse(await readFile(file, 'utf8')) as T;

export const readProject = (projectPath: string): Promise<Project> =>
  readJson<Project>(projectFiles(projectPath).project);

export const readTasks = async (projectPath: string): Promise<Task[]> => {
  try {
    return await readJson<Task[]>(projectFiles(projectPath).tasks);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

export const readEvents = async (projectPath: string): Promise<CollaborationEvent[]> => {
  try {
    const content = await readFile(projectFiles(projectPath).events, 'utf8');
    return content.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as CollaborationEvent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
};

export const writeJson = async (file: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
};

export const appendEvent = async (projectPath: string, event: CollaborationEvent): Promise<void> => {
  const file = projectFiles(projectPath).events;
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(event)}\n`, 'utf8');
};

export const git = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await exec('git', args, {
    cwd,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
};

const samePath = (a: string, b: string): boolean => {
  const canonical = (value: string): string => {
    try { return realpathSync.native(value); }
    catch { return path.resolve(value); }
  };
  const left = canonical(a);
  const right = canonical(b);
  return process.platform === 'win32'
    ? left.toLocaleLowerCase() === right.toLocaleLowerCase()
    : left === right;
};

export const ensureProjectRepository = async (projectPath: string): Promise<void> => {
  await mkdir(projectPath, { recursive: true });
  try {
    const root = await git(projectPath, ['rev-parse', '--show-toplevel']);
    if (!samePath(root, projectPath)) {
      throw new Error(`선택한 폴더가 상위 Git 저장소에 속합니다. 저장소 루트를 선택하세요: ${root}`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('선택한 폴더')) throw error;
    await git(projectPath, ['init', '-b', 'main']);
  }
};

export const commitMetadata = async (projectPath: string, message: string): Promise<void> => {
  await git(projectPath, ['add', '--', metadataDirectory]);
  const changed = await git(projectPath, ['diff', '--cached', '--name-only', '--', metadataDirectory]);
  if (!changed) return;
  await git(projectPath, [...gitIdentity, 'commit', '-m', message, '--', metadataDirectory]);
};

export const taskBranch = (taskId: string): string => `llm/task-${taskId.replace(/[^a-zA-Z0-9-]/gu, '')}`;

export const projectWorktreeDirectory = (projectPath: string, projectId: string): string =>
  path.join(path.dirname(projectPath), `${path.basename(projectPath)}.llm-worktrees`, projectId);

export const taskWorktree = (projectPath: string, projectId: string, taskId: string): string =>
  path.join(projectWorktreeDirectory(projectPath, projectId), taskId);

export const ensureTaskWorktree = async (
  projectPath: string,
  projectId: string,
  taskId: string,
): Promise<{ directory: string; branch: string }> => {
  const directory = taskWorktree(projectPath, projectId, taskId);
  const branch = taskBranch(taskId);
  try {
    if ((await stat(directory)).isDirectory()) {
      const actualBranch = await git(directory, ['branch', '--show-current']).catch(() => '');
      if (actualBranch !== branch) throw new Error(`기존 작업 폴더가 예상한 브랜치와 다릅니다: ${directory}`);
      return { directory, branch };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(directory), { recursive: true });
  await git(projectPath, ['worktree', 'add', '-b', branch, directory, 'HEAD']);
  return { directory, branch };
};

export const commitTaskWorktree = async (directory: string, message: string): Promise<string[]> => {
  await git(directory, ['add', '-A', '--', '.', `:(exclude)${metadataDirectory}`]);
  const changed = await git(directory, ['diff', '--cached', '--name-only']);
  if (!changed) return [];
  await git(directory, [...gitIdentity, 'commit', '-m', message]);
  return changed.split(/\r?\n/u).filter(Boolean);
};

export const taskChangedFiles = async (projectPath: string, branch: string): Promise<string[]> => {
  const base = await git(projectPath, ['merge-base', 'HEAD', branch]);
  const changed = await git(projectPath, ['diff', '--name-only', base, branch]);
  return changed.split(/\r?\n/u).filter(Boolean);
};

export const integrateTask = async (projectPath: string, branch: string): Promise<void> => {
  const staged = await git(projectPath, ['diff', '--cached', '--name-only']);
  if (staged) throw new Error('프로젝트에 사용자가 스테이징한 변경이 있습니다. 통합 전에 해당 변경을 커밋하거나 스테이징을 해제하세요.');
  try {
    await git(projectPath, [...gitIdentity, 'merge', '--no-ff', '--no-edit', '-m', `Integrate ${branch}`, branch]);
  } catch (error) {
    await git(projectPath, ['merge', '--abort']).catch(() => undefined);
    throw error;
  }
};

export const removeTaskWorktree = async (projectPath: string, directory: string, branch: string): Promise<void> => {
  await git(projectPath, ['worktree', 'remove', '--force', directory]);
  await git(projectPath, ['branch', '-d', branch]);
};
