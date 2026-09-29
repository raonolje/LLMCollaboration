import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, realpathSync } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type {
  Bootstrap,
  CliStatus,
  CollaborationAPI,
  CollaborationEvent,
  ChatModelSettings,
  ChatAttachment,
  ChatFileInput,
  DebateFollowUp,
  EventType,
  ExternalSession,
  ModelChoice,
  Project,
  ProjectInput,
  ProjectSnapshot,
  Provider,
  SessionTurn,
  Task,
  TaskInput,
  TaskStatus,
} from '../../shared/types';
import { assertSubscription, cliStatus, openCliSession, runCli, type CliRequest, type CliResult } from './cli';
import { debatePrompt, executionPrompt, projectChatGuidance, reviewPrompt, taskCard } from './prompts';
import {
  appendEvent,
  commitMetadata,
  commitTaskWorktree,
  ensureProjectRepository,
  ensureTaskWorktree,
  git,
  integrateTask,
  projectFiles,
  projectWorktreeDirectory,
  readEvents,
  readProject,
  readTasks,
  removeTaskWorktree,
  taskChangedFiles,
  taskWorktree,
  writeJson,
} from './repository';
import { conversationContext, importConversationFile, listLocalConversations, readImportedRaw, readImportedTurns } from './conversation-import';
import { discoverModelCatalog } from './model-catalog';

export type Service = Omit<CollaborationAPI, 'chooseDirectory' | 'chooseCliExecutable' | 'chooseConversationFile' | 'chooseChatFiles' | 'onEvent' | 'openDesktopSession' | 'handoffClaudeSession' | 'consumeLaunchRequest' | 'onLaunchRequest' | 'installChatSkills' | 'checkAppUpdate' | 'downloadAppUpdate' | 'remoteStatus' | 'setRemoteEnabled' | 'rotateRemoteToken'> & { listProjects: () => Promise<Project[]> };

export type ServiceOptions = Readonly<{
  registryPath: string;
  emit: (event: CollaborationEvent) => void;
  runModel?: typeof runCli;
  autoStartSessions?: boolean;
  trashItem?: (target: string) => Promise<void>;
}>;

const providers: readonly Provider[] = ['codex', 'claude'];
const isImageAttachment = (file: string): boolean => /\.(?:png|jpe?g|webp|gif)$/iu.test(file);
const opposite = (provider: Provider): Provider => provider === 'codex' ? 'claude' : 'codex';
const now = (): string => new Date().toISOString();
const key = (projectPath: string, taskId: string): string => `${path.resolve(projectPath)}::${taskId}`;
const canonicalPath = (value: string): string => {
  try { return realpathSync.native(value); }
  catch { return path.resolve(value); }
};
const samePath = (left: string, right: string): boolean =>
  process.platform === 'win32'
    ? canonicalPath(left).toLocaleLowerCase() === canonicalPath(right).toLocaleLowerCase()
    : canonicalPath(left) === canonicalPath(right);
const containsPath = (parent: string, child: string): boolean => {
  const relative = path.relative(canonicalPath(parent), canonicalPath(child));
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};
const assertRealDirectory = async (directory: string): Promise<void> => {
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error(`실제 폴더만 삭제할 수 있습니다: ${directory}`);
  }
};
const directoryMissing = async (directory: string): Promise<boolean> =>
  lstat(directory).then(() => false).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  });
const projectRecordMissing = (projectPath: string): Promise<boolean> =>
  directoryMissing(projectFiles(projectPath).project);
const assertSafeProjectDirectory = async (directory: string, registryPath: string): Promise<void> => {
  const home = os.homedir();
  const protectedLocations = [
    home,
    ...['Desktop', 'Documents', 'Downloads', 'Pictures', 'Music', 'Videos', 'AppData'].map((name) => path.join(home, name)),
    registryPath,
    process.execPath,
  ];
  if (samePath(directory, path.parse(directory).root)
    || protectedLocations.some((location) => containsPath(directory, location))) {
    throw new Error('시스템 또는 사용자 기본 폴더를 포함하는 경로는 삭제할 수 없습니다.');
  }
  await assertRealDirectory(directory);
};
const modelFor = (task: Task, provider: Provider): ModelChoice =>
  [task.executor, task.reviewer].find((choice) => choice.provider === provider) ?? { provider, model: 'default' };

const roundCount = (value: number | undefined, fallback = 2, allowZero = false): number => {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < (allowZero ? 0 : 1) || resolved > 20) {
    throw new Error(`토론 왕복 횟수는 ${allowZero ? '0' : '1'}~20 사이의 정수여야 합니다.`);
  }
  return resolved;
};

const validateTaskInput = (input: TaskInput, project: Project, tasks: readonly Task[]): TaskInput => {
  if (!input.title?.trim() || !input.description?.trim()) throw new Error('업무 제목과 설명을 입력하세요.');
  if (!Array.isArray(input.acceptanceCriteria) || !input.acceptanceCriteria.some((criterion) => criterion.trim())) {
    throw new Error('업무 완료 기준을 하나 이상 입력하세요.');
  }
  if (!Array.isArray(input.dependsOn) || input.dependsOn.some((id) => !tasks.some((task) => task.id === id))) {
    throw new Error('선행 업무 ID가 올바르지 않습니다.');
  }
  if (!providers.includes(input.executor.provider) || !providers.includes(input.reviewer.provider)) {
    throw new Error('Codex 또는 Claude 모델을 지정하세요.');
  }
  if (input.mode === 'manual' && input.executor.provider === input.reviewer.provider) {
    throw new Error('교차 검수를 위해 실행과 검수에 서로 다른 모델을 지정하세요.');
  }
  return {
    title: input.title.trim(),
    description: input.description.trim(),
    acceptanceCriteria: input.acceptanceCriteria.map((criterion) => criterion.trim()).filter(Boolean),
    mode: input.mode,
    executor: input.executor,
    reviewer: input.reviewer,
    dependsOn: [...new Set(input.dependsOn)],
    debateRounds: roundCount(input.debateRounds, project.defaultDebateRounds),
    sourceConversationIds: input.sourceConversationIds ?? [],
  };
};

const autoChoices = (input: Pick<TaskInput, 'title' | 'description' | 'acceptanceCriteria'>, tasks: readonly Task[]): Pick<TaskInput, 'executor' | 'reviewer'> => {
  const text = `${input.title} ${input.description} ${input.acceptanceCriteria.join(' ')}`.toLocaleLowerCase();
  const codeSignals = /코드|구현|개발|버그|리팩터|테스트|빌드|배포|프로그래밍|typescript|javascript|react|electron|python|api|fix|code|implement|refactor/iu;
  const writingSignals = /보고서|문서|기획|분석|조사|요약|번역|글쓰기|research|report|document|plan|analysis/iu;
  const codexCount = tasks.filter((task) => task.executor.provider === 'codex' && !['approved', 'failed'].includes(task.status)).length;
  const claudeCount = tasks.filter((task) => task.executor.provider === 'claude' && !['approved', 'failed'].includes(task.status)).length;
  const executor: Provider = codeSignals.test(text) ? 'codex' : writingSignals.test(text) ? 'claude' : codexCount <= claudeCount ? 'codex' : 'claude';
  return { executor: { provider: executor, model: 'default' }, reviewer: { provider: opposite(executor), model: 'default' } };
};

export const hasDependencyCycle = (tasks: readonly Pick<Task, 'id' | 'dependsOn'>[]): boolean => {
  const byId = new Map(tasks.map((task) => [task.id, task.dependsOn] as const));
  const states = new Map<string, 'visiting' | 'visited'>();
  const visit = (id: string): boolean => {
    const state = states.get(id);
    if (state === 'visiting') return true;
    if (state === 'visited') return false;
    states.set(id, 'visiting');
    const cyclic = (byId.get(id) ?? []).some(visit);
    states.set(id, 'visited');
    return cyclic;
  };
  return tasks.some((task) => visit(task.id));
};

const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const isAbort = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || /aborted|취소/iu.test(error.message));

const searchRun = async (
  projectPath: string,
  project: Project,
  file: string,
  terms: readonly string[],
): Promise<CollaborationEvent[]> => {
  const relative = path.join('.llm-collaboration', 'runs', file);
  const reader = createInterface({ input: createReadStream(path.join(projectPath, relative), { encoding: 'utf8' }), crlfDelay: Infinity });
  const matches: CollaborationEvent[] = [];
  let lineNumber = 0;
  let provider: Provider = 'codex';
  let phase = 'unknown';
  let timestamp = project.createdAt;
  await new Promise<void>((resolve, reject) => {
    reader.on('line', (line) => {
      lineNumber += 1;
      try {
        const record = JSON.parse(line) as { type?: string; provider?: Provider; phase?: string; timestamp?: string; line?: string };
        if (record.type === 'invocation') {
          provider = record.provider ?? provider;
          phase = record.phase ?? phase;
          timestamp = record.timestamp ?? timestamp;
        }
      } catch { /* A malformed raw line is still searchable. */ }
      if (!terms.every((term) => line.toLocaleLowerCase().includes(term))) return;
      const position = Math.max(0, line.toLocaleLowerCase().indexOf(terms[0]) - 500);
      const excerpt = line.length > 1800 ? `${position ? '…' : ''}${line.slice(position, position + 1800)}…` : line;
      matches.push({
        id: createHash('sha256').update(`${relative}:${lineNumber}`).digest('hex'),
        projectId: project.id,
        type: phase.includes('review') ? 'review' : phase.includes('debate') ? 'response' : 'execution',
        actor: provider,
        message: excerpt,
        timestamp,
        metadata: { transcript: relative, line: lineNumber, phase, source: 'raw' },
      });
    });
    reader.once('close', resolve);
    reader.once('error', reject);
  });
  return matches;
};

const resolveRunTranscript = async (projectPath: string, transcript: string): Promise<string> => {
  const projectRoot = await realpath(path.resolve(projectPath));
  const runs = await realpath(projectFiles(path.resolve(projectPath)).runs);
  const candidate = await realpath(path.resolve(projectPath, transcript));
  const runsInsideProject = path.relative(projectRoot, runs);
  const relative = path.relative(runs, candidate);
  if (!runsInsideProject || runsInsideProject.startsWith('..') || path.isAbsolute(runsInsideProject)
    || !relative || relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.jsonl')) {
    throw new Error('프로젝트 실행 기록 폴더의 JSONL 파일만 열 수 있습니다.');
  }
  return candidate;
};

const readInvocationPrompt = async (filename: string): Promise<string> => {
  const stream = createReadStream(filename, { encoding: 'utf8' });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    const firstLine = await new Promise<string>((resolve, reject) => {
      reader.once('line', resolve);
      reader.once('close', () => resolve(''));
      reader.once('error', reject);
      stream.once('error', reject);
    });
    const invocation = JSON.parse(firstLine) as { type?: string; prompt?: unknown };
    return invocation.type === 'invocation' && typeof invocation.prompt === 'string' ? invocation.prompt : '';
  } catch {
    return '';
  } finally {
    reader.close();
    stream.destroy();
  }
};

export const createService = ({ registryPath, emit, runModel = runCli, autoStartSessions = true,
  trashItem = async () => { throw new Error('휴지통 기능을 사용할 수 없습니다.'); } }: ServiceOptions): Service => {
  const cliSettingsPath = path.join(path.dirname(registryPath), 'cli-settings.json');
  const hostIdPromise = (async (): Promise<string> => {
    const file = path.join(path.dirname(registryPath), 'session-host-id');
    const existing = await readFile(file, 'utf8').catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    });
    if (existing.trim()) return existing.trim();
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, randomUUID(), { encoding: 'utf8', flag: 'wx' }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    });
    const hostId = (await readFile(file, 'utf8')).trim();
    if (!hostId) throw new Error('로컬 세션 식별자를 만들지 못했습니다.');
    return hostId;
  })();
  const locks = new Map<string, Promise<unknown>>();
  const active = new Map<string, AbortController>();
  const withLock = <T>(lockKey: string, operation: () => Promise<T>): Promise<T> => {
    const queued = (locks.get(lockKey) ?? Promise.resolve()).catch(() => undefined).then(operation);
    locks.set(lockKey, queued.catch(() => undefined));
    return queued;
  };
  const stateLock = <T>(projectPath: string, operation: () => Promise<T>): Promise<T> =>
    withLock(`state:${projectPath}`, operation);
  const gitLock = <T>(projectPath: string, operation: () => Promise<T>): Promise<T> =>
    withLock(`git:${projectPath}`, operation);
  const checkpoint = (projectPath: string, message: string): Promise<void> =>
    gitLock(projectPath, () => commitMetadata(projectPath, message));

  const readCliSettings = async (): Promise<Partial<Record<Provider, string>>> =>
    readFile(cliSettingsPath, 'utf8').then((content) => JSON.parse(content) as Partial<Record<Provider, string>>)
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
        throw error;
      });
  const cliPathFor = async (provider: Provider): Promise<string | undefined> => (await readCliSettings())[provider];
  const cliStatuses = async (): Promise<CliStatus[]> => {
    const settings = await readCliSettings();
    return Promise.all(providers.map((provider) => cliStatus(provider, process.cwd(), settings[provider])));
  };

  const snapshot = async (projectPath: string): Promise<ProjectSnapshot> => {
    const resolved = path.resolve(projectPath);
    const [project, tasks, events, localHostId] = await Promise.all([
      readProject(resolved), readTasks(resolved), readEvents(resolved), hostIdPromise,
    ]);
    return { project: { ...project, path: resolved }, tasks, events, localHostId };
  };

  const event = async (
    projectPath: string,
    projectId: string,
    type: EventType,
    actor: CollaborationEvent['actor'],
    message: string,
    taskId?: string,
    round?: number,
    metadata?: CollaborationEvent['metadata'],
  ): Promise<CollaborationEvent> => {
    const value: CollaborationEvent = {
      id: randomUUID(), projectId, taskId, type, actor, message, timestamp: now(), round, metadata,
    };
    await stateLock(projectPath, () => appendEvent(projectPath, value));
    emit(value);
    await checkpoint(projectPath, `Record ${type}${taskId ? ` for ${taskId}` : ''}`);
    return value;
  };

  const replaceProject = async (projectPath: string, update: (project: Project) => Project): Promise<ProjectSnapshot> => {
    const project = await stateLock(projectPath, async () => {
      const next = update(await readProject(projectPath));
      await writeJson(projectFiles(projectPath).project, next);
      return next;
    });
    await checkpoint(projectPath, `Update project ${project.name}`);
    return snapshot(projectPath);
  };

  const replaceTask = async (projectPath: string, taskId: string, update: (task: Task) => Task): Promise<Task> => {
    const next = await stateLock(projectPath, async () => {
      const tasks = await readTasks(projectPath);
      const previous = tasks.find((task) => task.id === taskId);
      if (!previous) throw new Error(`업무를 찾을 수 없습니다: ${taskId}`);
      const replacement = { ...update(previous), updatedAt: now() };
      await writeJson(projectFiles(projectPath).tasks, tasks.map((task) => task.id === taskId ? replacement : task));
      return replacement;
    });
    await checkpoint(projectPath, `Update task ${taskId}`);
    return next;
  };

  const status = async (projectPath: string, projectId: string, taskId: string, value: TaskStatus, message: string): Promise<Task> => {
    const task = await replaceTask(projectPath, taskId, (previous) => ({ ...previous, status: value }));
    await event(projectPath, projectId, 'status', 'system', message, taskId);
    return task;
  };

  const readRegisteredPaths = async (): Promise<string[]> =>
    readFile(registryPath, 'utf8')
      .then((content) => JSON.parse(content) as string[])
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      });

  const registerProject = async (projectPath: string): Promise<void> => {
    await withLock('registry', async () => {
      const paths = await readRegisteredPaths();
      if (paths.some((candidate) => samePath(candidate, projectPath))) return;
      await writeJson(registryPath, [...paths, projectPath]);
    });
  };

  const unregisterProject = async (projectPath: string): Promise<void> =>
    withLock('registry', async () => {
      const paths = await readRegisteredPaths();
      await writeJson(registryPath, paths.filter((candidate) => !samePath(candidate, projectPath)));
    });

  const taskById = async (projectPath: string, taskId: string): Promise<{ project: Project; task: Task; events: CollaborationEvent[] }> => {
    const current = await snapshot(projectPath);
    const task = current.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`업무를 찾을 수 없습니다: ${taskId}`);
    return { project: current.project, task, events: current.events };
  };

  const withConversationContext = async (projectPath: string, project: Project, input: TaskInput): Promise<TaskInput> => {
    const ids = [...new Set(input.sourceConversationIds ?? [])];
    if (ids.length > 3) throw new Error('업무에 연결할 대화는 최대 3개입니다.');
    const sources = ids.map((id) => project.importedConversations?.find((conversation) => conversation.id === id));
    if (sources.some((source) => !source)) throw new Error('프로젝트에 저장된 대화만 업무에 연결할 수 있습니다.');
    const contexts = await Promise.all(sources.map(async (source) =>
      conversationContext(source!, await readImportedTurns(projectPath, source!.id))));
    return { ...input, sourceConversationIds: ids, sourceContext: contexts.join('\n\n---\n\n').slice(0, 42_000) };
  };

  const attachConversation = async (projectPath: string, provider: Provider, filePath: string): Promise<ProjectSnapshot> => {
    const current = await readProject(projectPath);
    const imported = await importConversationFile(projectPath, provider, filePath);
    if (current.importedConversations?.some((item) => item.id === imported.id)) {
      throw new Error('이미 가져온 대화입니다.');
    }
    await replaceProject(projectPath, (project) => ({ ...project,
      importedConversations: [...project.importedConversations ?? [], imported], updatedAt: now(),
    }));
    await event(projectPath, current.id, 'system', 'user',
      `${provider === 'codex' ? 'Codex' : 'Claude'} 대화를 가져왔습니다: ${imported.title} (${imported.turnCount}개 발화)`,
      undefined, undefined, { source: 'imported', conversationId: imported.id });
    return snapshot(projectPath);
  };

  const begin = (projectPath: string, taskId: string): AbortController => {
    const runKey = key(projectPath, taskId);
    if (active.has(runKey)) throw new Error('이 업무는 이미 실행 중입니다.');
    const controller = new AbortController();
    active.set(runKey, controller);
    return controller;
  };
  const finish = (projectPath: string, taskId: string): void => { active.delete(key(projectPath, taskId)); };

  const trackedModel = async (
    request: CliRequest,
    purpose: ExternalSession['purpose'],
    taskId?: string,
  ): Promise<CliResult> => withLock(`model-session:${request.projectPath}:${purpose}:${taskId ?? 'project'}:${request.choice.provider}`, async () => {
    const current = await snapshot(request.projectPath);
    const hostId = current.localHostId;
    const sessions = taskId
      ? current.tasks.find((task) => task.id === taskId)?.sessions ?? []
      : current.project.sessions ?? [];
    const previous = sessions.filter((session) =>
      session.hostId === hostId && session.provider === request.choice.provider && session.purpose === purpose,
    ).at(-1);
    const configuredPath = await cliPathFor(request.choice.provider);
    let restarted = false;
    const result = await runModel({ ...request, sessionId: previous?.sessionId, configuredPath })
      .catch(async (error: unknown) => {
        if (request.choice.provider !== 'codex' || !previous?.sessionId
          || !/thread-store conflict|already has an active writer/iu.test(errorText(error))) throw error;
        restarted = true;
        const importedContext = (await Promise.all((current.project.importedConversations ?? []).slice(0, 3)
          .map(async (conversation) => conversationContext(conversation, await readImportedTurns(request.projectPath, conversation.id)))))
          .join('\n\n---\n\n').slice(0, 42_000);
        return runModel({ ...request, sessionId: undefined, configuredPath,
          prompt: [request.prompt, '기존 Codex 채팅이 다른 앱에서 사용 중이므로 새 채팅에서 이어갑니다.',
            importedContext && `가져온 기존 대화의 맥락:\n${importedContext}`].filter(Boolean).join('\n\n') });
      });
    if (result.sessionId) {
      const timestamp = now();
      const session: ExternalSession = {
        hostId,
        provider: request.choice.provider,
        sessionId: result.sessionId,
        purpose,
        cwd: request.cwd,
        createdAt: sessions.find((item) => item.hostId === hostId && item.sessionId === result.sessionId)?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      const update = (items: ExternalSession[] = []): ExternalSession[] =>
        items.some((item) => item.hostId === hostId && item.sessionId === session.sessionId)
          ? items.map((item) => item.hostId === hostId && item.sessionId === session.sessionId ? session : item)
          : [...items, session];
      if (taskId) await replaceTask(request.projectPath, taskId, (task) => ({ ...task, sessions: update(task.sessions) }));
      else await replaceProject(request.projectPath, (project) => ({ ...project, sessions: update(project.sessions), updatedAt: timestamp }));
    }
    if (restarted) await event(request.projectPath, current.project.id, 'system', 'system',
      'Codex 원래 채팅이 다른 앱에서 사용 중이어서 새 CLI 채팅으로 이어갔습니다.', taskId, undefined,
      { previousSessionId: previous?.sessionId ?? null, sessionId: result.sessionId ?? null });
    return result;
  });

  const startProjectSessions = (projectPath: string): Promise<void> =>
    withLock(`project-sessions:${projectPath}`, async () => {
      const latest = await readProject(projectPath);
      const importedContext = (await Promise.all((latest.importedConversations ?? []).slice(0, 3)
        .map(async (conversation) => conversationContext(conversation, await readImportedTurns(projectPath, conversation.id)))))
        .join('\n\n---\n\n').slice(0, 42_000);
      const hostId = await hostIdPromise;
      const missing = providers.filter((provider) => !latest.sessions?.some((session) =>
        session.hostId === hostId && session.provider === provider && session.purpose === 'project',
      ));
      await Promise.all(missing.map(async (provider) => {
        try {
          const result = await trackedModel({
            projectPath, cwd: projectPath, choice: { provider, model: 'default' },
            prompt: [
              `프로젝트 ${latest.name}의 협업 대화를 시작합니다.`,
              `목표: ${latest.goal}`,
              `현재 기준: ${latest.charter || '추가 제약 없음'}`,
              importedContext && `기존에 한 모델과 진행한 대화의 맥락:\n${importedContext}`,
              '이 프로젝트의 후속 요청에서는 매번 전달되는 업무 카드와 완료 기준을 우선해 주세요. 지금은 폴더를 수정하지 말고 목표와 협업 방식의 이해를 짧게 확인하세요.',
            ].filter(Boolean).join('\n\n'),
            phase: 'project-kickoff', readOnly: true, signal: new AbortController().signal,
          }, 'project');
          await event(projectPath, latest.id, 'system', provider, result.text, undefined, undefined, {
            transcript: result.transcript, sessionId: result.sessionId ?? null,
          });
        } catch (error) {
          await event(projectPath, latest.id, 'error', 'system', `${provider} 대화 생성 실패: ${errorText(error)}`);
        }
      }));
    });

  const debateTurn = async (
    projectPath: string,
    taskId: string,
    provider: Provider,
    stage: 'proposal' | 'critique' | 'response' | 'evaluation' | 'followUp',
    signal: AbortSignal,
    round?: number,
    question?: string,
  ): Promise<CollaborationEvent> => {
    const { project, task, events } = await taskById(projectPath, taskId);
    const result = await trackedModel({
      projectPath, cwd: projectPath, choice: modelFor(task, provider),
      prompt: debatePrompt(project, task, events, provider, stage, round, question),
      phase: `debate-${stage}${round ? `-${round}` : ''}`, readOnly: true, signal,
    }, 'debate', taskId);
    const type: EventType = stage === 'followUp' ? 'response' : stage;
    return event(projectPath, project.id, type, provider, result.text, taskId, round, { transcript: result.transcript, sessionId: result.sessionId ?? null });
  };

  const debateRounds = async (projectPath: string, taskId: string, signal: AbortSignal, start: number, count: number): Promise<void> => {
    await Array.from({ length: count }, (_, index) => start + index).reduce<Promise<void>>(
      (previous, round) => previous.then(async () => {
        await Promise.all(providers.map((provider) => debateTurn(projectPath, taskId, provider, round === 1 ? 'critique' : 'response', signal, round)));
      }),
      Promise.resolve(),
    );
  };

  const concludeDebate = async (projectPath: string, taskId: string, signal: AbortSignal): Promise<void> => {
    const evaluations = await Promise.all(providers.map((provider) => debateTurn(projectPath, taskId, provider, 'evaluation', signal)));
    const { project, task, events } = await taskById(projectPath, taskId);
    const result = await trackedModel({
      projectPath, cwd: projectPath, choice: task.reviewer,
      prompt: [
        '두 모델의 토론과 최종 평가를 바탕으로 실행 가능한 단일 결론을 작성하세요. 작업 폴더를 수정하지 마세요.',
        '합의된 결정, 남은 이견, 이견별 판단 근거, 실제 실행 단계, 완료 기준과 검증 방법을 구분하세요.',
        '상대 의견이 해결되지 않았으면 합의로 꾸미지 말고 미해결이라고 명시하세요.',
        `양측 평가:\n${evaluations.map((item) => `${item.actor}: ${item.message}`).join('\n\n')}`,
        taskCard(project, task, events, task.reviewer.provider),
      ].join('\n\n'),
      phase: 'debate-synthesis', readOnly: true, signal,
    }, 'debate', taskId);
    await replaceTask(projectPath, taskId, (value) => ({ ...value, debateSummary: result.text, status: 'ready' }));
    await event(projectPath, project.id, 'decision', task.reviewer.provider, result.text, taskId, undefined, { transcript: result.transcript, sessionId: result.sessionId ?? null });
  };

  const discussProjectMessage = async (projectPath: string, messageId: string, signal: AbortSignal): Promise<ProjectSnapshot> => {
    const initial = await snapshot(projectPath);
    const request = initial.events.find((item) => item.id === messageId && item.type === 'chat' && item.actor === 'user');
    if (!request || request.metadata?.target !== 'both') throw new Error('두 모델 모두에게 보낸 채팅을 선택하세요.');
    const images = (() => {
      try {
        const files = JSON.parse(String(request.metadata?.attachments ?? '[]')) as ChatAttachment[];
        return Array.isArray(files) ? files.filter((file) => isImageAttachment(file.name) && !path.isAbsolute(file.path) && !file.path.includes('..'))
          .map((file) => path.join(projectPath, file.path)) : [];
      } catch { return []; }
    })();
    const replies = () => readEvents(projectPath).then((records) => records.filter((item) =>
      item.metadata?.replyTo === messageId && item.type === 'chat' && providers.includes(item.actor as Provider)));
    const first = await replies();
    if (!providers.every((provider) => first.some((item) => item.actor === provider))) throw new Error('양쪽 모델의 첫 답변이 완료되어야 토론을 시작할 수 있습니다.');
    const rounds = roundCount(initial.project.defaultDebateRounds);
    await Array.from({ length: rounds }, (_, index) => index + 1).reduce<Promise<void>>((previous, round) => previous.then(async () => {
      const all = await replies();
      const latest = providers.map((provider) => all.filter((item) => item.actor === provider).at(-1)!);
      await Promise.all(providers.map(async (provider) => {
        const result = await trackedModel({
          projectPath, cwd: projectPath, choice: { provider, model: String(request.metadata?.[`${provider}Model`] ?? 'default') },
          imagePaths: provider === 'codex' ? images : [],
          effort: request.metadata?.[`${provider}Effort`] === 'default' ? undefined : String(request.metadata?.[`${provider}Effort`] ?? 'medium'), phase: `project-discussion-${round}`,
          readOnly: true, signal,
          prompt: [
            `프로젝트: ${initial.project.name}\n목표: ${initial.project.goal}\n기준: ${initial.project.charter || '추가 제약 없음'}`,
            `사용자 요청: ${request.message}`,
            `첨부 파일 (프로젝트 폴더 기준): ${String(request.metadata?.attachments ?? '없음')}`,
            `이전 양쪽 답변:\n${latest.map((item) => `${item.actor}: ${item.message.slice(0, 20_000)}`).join('\n\n')}`,
            round === 1 ? '상대 답변의 주장과 산출물을 구체적으로 반박·검증하세요. 동의하는 점도 근거와 함께 밝히고, 개선된 콘티나 결과 초안을 직접 제시하세요.'
              : '상대의 직전 반론을 평가하고 재반론하세요. 수용할 지적을 반영해 산출물 초안을 구체적으로 수정하고 남은 이견을 명시하세요.',
            '파일을 수정하지 마세요. 다른 모델이 확인할 수 있도록 근거와 파일 경로를 적으세요.',
          ].join('\n\n'),
        }, 'project');
        await event(projectPath, initial.project.id, 'chat', provider, result.text, undefined, round,
          { replyTo: messageId, discussionRound: round, transcript: result.transcript, sessionId: result.sessionId ?? null });
      }));
    }), Promise.resolve());
    const finalReplies = await replies();
    const debateTranscript = finalReplies.map((item) => `${item.actor}${item.metadata?.discussionRound ? ` ${item.metadata.discussionRound}회차` : ' 최초 답변'}: ${item.message.slice(0, 14_000)}`)
      .join('\n\n---\n\n').slice(-75_000);
    const conclusion = await trackedModel({
      projectPath, cwd: projectPath, choice: { provider: 'claude', model: String(request.metadata?.claudeModel ?? 'default') },
      effort: request.metadata?.claudeEffort === 'default' ? undefined : String(request.metadata?.claudeEffort ?? 'medium'), phase: 'project-discussion-conclusion', readOnly: true, signal,
      prompt: [`사용자 요청: ${request.message}`, `Codex·Claude의 전체 토론 기록:\n${debateTranscript}`,
        '두 모델이 실제로 서로의 반론에 답했는지 평가하세요. 합의점, 미해결 이견과 각자의 근거, 실행 가능한 최종 산출물 초안, 검증 기준을 구분하세요. 해결되지 않은 이견은 합의로 꾸미지 마세요. 사용자에게 다시 단순 계획만 제안하지 마세요. 파일은 수정하지 마세요.'].join('\n\n'),
    }, 'project');
    await event(projectPath, initial.project.id, 'decision', 'claude', conclusion.text, undefined, undefined,
      { replyTo: messageId, discussionConclusion: true, transcript: conclusion.transcript, sessionId: conclusion.sessionId ?? null });
    return snapshot(projectPath);
  };

  const service: Service = {
    listProjects: async (): Promise<Project[]> => (await Promise.allSettled((await readRegisteredPaths())
      .map(async (projectPath) => ({ ...await readProject(projectPath), path: path.resolve(projectPath) }))))
      .filter((result): result is PromiseFulfilledResult<Project> => result.status === 'fulfilled')
      .map((result) => result.value),
    listLocalConversations,
    refreshModelCatalogs: async () => Promise.all(providers.map(async (provider) =>
      discoverModelCatalog(provider, await cliPathFor(provider)))),
    sendProjectMessage: async (projectPath: string, message: string, target: Provider | 'both', models: Partial<Record<Provider, ChatModelSettings>> = {}, files: ChatFileInput[] = [], discussion = false): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      const text = message.trim();
      if ((!text && !files.length) || text.length > 20_000) throw new Error('메시지 또는 첨부 파일을 입력하세요. 메시지는 최대 20,000자입니다.');
      if (!Array.isArray(files) || files.length > 5 || files.some((file) => typeof file !== 'string'
        && (!file || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.data !== 'string'))) throw new Error('첨부 파일은 최대 5개입니다.');
      if (target !== 'both' && !providers.includes(target)) throw new Error('채팅 대상을 선택하세요.');
      const selectedModels = Object.fromEntries(providers.map((provider) => [provider, {
        model: (models?.[provider]?.model ?? '').trim(), effort: (models?.[provider]?.effort ?? '').trim(),
      }])) as Record<Provider, ChatModelSettings>;
      if (Object.values(selectedModels).some(({ model, effort }) => model.length > 100 || /[\r\n]/u.test(model)
        || (effort && !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)))) {
        throw new Error('모델 이름 또는 추론 수준이 올바르지 않습니다.');
      }
      const controller = begin(resolved, 'project-chat');
      try {
        const project = await readProject(resolved);
        const sources = await Promise.all(files.map(async (file) => {
          if (typeof file === 'string') {
            const source = path.resolve(file);
            const info = await lstat(source);
            if (!info.isFile() || info.isSymbolicLink() || info.size > 25 * 1024 * 1024) throw new Error('첨부 파일은 일반 파일이며 각각 25MB 이하여야 합니다.');
            return { content: source, size: info.size, name: path.basename(source).replace(/[^\p{L}\p{N}._ -]/gu, '_') };
          }
          if (file.name.length > 255 || !file.name.trim() || file.data.length > 35_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(file.data)) throw new Error('첨부 파일 형식 또는 크기가 올바르지 않습니다.');
          const content = Buffer.from(file.data, 'base64');
          if (content.length > 25 * 1024 * 1024) throw new Error('첨부 파일은 각각 25MB 이하여야 합니다.');
          return { content, size: content.length, name: path.basename(file.name).replace(/[^\p{L}\p{N}._ -]/gu, '_') };
        }));
        if (sources.reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) throw new Error('첨부 파일 전체 크기는 50MB 이하여야 합니다.');
        const attachments: ChatAttachment[] = await Promise.all(sources.map(async ({ content, size, name }) => {
          const relative = path.join('.llm-collaboration', 'attachments', randomUUID(), name);
          const destination = path.join(resolved, relative);
          await mkdir(path.dirname(destination), { recursive: true });
          if (typeof content === 'string') await copyFile(content, destination);
          else await writeFile(destination, content);
          return { name, path: relative, size };
        }));
        const attachmentLines = attachments.map((file) => `${file.name}: ${path.join(resolved, file.path)}`).join('\n');
        const userMessage = await event(resolved, project.id, 'chat', 'user', text || '첨부 파일을 확인해 주세요.', undefined, undefined,
          { target, codexModel: selectedModels.codex.model || 'default', claudeModel: selectedModels.claude.model || 'default',
            codexEffort: selectedModels.codex.effort || 'default', claudeEffort: selectedModels.claude.effort || 'default',
            attachments: JSON.stringify(attachments), discussion: target === 'both' && (discussion || /토론|논쟁|반론|debate/iu.test(text)) });
        const targets = target === 'both' ? providers : [target];
        await Promise.all(targets.map(async (provider) => {
          try {
            const current = await snapshot(resolved);
            const visibleUserMessages = new Set(current.events.filter((item) => item.type === 'chat' && item.actor === 'user'
              && (item.metadata?.target === 'both' || item.metadata?.target === provider)).map((item) => item.id));
            const recent = current.events.filter((item) => item.type === 'chat' && item.id !== userMessage.id
              && (item.actor === 'user' ? visibleUserMessages.has(item.id)
                : item.metadata?.replyTo ? visibleUserMessages.has(String(item.metadata.replyTo)) : item.actor === provider))
              .slice(-16).map((item) => `${item.actor === 'user' ? '사용자' : item.actor}: ${item.message.slice(0, 1800)}${typeof item.metadata?.attachments === 'string' ? `\n첨부 파일: ${item.metadata.attachments}` : ''}`)
              .join('\n\n').slice(-20_000);
            const hasSession = current.project.sessions?.some((session) => session.hostId === current.localHostId
              && session.provider === provider && session.purpose === 'project');
            const taskState = current.tasks.map((task) => `${task.title} [${task.status}] · 수행 ${task.executor.provider} · 검수 ${task.reviewer.provider}\n${task.description.slice(0, 800)}\n최근 결론: ${(task.reviewSummary || task.debateSummary || '없음').slice(0, 900)}`)
              .join('\n\n').slice(-12_000);
            const taskActivity = current.events.filter((item) => item.taskId && ['decision', 'execution', 'review', 'status', 'error'].includes(item.type))
              .slice(-10).map((item) => `${item.actor}/${item.type}: ${item.message.slice(0, 1200)}`).join('\n\n').slice(-10_000);
            const sharedFiles = current.tasks.flatMap((task) => [
              ...task.artifacts.map((file) => `${task.executor.provider} 승인 산출물: ${path.join(resolved, file)}`),
              ...(task.branch && task.status !== 'approved' ? [`${task.executor.provider} 진행 중 작업 폴더 (읽기만): ${taskWorktree(resolved, current.project.id, task.id)}`] : []),
            ]).slice(-30).join('\n');
            const importedContext = hasSession ? '' : (await Promise.all((current.project.importedConversations ?? []).slice(0, 3)
              .map(async (conversation) => conversationContext(conversation, await readImportedTurns(resolved, conversation.id)))))
              .join('\n\n---\n\n').slice(0, 42_000);
            const result = await trackedModel({
              projectPath: resolved, cwd: resolved, choice: { provider, model: selectedModels[provider].model || 'default' },
              effort: selectedModels[provider].effort || undefined,
              imagePaths: provider === 'codex' ? attachments.filter((file) => isImageAttachment(file.name)).map((file) => path.join(resolved, file.path)) : [],
              prompt: [
                `프로젝트: ${current.project.name}`,
                `목표: ${current.project.goal}`,
                `항상 유지할 기준: ${current.project.charter || '추가 제약 없음'}`,
                taskState && `현재 업무 현황:\n${taskState}`,
                taskActivity && `최근 업무 진행 기록:\n${taskActivity}`,
                sharedFiles && `두 모델이 공유할 작업 파일:\n${sharedFiles}`,
                importedContext && `가져온 대화의 맥락:\n${importedContext}`,
                recent && `공유 채팅의 최근 대화:\n${recent}`,
                attachmentLines && `이번 요청의 첨부 파일 (프로젝트 Git에 저장됨; 필요한 경우 경로에서 열어 확인):\n${attachmentLines}`,
                `현재 사용자 메시지 (${target === 'both' ? '두 모델 모두' : provider}에게 전달):\n${text}`,
                '현재 메시지에 직접 답하고 요청한 산출물의 초안을 본문에 작성하세요. 실제 파일 변경이 필요하면 별도 업무 실행 단계를 제안하세요.',
              ].filter(Boolean).join('\n\n'),
              phase: 'project-chat', readOnly: true, signal: controller.signal,
            }, 'project');
            await event(resolved, project.id, 'chat', provider, result.text, undefined, undefined,
              { replyTo: userMessage.id, transcript: result.transcript, sessionId: result.sessionId ?? null,
                model: selectedModels[provider].model || 'default', effort: selectedModels[provider].effort || 'default' });
          } catch (error) {
            await event(resolved, project.id, 'error', 'system',
              `${provider === 'codex' ? 'Codex' : 'Claude'} 응답 ${controller.signal.aborted ? '취소됨' : `실패: ${errorText(error)}`}`,
              undefined, undefined, { replyTo: userMessage.id, provider });
          }
        }));
        const finishedReplies = await readEvents(resolved);
        if (userMessage.metadata?.discussion && providers.every((provider) =>
          finishedReplies.some((item) => item.metadata?.replyTo === userMessage.id && item.actor === provider && item.type === 'chat'))) {
          return discussProjectMessage(resolved, userMessage.id, controller.signal);
        }
        return snapshot(resolved);
      } finally { finish(resolved, 'project-chat'); }
    },
    cancelProjectMessage: async (projectPath: string): Promise<void> => {
      active.get(key(projectPath, 'project-chat'))?.abort();
    },
    continueProjectDiscussion: async (projectPath: string, messageId: string): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      const controller = begin(resolved, 'project-chat');
      try { return await discussProjectMessage(resolved, messageId, controller.signal); }
      finally { finish(resolved, 'project-chat'); }
    },
    bootstrap: async (): Promise<Bootstrap> => {
      const projectPaths = await readRegisteredPaths();
      const [projectResults, cliResults] = await Promise.all([
        Promise.allSettled(projectPaths.map(async (projectPath) => ({ ...await readProject(projectPath), path: path.resolve(projectPath) }))),
        cliStatuses(),
      ]);
      const projects = projectResults
        .filter((result): result is PromiseFulfilledResult<Project> => result.status === 'fulfilled')
        .map((result) => result.value);
      const missing = await Promise.all(projectResults.map(async (result, index) =>
        result.status === 'rejected' && await projectRecordMissing(projectPaths[index]) ? projectPaths[index] : null));
      return { projects, missingProjectPaths: missing.filter((item): item is string => item !== null), cli: cliResults as CliStatus[] };
    },

    refreshCliStatus: cliStatuses,

    setCliExecutable: async (provider: Provider, filePath: string | null): Promise<CliStatus[]> => {
      if (!providers.includes(provider)) throw new Error('지원하지 않는 CLI입니다.');
      const selected = filePath?.trim() ? path.resolve(filePath) : undefined;
      if (selected) {
        const status = await cliStatus(provider, process.cwd(), selected);
        const expected = provider === 'codex' ? /codex/iu : /Claude Code/iu;
        if (!status.version || !expected.test(status.version)) {
          throw new Error(`${provider} CLI 실행 파일을 확인할 수 없습니다. 올바른 실행 파일을 선택하세요.`);
        }
      }
      await withLock('cli-settings', async () => {
        const settings = await readCliSettings();
        await writeJson(cliSettingsPath, selected
          ? { ...settings, [provider]: selected }
          : Object.fromEntries(Object.entries(settings).filter(([key]) => key !== provider)));
      });
      return cliStatuses();
    },

    createProject: async (input: ProjectInput): Promise<ProjectSnapshot> => {
      if (!input.name?.trim() || !input.goal?.trim() || !input.path?.trim()) throw new Error('프로젝트 이름, 목표, 폴더를 입력하세요.');
      const projectPath = path.resolve(input.path);
      await gitLock(projectPath, () => ensureProjectRepository(projectPath));
      const files = projectFiles(projectPath);
      const existing = await readProject(projectPath).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      });
      if (existing) {
        await registerProject(projectPath);
        if (input.initialConversation) await attachConversation(projectPath,
          input.initialConversation.provider, input.initialConversation.filePath);
        if (autoStartSessions) await startProjectSessions(projectPath);
        return snapshot(projectPath);
      }
      const timestamp = now();
      const imported = input.initialConversation
        ? await importConversationFile(projectPath, input.initialConversation.provider, input.initialConversation.filePath)
        : undefined;
      const project: Project = {
        id: randomUUID(), name: input.name.trim(), path: projectPath, goal: input.goal.trim(), charter: '',
        defaultDebateRounds: roundCount(input.defaultDebateRounds), createdAt: timestamp, updatedAt: timestamp,
        ...(imported ? { importedConversations: [imported] } : {}),
      };
      await stateLock(projectPath, async () => {
        await writeJson(files.project, project);
        await writeJson(files.tasks, []);
        await writeFile(files.events, '', { encoding: 'utf8', flag: 'a' });
      });
      await checkpoint(projectPath, `Create project ${project.name}`);
      await registerProject(projectPath);
      await event(projectPath, project.id, 'system', 'system', `프로젝트를 생성했습니다. 목표: ${project.goal}`);
      if (imported) await event(projectPath, project.id, 'system', 'user',
        `기존 ${imported.provider === 'codex' ? 'Codex' : 'Claude'} 대화를 프로젝트 시작 맥락으로 가져왔습니다: ${imported.title}`,
        undefined, undefined, { source: 'imported', conversationId: imported.id });
      if (autoStartSessions) await startProjectSessions(projectPath);
      return snapshot(projectPath);
    },

    importConversation: async (projectPath: string, provider: Provider, filePath: string): Promise<ProjectSnapshot> => {
      return attachConversation(path.resolve(projectPath), provider, filePath);
    },

    readImportedConversation: async (projectPath: string, conversationId: string) => {
      const resolved = path.resolve(projectPath);
      const project = await readProject(resolved);
      if (!project.importedConversations?.some((item) => item.id === conversationId)) {
        throw new Error('프로젝트에 저장된 대화가 아닙니다.');
      }
      return readImportedTurns(resolved, conversationId);
    },

    readImportedConversationRaw: async (projectPath: string, conversationId: string) => {
      const resolved = path.resolve(projectPath);
      const project = await readProject(resolved);
      if (!project.importedConversations?.some((item) => item.id === conversationId)) {
        throw new Error('프로젝트에 저장된 대화가 아닙니다.');
      }
      return readImportedRaw(resolved, conversationId);
    },

    deleteProject: async (projectPath: string, projectId: string, confirmation: string): Promise<'trashed' | 'unregistered'> => {
      const resolved = path.resolve(projectPath);
      return withLock(`delete:${resolved}`, async () => {
        const registered = await readRegisteredPaths();
        if (!registered.some((candidate) => samePath(candidate, resolved))) throw new Error('등록된 프로젝트가 아닙니다.');
        if (registered.some((candidate) => !samePath(candidate, resolved) && containsPath(resolved, candidate))) {
          throw new Error('이 폴더 안에 등록된 다른 프로젝트가 있습니다. 내부 프로젝트부터 삭제하세요.');
        }
        if (Array.from(active.keys()).some((runKey) => runKey.startsWith(`${resolved}::`))) {
          throw new Error('진행 중인 업무가 있습니다. 업무가 끝난 뒤 프로젝트를 삭제하세요.');
        }
        if (!projectId.trim() || !confirmation.trim()) throw new Error('프로젝트 삭제 확인 정보가 없습니다.');
        if (await projectRecordMissing(resolved)) { await unregisterProject(resolved); return 'unregistered' as const; }
        const trashExisting = async (target: string): Promise<void> => {
          if (await directoryMissing(target)) return;
          try { await trashItem(target); }
          catch (error) {
            if (!await directoryMissing(target)) {
              throw new Error(`휴지통 이동에 실패했습니다: ${target}. ${errorText(error)}. 폴더를 보존하려면 '앱 목록에서만 제거'를 선택하세요.`);
            }
          }
        };
        try {
          const project = await readProject(resolved);
          if (project.id !== projectId || !samePath(project.path, resolved) || confirmation !== project.name) {
            throw new Error('프로젝트 이름 또는 식별자가 일치하지 않습니다.');
          }
          await assertSafeProjectDirectory(resolved, registryPath);
          if (!samePath(await git(resolved, ['rev-parse', '--show-toplevel']), resolved)) {
            throw new Error('프로젝트 폴더가 Git 저장소 루트가 아닙니다.');
          }
          const worktreeRoot = projectWorktreeDirectory(resolved, project.id);
          const worktreeParent = path.dirname(worktreeRoot);
          const worktreeExists = !await directoryMissing(worktreeRoot);
          if (worktreeExists) {
            await assertRealDirectory(worktreeParent);
            await assertRealDirectory(worktreeRoot);
          }
          const worktrees = (await git(resolved, ['worktree', 'list', '--porcelain']))
            .split(/\r?\n/u).filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
          const external = worktrees.filter((directory) => !samePath(directory, resolved) && !containsPath(worktreeRoot, directory));
          if (external.length) throw new Error(`앱 관리 범위 밖의 Git worktree가 있습니다: ${external.join(', ')}`);
          if (worktreeExists) {
            await trashExisting(worktreeRoot);
            if (!await directoryMissing(worktreeParent) && (await readdir(worktreeParent)).length === 0) await trashExisting(worktreeParent);
          }
          await trashExisting(resolved);
          await unregisterProject(resolved);
          return 'trashed' as const;
        } catch (error) {
          if (!await projectRecordMissing(resolved)) throw error;
          await unregisterProject(resolved);
          return 'unregistered' as const;
        }
      });
    },

    unregisterProjectOnly: async (projectPath: string, projectId: string, confirmation: string): Promise<void> => {
      const resolved = path.resolve(projectPath);
      await withLock(`delete:${resolved}`, async () => {
        if (!(await readRegisteredPaths()).some((candidate) => samePath(candidate, resolved))) {
          throw new Error('등록된 프로젝트가 아닙니다.');
        }
        if (Array.from(active.keys()).some((runKey) => runKey.startsWith(`${resolved}::`))) {
          throw new Error('진행 중인 업무가 있습니다. 업무가 끝난 뒤 프로젝트를 정리하세요.');
        }
        if (!projectId.trim() || !confirmation.trim()) throw new Error('프로젝트 삭제 확인 정보가 없습니다.');
        if (!await projectRecordMissing(resolved)) {
          const project = await readProject(resolved);
          if (project.id !== projectId || !samePath(project.path, resolved) || confirmation !== project.name) {
            throw new Error('프로젝트 이름 또는 식별자가 일치하지 않습니다.');
          }
        }
        await unregisterProject(resolved);
      });
    },

    forgetMissingProject: async (projectPath: string): Promise<void> => {
      const resolved = path.resolve(projectPath);
      if (!(await readRegisteredPaths()).some((candidate) => samePath(candidate, resolved))) {
        throw new Error('등록된 프로젝트가 아닙니다.');
      }
      if (!await projectRecordMissing(resolved)) throw new Error('프로젝트 기록이 아직 있습니다. 프로젝트 삭제를 사용하세요.');
      await unregisterProject(resolved);
    },

    openProject: async (projectPath: string): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      await registerProject(resolved);
      if (autoStartSessions) await startProjectSessions(resolved);
      return snapshot(resolved);
    },

    updateCharter: async (projectPath: string, charter: string): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      const result = await replaceProject(resolved, (project) => ({ ...project, charter: charter.trim(), updatedAt: now() }));
      await event(resolved, result.project.id, 'system', 'user', `프로젝트 헌장을 수정했습니다.\n${charter.trim()}`);
      return snapshot(resolved);
    },

    updateProjectRounds: async (projectPath: string, rounds: number): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      const count = roundCount(rounds);
      const result = await replaceProject(resolved, (project) => ({ ...project, defaultDebateRounds: count, updatedAt: now() }));
      await event(resolved, result.project.id, 'system', 'user', `프로젝트 기본 토론 왕복 횟수를 ${count}회로 설정했습니다.`);
      return snapshot(resolved);
    },

    createTask: async (projectPath: string, input: TaskInput): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      const current = await snapshot(resolved);
      const validated = await withConversationContext(resolved, current.project,
        validateTaskInput(input, current.project, current.tasks));
      const choices = validated.mode === 'automatic' ? autoChoices(validated, current.tasks) : { executor: validated.executor, reviewer: validated.reviewer };
      const timestamp = now();
      const task: Task = { ...validated, ...choices, id: randomUUID(), status: 'draft', createdAt: timestamp, updatedAt: timestamp, artifacts: [] };
      await stateLock(resolved, async () => writeJson(projectFiles(resolved).tasks, [...await readTasks(resolved), task]));
      await checkpoint(resolved, `Create task ${task.id}`);
      await event(resolved, current.project.id, 'status', 'user', `업무를 생성했습니다: ${task.title}. 수행 ${task.executor.provider}, 검수 ${task.reviewer.provider}.`, task.id);
      return snapshot(resolved);
    },

    updateTask: async (projectPath: string, candidate: Task): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      if (active.has(key(resolved, candidate.id))) throw new Error('실행 중인 업무는 수정할 수 없습니다.');
      const current = await snapshot(resolved);
      const previous = current.tasks.find((task) => task.id === candidate.id);
      if (!previous) throw new Error(`업무를 찾을 수 없습니다: ${candidate.id}`);
      const validated = await withConversationContext(resolved, current.project,
        validateTaskInput(candidate, current.project, current.tasks.filter((task) => task.id !== candidate.id)));
      if (validated.dependsOn.includes(candidate.id)) throw new Error('업무가 자기 자신을 선행 업무로 지정할 수 없습니다.');
      const choices = validated.mode === 'automatic' ? autoChoices(validated, current.tasks.filter((task) => task.id !== candidate.id)) : { executor: validated.executor, reviewer: validated.reviewer };
      if (hasDependencyCycle(current.tasks.map((task) => task.id === candidate.id ? { id: task.id, dependsOn: validated.dependsOn } : task))) {
        throw new Error('업무 간 선행 관계에 순환이 있습니다.');
      }
      await replaceTask(resolved, candidate.id, (task) => ({ ...task, ...validated, ...choices, status: 'draft', debateSummary: undefined, reviewSummary: undefined, branch: undefined, artifacts: [] }));
      await event(resolved, current.project.id, 'status', 'user', `업무 정의를 수정했습니다: ${validated.title}.`, candidate.id);
      return snapshot(resolved);
    },

    autoAssign: async (projectPath: string, taskId: string): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      const current = await snapshot(resolved);
      const task = current.tasks.find((item) => item.id === taskId);
      if (!task) throw new Error(`업무를 찾을 수 없습니다: ${taskId}`);
      if (active.has(key(resolved, taskId))) throw new Error('실행 중인 업무는 재배정할 수 없습니다.');
      const choices = autoChoices(task, current.tasks.filter((item) => item.id !== taskId));
      await replaceTask(resolved, taskId, (item) => ({ ...item, ...choices, mode: 'automatic' }));
      await event(resolved, current.project.id, 'decision', 'system', `자동 배정: ${choices.executor.provider} 수행, ${choices.reviewer.provider} 교차 검수. 업무 성격과 현재 배정 수를 기준으로 결정했습니다.`, taskId);
      return snapshot(resolved);
    },

    planTasks: async (projectPath: string, request: string): Promise<ProjectSnapshot> => {
      const resolved = path.resolve(projectPath);
      if (!request.trim()) throw new Error('분장할 요청을 입력하세요.');
      const current = await snapshot(resolved);
      await event(resolved, current.project.id, 'system', 'user', `자동 업무 분장 요청:\n${request.trim()}`);
      const planner = runModel !== runCli
        ? 'codex' as Provider
        : await assertSubscription('codex', resolved, await cliPathFor('codex')).then(() => 'codex' as Provider).catch(async () => {
          await assertSubscription('claude', resolved, await cliPathFor('claude'));
          return 'claude' as Provider;
        });
      const result = await trackedModel({
        projectPath: resolved, cwd: resolved, choice: { provider: planner, model: 'default' },
        prompt: [
          '다음 요청을 서로 독립적으로 실행 가능한 업무들로 분해하세요. 작업 폴더를 수정하지 마세요.',
          '응답은 JSON 배열만 반환하세요. 각 원소는 title, description, acceptanceCriteria(문자열 배열), dependsOnIndexes(앞선 업무의 0부터 시작하는 인덱스 배열) 필드를 가져야 합니다.',
          '최대 12개 업무로 나누고, 각 완료 기준은 구체적으로 검증 가능해야 합니다. 겹치는 업무를 만들지 마세요.',
          `프로젝트 목표: ${current.project.goal}`,
          `프로젝트 헌장: ${current.project.charter || '없음'}`,
          `팀장의 최근 채팅 지시:\n${projectChatGuidance(current.events, planner)}`,
          `사용자 요청: ${request.trim()}`,
          `기존 업무: ${current.tasks.map((task) => `${task.title} (${task.status})`).join('; ') || '없음'}`,
        ].join('\n\n'),
        phase: 'task-planning', readOnly: true, signal: new AbortController().signal,
      }, 'project');
      const json = result.text.slice(result.text.indexOf('['), result.text.lastIndexOf(']') + 1);
      const plan = JSON.parse(json) as unknown;
      if (!Array.isArray(plan) || plan.length < 1 || plan.length > 12) throw new Error('자동 분장 결과가 올바른 업무 배열이 아닙니다.');
      const ids = plan.map(() => randomUUID());
      const parsed = plan.map((item, index) => {
        if (!item || typeof item !== 'object') throw new Error('자동 분장 결과에 잘못된 항목이 있습니다.');
        const value = item as Record<string, unknown>;
        const dependencies = Array.isArray(value.dependsOnIndexes) ? value.dependsOnIndexes : [];
        if (dependencies.some((dependency) => !Number.isInteger(dependency) || (dependency as number) < 0 || (dependency as number) >= index)) {
          throw new Error('자동 분장의 선행 업무 순서가 올바르지 않습니다.');
        }
        const input: TaskInput = {
          title: String(value.title ?? ''), description: String(value.description ?? ''),
          acceptanceCriteria: Array.isArray(value.acceptanceCriteria) ? value.acceptanceCriteria.map(String) : [],
          dependsOn: dependencies.map((dependency) => ids[dependency as number]),
          mode: 'automatic', executor: { provider: 'codex', model: 'default' }, reviewer: { provider: 'claude', model: 'default' },
          debateRounds: current.project.defaultDebateRounds,
        };
        const validated = validateTaskInput(input, current.project, [...current.tasks, ...ids.slice(0, index).map((id) => ({ id } as Task))]);
        const choices = autoChoices(validated, [...current.tasks, ...ids.slice(0, index).map((id) => ({ id, executor: { provider: 'codex' }, status: 'draft' } as Task))]);
        const timestamp = now();
        return { ...validated, ...choices, id: ids[index], status: 'draft' as const, artifacts: [], createdAt: timestamp, updatedAt: timestamp };
      });
      await stateLock(resolved, async () => writeJson(projectFiles(resolved).tasks, [...await readTasks(resolved), ...parsed]));
      await checkpoint(resolved, 'Save automatic task plan');
      await event(resolved, current.project.id, 'decision', planner, `자동 업무 분장으로 ${parsed.length}개 업무를 만들었습니다.\n${parsed.map((task, index) => `${index + 1}. ${task.title}: ${task.executor.provider} 수행, ${task.reviewer.provider} 검수`).join('\n')}`, undefined, undefined, { transcript: result.transcript, sessionId: result.sessionId ?? null });
      return snapshot(resolved);
    },

    runDebate: async (projectPath: string, taskId: string): Promise<void> => {
      const resolved = path.resolve(projectPath);
      const controller = begin(resolved, taskId);
      try {
        const { project, task } = await taskById(resolved, taskId);
        await status(resolved, project.id, taskId, 'debating', `토론을 시작했습니다. ${task.debateRounds}회 왕복 후 양측이 서로의 답변을 평가합니다.`);
        await Promise.all(providers.map((provider) => debateTurn(resolved, taskId, provider, 'proposal', controller.signal)));
        await debateRounds(resolved, taskId, controller.signal, 1, task.debateRounds);
        await concludeDebate(resolved, taskId, controller.signal);
      } catch (error) {
        const { project } = await taskById(resolved, taskId);
        await status(resolved, project.id, taskId, 'ready', isAbort(error) ? '토론이 취소되었습니다.' : '토론 중 오류가 발생했습니다.');
        await event(resolved, project.id, 'error', 'system', errorText(error), taskId);
        if (!isAbort(error)) throw error;
      } finally { finish(resolved, taskId); }
    },

    continueDebate: async (projectPath: string, taskId: string, followUp: DebateFollowUp): Promise<void> => {
      const resolved = path.resolve(projectPath);
      if (!followUp.message.trim()) throw new Error('추가 질문을 입력하세요.');
      const rounds = roundCount(followUp.additionalRounds, 0, true);
      if (followUp.target !== 'both' && !providers.includes(followUp.target)) throw new Error('질문 대상을 선택하세요.');
      const controller = begin(resolved, taskId);
      try {
        const { project } = await taskById(resolved, taskId);
        await event(resolved, project.id, 'response', 'user', followUp.message.trim(), taskId, undefined, { target: followUp.target, additionalRounds: rounds });
        await status(resolved, project.id, taskId, 'debating', '사용자 질문으로 토론을 이어갑니다.');
        const targets = followUp.target === 'both' ? providers : [followUp.target];
        const responses = await Promise.all(targets.map((provider) => debateTurn(resolved, taskId, provider, 'followUp', controller.signal, undefined, followUp.message.trim())));
        if (rounds > 0) {
          const nextRound = (await readEvents(resolved))
            .filter((record) => record.taskId === taskId)
            .reduce((maximum, record) => Math.max(maximum, record.round ?? 0), 0) + 1;
          await debateRounds(resolved, taskId, controller.signal, nextRound, rounds);
          await concludeDebate(resolved, taskId, controller.signal);
        } else {
          const addition = responses.map((response) => `${response.actor}: ${response.message}`).join('\n\n');
          await replaceTask(resolved, taskId, (task) => ({ ...task, debateSummary: `${task.debateSummary || ''}\n\n추가 질문: ${followUp.message.trim()}\n${addition}`.trim(), status: 'ready' }));
        }
      } catch (error) {
        const { project } = await taskById(resolved, taskId);
        await status(resolved, project.id, taskId, 'ready', isAbort(error) ? '추가 토론이 취소되었습니다.' : '추가 토론 중 오류가 발생했습니다.');
        await event(resolved, project.id, 'error', 'system', errorText(error), taskId);
        if (!isAbort(error)) throw error;
      } finally { finish(resolved, taskId); }
    },

    executeTask: async (projectPath: string, taskId: string): Promise<void> => {
      const resolved = path.resolve(projectPath);
      const controller = begin(resolved, taskId);
      try {
        const initial = await taskById(resolved, taskId);
        const dependencies = (await readTasks(resolved)).filter((task) => initial.task.dependsOn.includes(task.id));
        if (dependencies.some((task) => task.status !== 'approved')) throw new Error('선행 업무의 검수가 완료되어야 실행할 수 있습니다.');
        if (!initial.task.debateSummary) throw new Error('실행 전에 토론을 완료하세요.');
        if (initial.task.executor.provider === initial.task.reviewer.provider) throw new Error('실행 담당자와 검수자는 다른 모델이어야 합니다.');
        await status(resolved, initial.project.id, taskId, 'running', `${initial.task.executor.provider}가 분리된 작업 공간에서 업무를 실행합니다.`);
        const worktree = await gitLock(resolved, () => ensureTaskWorktree(resolved, initial.project.id, taskId));
        await replaceTask(resolved, taskId, (task) => ({ ...task, branch: worktree.branch }));
        const perform = async (prompt: string, phase: string): Promise<string> => {
          const { project, task } = await taskById(resolved, taskId);
          const result = await trackedModel({ projectPath: resolved, cwd: worktree.directory, choice: task.executor, prompt, phase, readOnly: false, signal: controller.signal }, 'execution', taskId);
          await event(resolved, project.id, 'execution', task.executor.provider, result.text, taskId, undefined, { transcript: result.transcript, branch: worktree.branch, sessionId: result.sessionId ?? null });
          const changed = await gitLock(resolved, () => commitTaskWorktree(worktree.directory, `Implement ${task.title}`));
          if (!changed.length && phase === 'task-execution') {
            const artifact = path.join(worktree.directory, 'deliverables', `${task.id}.md`);
            await mkdir(path.dirname(artifact), { recursive: true });
            await writeFile(artifact, `# ${task.title}\n\n${result.text}\n`, 'utf8');
            await gitLock(resolved, () => commitTaskWorktree(worktree.directory, `Save deliverable for ${task.title}`));
          }
          return result.text;
        };
        const { project, task, events } = await taskById(resolved, taskId);
        const firstSummary = await perform(executionPrompt(project, task, events), 'task-execution');
        const review = async (summary: string, attempt: number): Promise<boolean> => {
          const current = await taskById(resolved, taskId);
          const files = await gitLock(resolved, () => taskChangedFiles(resolved, worktree.branch));
          await status(resolved, current.project.id, taskId, 'reviewing', `${current.task.reviewer.provider}가 실행 결과를 독립 검수합니다 (${attempt}/2).`);
          const result = await trackedModel({
            projectPath: resolved, cwd: worktree.directory, choice: current.task.reviewer,
            prompt: reviewPrompt(current.project, current.task, current.events, files, summary),
            phase: `cross-review-${attempt}`, readOnly: true, signal: controller.signal,
          }, 'review', taskId);
          await event(resolved, current.project.id, 'review', current.task.reviewer.provider, result.text, taskId, undefined, { transcript: result.transcript, sessionId: result.sessionId ?? null });
          await replaceTask(resolved, taskId, (value) => ({ ...value, reviewSummary: result.text }));
          if (/^\s*(?:\*\*)?APPROVED\b/iu.test(result.text)) return true;
          if (attempt >= 2) return false;
          await status(resolved, current.project.id, taskId, 'changes_requested', '교차 검수에서 수정을 요청했습니다. 실행 담당자가 수정합니다.');
          const latest = await taskById(resolved, taskId);
          const revised = await perform([
            '교차 검수에서 수정을 요청했습니다. 지적된 문제를 실제 파일에 고친 뒤 검증하세요.',
            `검수 의견:\n${result.text}`,
            taskCard(latest.project, latest.task, latest.events, latest.task.executor.provider),
          ].join('\n\n'), `task-revision-${attempt}`);
          return review(revised, attempt + 1);
        };
        const approved = await review(firstSummary, 1);
        if (!approved) {
          await status(resolved, initial.project.id, taskId, 'changes_requested', '두 차례 교차 검수 후에도 수정이 필요합니다. 작업 브랜치와 기록은 보존했습니다.');
          return;
        }
        const files = await gitLock(resolved, async () => {
          const changed = await taskChangedFiles(resolved, worktree.branch);
          await integrateTask(resolved, worktree.branch);
          return changed;
        });
        await replaceTask(resolved, taskId, (value) => ({ ...value, status: 'approved', artifacts: files }));
        await event(resolved, initial.project.id, 'artifact', 'system', `검수된 산출물을 프로젝트 Git 브랜치에 통합했습니다.\n${files.join('\n')}`, taskId, undefined, { branch: worktree.branch });
        await gitLock(resolved, () => removeTaskWorktree(resolved, worktree.directory, worktree.branch)).catch(async (error: unknown) => {
          await event(resolved, initial.project.id, 'error', 'system', `작업 공간 정리 실패: ${errorText(error)}`, taskId);
        });
      } catch (error) {
        const { project } = await taskById(resolved, taskId);
        await status(resolved, project.id, taskId, isAbort(error) ? 'changes_requested' : 'failed', isAbort(error) ? '실행이 취소되었습니다. 작업 브랜치는 보존했습니다.' : '실행 중 오류가 발생했습니다. 작업 브랜치와 기록을 확인하세요.');
        await event(resolved, project.id, 'error', 'system', errorText(error), taskId);
        if (!isAbort(error)) throw error;
      } finally { finish(resolved, taskId); }
    },

    cancelRun: async (projectPath: string, taskId: string): Promise<void> => {
      const resolved = path.resolve(projectPath);
      const controller = active.get(key(resolved, taskId));
      if (!controller) return;
      controller.abort();
      const { project } = await taskById(resolved, taskId);
      await event(resolved, project.id, 'status', 'user', '실행 취소를 요청했습니다.', taskId);
    },

    search: async (projectPath: string, query: string): Promise<CollaborationEvent[]> => {
      const terms = query.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
      if (!terms.length) return [];
      const resolved = path.resolve(projectPath);
      const project = await readProject(resolved);
      const events = (await readEvents(resolved)).filter((record) => {
        const searchable = `${record.message} ${record.actor} ${record.type} ${record.taskId || ''}`.toLocaleLowerCase();
        return terms.every((term) => searchable.includes(term));
      });
      const files = await readdir(projectFiles(resolved).runs)
        .then((entries) => entries.filter((entry) => entry.endsWith('.jsonl')))
        .catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
          throw error;
        });
      const raw = await files.reduce<Promise<CollaborationEvent[]>>(
        (previous, file) => previous.then(async (matches) => [...matches, ...await searchRun(resolved, project, file, terms)]),
        Promise.resolve([]),
      );
      const imported = (await Promise.all((project.importedConversations ?? []).map(async (conversation) =>
        (await readImportedTurns(resolved, conversation.id)).flatMap((turn, index): CollaborationEvent[] => {
          const searchable = `${conversation.title} ${turn.text} ${turn.role} ${conversation.provider}`.toLocaleLowerCase();
          return terms.every((term) => searchable.includes(term)) ? [{
            id: `import:${conversation.id}:${index}`, projectId: project.id, type: 'response',
            actor: turn.role === 'user' ? 'user' : conversation.provider,
            message: turn.text.slice(0, 1800), timestamp: turn.timestamp ?? conversation.updatedAt,
            metadata: { source: 'imported', conversationId: conversation.id },
          }] : [];
        })))).flat();
      return [...events, ...raw, ...imported].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    },

    readTranscript: async (projectPath: string, transcript: string): Promise<string> => {
      return readFile(await resolveRunTranscript(projectPath, transcript), 'utf8');
    },

    readSessionHistory: async (projectPath: string, sessionId: string): Promise<SessionTurn[]> => {
      const current = await snapshot(path.resolve(projectPath));
      const session = [
        ...(current.project.sessions ?? []),
        ...current.tasks.flatMap((task) => task.sessions ?? []),
      ].find((item) => item.sessionId === sessionId);
      if (!session) throw new Error('프로젝트에 기록된 대화 세션을 찾을 수 없습니다.');
      const recorded = current.events.filter((record) => record.actor === session.provider && record.metadata?.sessionId === sessionId);
      return Promise.all(recorded.map(async (record) => {
        const transcript = record.metadata?.transcript;
        const prompt = typeof transcript === 'string'
          ? await resolveRunTranscript(projectPath, transcript).then(readInvocationPrompt).catch(() => '')
          : '';
        return { event: record, prompt };
      }));
    },

    openSession: async (projectPath: string, sessionId: string): Promise<void> => {
      const resolved = path.resolve(projectPath);
      const current = await snapshot(resolved);
      const session = [
        ...(current.project.sessions ?? []),
        ...current.tasks.flatMap((task) => task.sessions ?? []),
      ].find((item) => item.sessionId === sessionId && item.hostId === current.localHostId);
      if (!session) throw new Error('이 컴퓨터에서 생성된 프로젝트 대화 세션이 아닙니다.');
      const cwd = await stat(session.cwd).then((value) => value.isDirectory() ? session.cwd : resolved).catch(() => resolved);
      await openCliSession(session.provider, session.sessionId, cwd, await cliPathFor(session.provider));
    },
  };
  return service;
};
