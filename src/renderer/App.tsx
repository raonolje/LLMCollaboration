import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  AssignmentMode,
  Bootstrap,
  CollaborationEvent,
  ExternalSession,
  EventType,
  ModelChoice,
  Project,
  ProjectInput,
  ProjectSnapshot,
  Provider,
  Task,
  TaskInput,
  TaskStatus,
} from '../shared/types';
import appIcon from '../../assets/icon.svg?url';
import './styles.css';

type Tab = 'overview' | 'tasks' | 'debate' | 'history';
type Dialog = 'project' | 'task' | 'transcript' | null;

const statusLabel: Record<TaskStatus, string> = {
  draft: '초안',
  debating: '논쟁 중',
  ready: '실행 준비',
  running: '실행 중',
  reviewing: '교차 검수 중',
  changes_requested: '수정 요청',
  approved: '승인됨',
  failed: '실패',
};

const eventLabel: Record<EventType, string> = {
  system: '시스템',
  proposal: '독립 제안',
  critique: '반론',
  response: '답변',
  evaluation: '재평가',
  decision: '결론',
  execution: '실행',
  review: '교차 검수',
  status: '상태',
  error: '오류',
  artifact: '산출물',
};

const debateTypes: EventType[] = ['proposal', 'critique', 'response', 'evaluation', 'decision'];
const providerLabel = (provider: Provider): string => provider === 'codex' ? 'Codex' : 'Claude';
const sessionPurposeLabel: Record<ExternalSession['purpose'], string> = {
  project: '프로젝트',
  debate: '토론',
  execution: '실행',
  review: '검수',
};
const actorLabel = (actor: CollaborationEvent['actor']): string =>
  actor === 'system' ? '시스템' : actor === 'user' ? '사용자' : providerLabel(actor);
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const shortTime = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const statusTone = (status: TaskStatus): string =>
  status === 'approved' ? 'success' : status === 'failed' || status === 'changes_requested'
    ? 'error' : status === 'running' || status === 'reviewing' || status === 'debating' ? 'warning' : 'neutral';
const emptyTask = (debateRounds = 2): TaskInput => ({
  title: '',
  description: '',
  acceptanceCriteria: [],
  mode: 'manual',
  executor: { provider: 'codex', model: '' },
  reviewer: { provider: 'claude', model: '' },
  dependsOn: [],
  debateRounds,
});
const defaultProject: ProjectInput = { name: '', path: '', goal: '', defaultDebateRounds: 2 };

function ModelChip({ choice }: { choice: ModelChoice }) {
  return <span className={'model-chip ' + choice.provider}>{providerLabel(choice.provider)}{choice.model ? ' · ' + choice.model : ''}</span>;
}

function Empty({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><strong>{title}</strong><span>{detail}</span></div>;
}

function SessionCard({ session, localHostId, onOpen, onOpenCodex }: { session: ExternalSession; localHostId: string; onOpen: (session: ExternalSession) => void; onOpenCodex: (session: ExternalSession) => void }) {
  const isLocal = session.hostId === localHostId;
  return <div className={'session-card ' + session.provider}>
    <div className="session-card-head"><span className={'model-chip ' + session.provider}>{providerLabel(session.provider)}</span><span className="badge neutral">{sessionPurposeLabel[session.purpose]}</span>{!isLocal && <span className="badge warning">다른 컴퓨터</span>}<span className="activity-time">{shortTime(session.updatedAt)}</span></div>
    <div className="session-id" title={session.sessionId}>{session.sessionId}</div>
    <div className="session-actions"><button className="button small" type="button" disabled={!isLocal} onClick={() => onOpen(session)}>{isLocal ? 'CLI에서 이어 열기 ↗' : '이 컴퓨터에서 열 수 없음'}</button>{session.provider === 'codex' && <button className="button small" type="button" disabled={!isLocal} onClick={() => onOpenCodex(session)}>Codex 앱에서 보기 ↗</button>}</div>
  </div>;
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectInput>(defaultProject);
  const [taskDraft, setTaskDraft] = useState<TaskInput>(emptyTask());
  const [criteriaDraft, setCriteriaDraft] = useState('');
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [charterDraft, setCharterDraft] = useState('');
  const [roundDraft, setRoundDraft] = useState(2);
  const [debateTaskId, setDebateTaskId] = useState('');
  const [followUp, setFollowUp] = useState('');
  const [followUpTarget, setFollowUpTarget] = useState<Provider | 'both'>('both');
  const [extraRounds, setExtraRounds] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CollaborationEvent[] | null>(null);
  const [transcriptView, setTranscriptView] = useState<{ path: string; content: string } | null>(null);
  const [planRequest, setPlanRequest] = useState('');
  const [runningTaskIds, setRunningTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [cancelBusy, setCancelBusy] = useState(false);

  const project = snapshot?.project ?? null;
  const tasks = snapshot?.tasks ?? [];
  const events = snapshot?.events ?? [];
  const selectedDebateTask = tasks.find((task) => task.id === debateTaskId) ?? tasks[0];
  const debateEvents = useMemo(
    () => events.filter((event) => event.taskId === selectedDebateTask?.id && debateTypes.includes(event.type)),
    [events, selectedDebateTask?.id],
  );
  const recentEvents = useMemo(() => [...events].reverse().slice(0, 5), [events]);
  const searchDisplay = useMemo(() => [...(searchResults ?? events)].reverse(), [searchResults, events]);
  const taskCounts = useMemo(() => ({
    total: tasks.length,
    active: tasks.filter((task) => ['debating', 'running', 'reviewing'].includes(task.status)).length,
    approved: tasks.filter((task) => task.status === 'approved').length,
  }), [tasks]);

  const applySnapshot = (next: ProjectSnapshot): void => {
    setSnapshot(next);
    setProjects((previous) => previous.some((item) => item.path === next.project.path)
      ? previous.map((item) => item.path === next.project.path ? next.project : item)
      : [next.project, ...previous]);
    setSearchResults(null);
  };

  const notify = (message: string, error = false): void => setToast({ message, error });

  const perform = async (label: string, action: () => Promise<void>): Promise<void> => {
    setBusy(label);
    setToast(null);
    try {
      await action();
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setBusy(null);
    }
  };

  const refresh = async (path: string): Promise<void> => {
    applySnapshot(await window.collab.openProject(path));
  };

  useEffect(() => {
    let active = true;
    window.collab.bootstrap()
      .then(async (result) => {
        if (!active) return;
        setBootstrap(result);
        setProjects(result.projects);
        if (result.projects[0]) {
          const next = await window.collab.openProject(result.projects[0].path);
          if (active) applySnapshot(next);
        }
      })
      .catch((error) => active && notify(errorText(error), true));
    return () => { active = false; };
  }, []);

  useEffect(() => window.collab.onEvent((event) => {
    setSnapshot((current) => current && current.project.id === event.projectId &&
      !current.events.some((item) => item.id === event.id)
      ? { ...current, events: [...current.events, event] } : current);
  }), []);

  useEffect(() => {
    setCharterDraft(project?.charter ?? '');
    setRoundDraft(project?.defaultDebateRounds ?? 2);
  }, [project?.path, project?.charter, project?.defaultDebateRounds]);

  const openProject = (item: Project): void => {
    void perform('프로젝트를 여는 중', async () => {
      await refresh(item.path);
      setTab('overview');
    });
  };

  const chooseDirectory = (): void => {
    void perform('폴더 선택 중', async () => {
      const path = await window.collab.chooseDirectory();
      if (path) setProjectDraft((previous) => ({ ...previous, path }));
    });
  };

  const submitProject = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!projectDraft.path.trim() || !projectDraft.name.trim()) return notify('프로젝트 이름과 폴더를 지정해 주세요.', true);
    void perform('프로젝트 생성 중', async () => {
      applySnapshot(await window.collab.createProject({
        ...projectDraft,
        name: projectDraft.name.trim(),
        path: projectDraft.path.trim(),
        goal: projectDraft.goal.trim(),
        defaultDebateRounds: Math.max(1, projectDraft.defaultDebateRounds ?? 2),
      }));
      setDialog(null);
      setTab('overview');
      setProjectDraft(defaultProject);
      notify('프로젝트를 만들었습니다. 기록과 산출물은 지정한 폴더의 Git에 저장됩니다.');
    });
  };

  const openTaskDialog = (task?: Task): void => {
    setEditingTask(task ?? null);
    setTaskDraft(task ? {
      title: task.title,
      description: task.description,
      acceptanceCriteria: task.acceptanceCriteria,
      mode: task.mode,
      executor: task.executor,
      reviewer: task.reviewer,
      dependsOn: task.dependsOn,
      debateRounds: task.debateRounds,
    } : emptyTask(project?.defaultDebateRounds ?? 2));
    setCriteriaDraft(task?.acceptanceCriteria.join('\n') ?? '');
    setDialog('task');
  };

  const submitTask = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!project) return;
    if (!taskDraft.title.trim() || !taskDraft.description.trim()) return notify('업무 제목과 내용을 입력해 주세요.', true);
    const input: TaskInput = {
      ...taskDraft,
      title: taskDraft.title.trim(),
      description: taskDraft.description.trim(),
      acceptanceCriteria: criteriaDraft.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
      debateRounds: Math.max(1, taskDraft.debateRounds),
    };
    void perform('업무 저장 중', async () => {
      const next = editingTask
        ? await window.collab.updateTask(project.path, { ...editingTask, ...input })
        : await window.collab.createTask(project.path, input);
      const created = next.tasks.find((item) => !tasks.some((previous) => previous.id === item.id));
      const assignedId = editingTask?.id ?? created?.id;
      const finalSnapshot = input.mode === 'automatic' && assignedId
        ? await window.collab.autoAssign(project.path, assignedId)
        : next;
      applySnapshot(finalSnapshot);
      setDialog(null);
      setTab('tasks');
      notify(editingTask ? '업무를 수정했습니다.' : '업무를 추가했습니다.');
    });
  };

  const saveCharter = (): void => {
    if (!project) return;
    void perform('프로젝트 헌장 저장 중', async () => {
      applySnapshot(await window.collab.updateCharter(project.path, charterDraft));
      notify('프로젝트 헌장을 저장했습니다.');
    });
  };

  const saveRounds = (): void => {
    if (!project) return;
    void perform('기본 토론 설정 저장 중', async () => {
      applySnapshot(await window.collab.updateProjectRounds(project.path, Math.max(1, roundDraft)));
      notify('기본 토론 횟수를 저장했습니다.');
    });
  };

  const assignTask = (task: Task): void => {
    if (!project) return;
    void perform('자동 배정 중', async () => {
      applySnapshot(await window.collab.autoAssign(project.path, task.id));
      notify('담당 모델과 검수 모델을 배정했습니다.');
    });
  };

  const planTasks = (): void => {
    if (!project) return;
    const request = planRequest.trim() || project.goal.trim();
    if (!request) return notify('계획을 세울 요청이나 프로젝트 목표를 입력해 주세요.', true);
    void perform('업무 계획을 만드는 중', async () => {
      applySnapshot(await window.collab.planTasks(project.path, request));
      setPlanRequest('');
      setTab('tasks');
      notify('업무 계획을 생성했습니다. 분장과 완료 기준을 검토해 주세요.');
    });
  };

  const runTaskAction = (task: Task, type: 'debate' | 'execute'): void => {
    if (!project || runningTaskIds.has(task.id)) return;
    const projectPath = project.path;
    setRunningTaskIds((previous) => new Set([...previous, task.id]));
    void (async () => {
      try {
        if (type === 'debate') {
          setDebateTaskId(task.id);
          setTab('debate');
          await window.collab.runDebate(projectPath, task.id);
        } else {
          await window.collab.executeTask(projectPath, task.id);
        }
        const next = await window.collab.openProject(projectPath);
        applySnapshot(next);
        const result = next.tasks.find((item) => item.id === task.id);
        notify(type === 'debate'
          ? result?.debateSummary ? '논쟁과 결론 기록을 저장했습니다.' : '논쟁을 중단했습니다.'
          : result?.status === 'approved' ? '실행과 교차 검수를 통과했습니다.'
            : result?.status === 'changes_requested' ? '검수에서 수정이 요청됐습니다. 업무 기록을 확인하세요.'
              : '실행이 종료됐습니다. 업무 상태를 확인하세요.');
      } catch (error) {
        notify(errorText(error), true);
      } finally {
        await refresh(projectPath).catch((error) => notify(errorText(error), true));
        setRunningTaskIds((previous) => new Set([...previous].filter((id) => id !== task.id)));
      }
    })();
  };

  const continueDebate = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!project || !selectedDebateTask || !followUp.trim() || runningTaskIds.has(selectedDebateTask.id)) return;
    const projectPath = project.path;
    const taskId = selectedDebateTask.id;
    setRunningTaskIds((previous) => new Set([...previous, taskId]));
    void (async () => {
      try {
        await window.collab.continueDebate(projectPath, taskId, {
          message: followUp.trim(),
          target: followUpTarget,
          additionalRounds: Math.max(1, extraRounds),
        });
        setFollowUp('');
        notify('추가 논쟁을 기록했습니다.');
      } catch (error) {
        notify(errorText(error), true);
      } finally {
        await refresh(projectPath).catch((error) => notify(errorText(error), true));
        setRunningTaskIds((previous) => new Set([...previous].filter((id) => id !== taskId)));
      }
    })();
  };

  const cancelTask = (task: Task): void => {
    if (!project) return;
    setCancelBusy(true);
    void window.collab.cancelRun(project.path, task.id)
      .then(() => notify('중단 요청을 보냈습니다.'))
      .catch((error) => notify(errorText(error), true))
      .finally(() => setCancelBusy(false));
  };

  const searchHistory = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!project) return;
    if (!searchQuery.trim()) return setSearchResults(null);
    void perform('이력 검색 중', async () => {
      setSearchResults(await window.collab.search(project.path, searchQuery.trim()));
    });
  };

  const openTranscript = (event: CollaborationEvent): void => {
    if (!project || typeof event.metadata?.transcript !== 'string') return;
    const transcript = event.metadata.transcript;
    void perform('원문 기록을 여는 중', async () => {
      const content = await window.collab.readTranscript(project.path, transcript);
      setTranscriptView({ path: transcript, content });
      setDialog('transcript');
    });
  };

  const openSession = (session: ExternalSession): void => {
    if (!project) return;
    if (session.hostId !== snapshot?.localHostId) return notify('다른 컴퓨터에서 만든 CLI 채팅은 해당 컴퓨터에서 열 수 있습니다.', true);
    void perform('CLI 채팅을 여는 중', async () => {
      await window.collab.openSession(project.path, session.sessionId);
      notify(`${providerLabel(session.provider)} CLI에서 채팅을 열었습니다.`);
    });
  };

  const openCodexDesktopSession = (session: ExternalSession): void => {
    if (!project || session.provider !== 'codex') return;
    if (session.hostId !== snapshot?.localHostId) return notify('다른 컴퓨터에서 만든 Codex 채팅은 해당 컴퓨터에서 열 수 있습니다.', true);
    void perform('Codex 앱에서 채팅을 여는 중', async () => {
      await window.collab.openCodexDesktopSession(project.path, session.sessionId);
      notify('Codex 앱에서 채팅을 열었습니다.');
    });
  };

  const changeModel = (role: 'executor' | 'reviewer', field: keyof ModelChoice, value: string): void => {
    setTaskDraft((previous) => ({
      ...previous,
      [role]: { ...previous[role], [field]: value },
    }));
  };

  const renderOverview = () => (
    <div className="section-stack">
      <div className="grid three">
        <div className="panel stat"><span className="stat-label">전체 업무</span><div className="stat-value">{taskCounts.total}</div><div className="stat-help">계획과 실행을 포함</div></div>
        <div className="panel stat"><span className="stat-label">진행 중</span><div className="stat-value">{taskCounts.active}</div><div className="stat-help">논쟁 · 실행 · 교차 검수</div></div>
        <div className="panel stat"><span className="stat-label">승인된 결과</span><div className="stat-value">{taskCounts.approved}</div><div className="stat-help">교차 검수를 통과</div></div>
      </div>
      <div className="panel panel-pad">
        <div className="panel-head"><div><h2>프로젝트 모델 채팅</h2><p className="subtle">이 컴퓨터에서 만든 CLI 채팅은 이어 열 수 있습니다. 다른 컴퓨터의 기록도 함께 보존됩니다.</p></div><span className="badge neutral">{project?.sessions?.length ?? 0}개 기록</span></div>
        {project?.sessions?.length ? <div className="session-grid">{project.sessions.map((session) => <SessionCard key={`${session.hostId}:${session.sessionId}`} session={session} localHostId={snapshot?.localHostId ?? ''} onOpen={openSession} onOpenCodex={openCodexDesktopSession} />)}</div>
          : <div className="session-empty">CLI 채팅이 아직 없습니다. CLI 로그인 상태와 전체 이력의 오류를 확인한 뒤 새로고침해 다시 시도하세요.</div>}
      </div>
      <div className="grid two">
        <div className="panel panel-pad">
          <div className="panel-head"><div><h2>프로젝트 헌장</h2><p className="subtle">목표와 완료 기준을 모든 실행에 다시 전달합니다.</p></div></div>
          <div className="field">
            <label htmlFor="charter">항상 유지할 목표 · 제약 · 완료 기준</label>
            <textarea id="charter" value={charterDraft} onChange={(event) => setCharterDraft(event.target.value)} rows={9} placeholder="예: 사용자의 데이터는 로컬에만 저장한다. 모든 변경은 검수 후 통합한다." />
          </div>
          <div className="form-actions"><button className="button primary" disabled={!!busy || charterDraft === project?.charter} onClick={saveCharter}>헌장 저장</button></div>
        </div>
        <div className="section-stack">
          <div className="panel panel-pad">
            <div className="panel-head"><div><h2>토론 기본 설정</h2><p className="subtle">각 모델이 반론과 상대 답변을 평가합니다.</p></div></div>
            <div className="field">
              <label htmlFor="rounds">기본 왕복 횟수</label>
              <input id="rounds" type="number" min={1} max={8} value={roundDraft} onChange={(event) => setRoundDraft(Number(event.target.value))} />
              <span>기본값 2회. 각 업무에서 별도로 변경할 수 있습니다.</span>
            </div>
            <div className="form-actions"><button className="button" disabled={!!busy || roundDraft === project?.defaultDebateRounds} onClick={saveRounds}>설정 저장</button></div>
          </div>
          <div className="panel panel-pad">
            <div className="panel-head"><h2>최근 활동</h2><button className="button ghost small" onClick={() => setTab('history')}>전체 기록 보기 →</button></div>
            {recentEvents.length ? recentEvents.map((event) => (
              <div className="activity-item" key={event.id}>
                <span className="activity-dot" />
                <span className="activity-copy"><strong>{eventLabel[event.type]}</strong> · {actorLabel(event.actor)}<br />{event.message.slice(0, 90)}{event.message.length > 90 ? '…' : ''}</span>
                <span className="activity-time">{shortTime(event.timestamp)}</span>
              </div>
            )) : <Empty icon="◷" title="아직 기록이 없습니다" detail="업무를 만들고 논쟁을 시작하면 모든 과정이 여기에 쌓입니다." />}
          </div>
        </div>
      </div>
      <div className="panel panel-pad">
        <div className="panel-head"><div><h2>프로젝트 저장 위치</h2><p className="subtle">모든 대화와 작업 이력은 이 폴더에 기록되고 Git으로 추적됩니다.</p></div></div>
        <div className="folder-line">{project?.path}</div>
      </div>
    </div>
  );

  const renderTasks = () => (
    <div>
      <div className="toolbar">
        <div><h2>업무 분장</h2><p className="subtle">담당자와 검수자를 지정하거나 자동으로 배정합니다.</p></div>
        <button className="button primary" onClick={() => openTaskDialog()}>＋ 새 업무</button>
      </div>
      <div className="panel panel-pad" style={{ marginBottom: 16 }}>
        <div className="panel-head"><div><h2>업무 계획 자동 생성</h2><p className="subtle">요청을 분석해 여러 업무와 완료 기준, 담당 모델을 제안합니다. 생성 후 직접 수정할 수 있습니다.</p></div></div>
        <div className="field"><label htmlFor="plan-request">프로젝트 목표 또는 새 요청</label><textarea id="plan-request" value={planRequest} onChange={(event) => setPlanRequest(event.target.value)} placeholder={project?.goal || '예: 제품의 첫 버전을 만들고 테스트까지 완료해 주세요.'} /></div>
        <div className="form-actions"><button className="button primary" disabled={!!busy || !(planRequest.trim() || project?.goal.trim())} onClick={planTasks}>{busy === '업무 계획을 만드는 중' ? '계획 생성 중…' : '업무 계획 자동 생성'}</button></div>
      </div>
      <div className="note" style={{ marginBottom: 16 }}>토론은 기본 2회 왕복하며 업무별로 조정할 수 있습니다. 실행 모델과 검수 모델은 각 업무에 따로 지정합니다.</div>
      <div className="panel task-list">
        {tasks.length ? tasks.map((task) => (
          <div className="task-row" key={task.id}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}><span className="task-name">{task.title}</span><span className={'badge ' + statusTone(task.status)}>{statusLabel[task.status]}</span></div>
              <div className="task-meta">
                <span>{task.mode === 'automatic' ? '자동 배정' : '수동 배정'}</span>
                <span>토론 {task.debateRounds}회</span>
                <span>완료 기준 {task.acceptanceCriteria.length}개</span>
                {task.dependsOn.length > 0 && <span>선행 업무 {task.dependsOn.length}개</span>}
              </div>
              <div className="model-pair" style={{ marginTop: 9 }}><ModelChip choice={task.executor} /><span>실행 → 검수</span><ModelChip choice={task.reviewer} /></div>
              {!!task.sessions?.length && <details className="task-sessions"><summary>별도 CLI 채팅 {task.sessions.length}개</summary><div className="session-grid">{task.sessions.map((session) => <SessionCard key={`${session.hostId}:${session.sessionId}`} session={session} localHostId={snapshot?.localHostId ?? ''} onOpen={openSession} onOpenCodex={openCodexDesktopSession} />)}</div></details>}
              {task.reviewSummary && <p className="subtle" style={{ marginTop: 8 }}>검수: {task.reviewSummary.slice(0, 150)}</p>}
            </div>
            <div className="task-controls">
              <button className="button small" disabled={!!busy} onClick={() => openTaskDialog(task)}>편집</button>
              {task.mode === 'automatic' && <button className="button small" disabled={!!busy} onClick={() => assignTask(task)}>자동 배정</button>}
              <button className="button small" disabled={!!busy} onClick={() => { setDebateTaskId(task.id); setTab('debate'); }}>논쟁 보기</button>
              <button className="button small" disabled={!!busy || runningTaskIds.has(task.id)} onClick={() => runTaskAction(task, 'debate')}>논쟁 시작</button>
              <button className="button primary small" disabled={!!busy || runningTaskIds.has(task.id) || task.status === 'running' || task.status === 'reviewing'} onClick={() => runTaskAction(task, 'execute')}>실행·검수</button>
              {(runningTaskIds.has(task.id) || ['debating', 'running', 'reviewing'].includes(task.status)) && <button className="button danger small" disabled={cancelBusy} onClick={() => cancelTask(task)}>중단</button>}
            </div>
          </div>
        )) : <Empty icon="▤" title="등록된 업무가 없습니다" detail="목표와 완료 기준을 작성하고 담당 모델을 배정해 보세요." />}
      </div>
    </div>
  );

  const renderDebate = () => (
    <div className="section-stack">
      <div className="toolbar">
        <div><h2>모델 논쟁</h2><p className="subtle">독립 제안부터 반론, 답변 평가, 결론까지 원문을 보존합니다.</p></div>
        <div className="toolbar-actions">
          {tasks.length > 0 && <select aria-label="토론할 업무" value={selectedDebateTask?.id ?? ''} onChange={(event) => setDebateTaskId(event.target.value)} className="button"><option value="" disabled>업무 선택</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>}
          {selectedDebateTask && <><button className="button primary" disabled={!!busy || runningTaskIds.has(selectedDebateTask.id)} onClick={() => runTaskAction(selectedDebateTask, 'debate')}>논쟁 시작</button>{runningTaskIds.has(selectedDebateTask.id) && <button className="button danger" disabled={cancelBusy} onClick={() => cancelTask(selectedDebateTask)}>중단</button>}</>}
        </div>
      </div>
      {selectedDebateTask ? <>
        <div className="note"><strong>{selectedDebateTask.title}</strong> · 기본 {selectedDebateTask.debateRounds}회 왕복. 양쪽 모델의 최종 입장과 미해결 쟁점이 기록됩니다.</div>
        <div className="debate-flow">
          {debateEvents.length ? debateEvents.map((event) => (
            <div className={'debate-card ' + (event.actor === 'system' || event.actor === 'user' ? '' : event.actor)} key={event.id}>
              <div className="debate-header"><span className={'model-chip ' + event.actor}>{actorLabel(event.actor)}</span><span className="debate-role">{eventLabel[event.type]}</span>{event.round !== undefined && <span className="badge neutral">{event.round}차</span>}{event.metadata?.transcript && <button className="button ghost small" onClick={() => openTranscript(event)}>CLI 원문</button>}<span className="activity-time" style={{ marginLeft: 'auto' }}>{shortTime(event.timestamp)}</span></div>
              <div className="debate-content">{event.message}</div>
            </div>
          )) : <div className="panel"><Empty icon="◇" title="아직 진행된 논쟁이 없습니다" detail="논쟁을 시작하면 양쪽의 제안과 반론이 순서대로 표시됩니다." /></div>}
        </div>
        {debateEvents.length > 0 && <div className="panel panel-pad">
          <div className="panel-head"><div><h2>추가 질문과 논쟁</h2><p className="subtle">논점을 직접 지정하고 더 검토할 모델을 선택하세요.</p></div></div>
          <form onSubmit={continueDebate} className="form-stack">
            <div className="field"><label htmlFor="follow-up">질문 또는 검토할 쟁점</label><textarea id="follow-up" value={followUp} onChange={(event) => setFollowUp(event.target.value)} placeholder="예: 두 모델의 결론 중 데이터 손실 위험을 다시 검토해 주세요." /></div>
            <div className="form-grid">
              <div className="field"><label htmlFor="follow-up-target">질문 대상</label><select id="follow-up-target" value={followUpTarget} onChange={(event) => setFollowUpTarget(event.target.value as Provider | 'both')}><option value="both">두 모델 모두</option><option value="codex">Codex</option><option value="claude">Claude</option></select></div>
              <div className="field"><label htmlFor="extra-rounds">추가 왕복 횟수</label><input id="extra-rounds" type="number" min={1} max={8} value={extraRounds} onChange={(event) => setExtraRounds(Number(event.target.value))} /></div>
            </div>
            <div className="form-actions"><button className="button primary" type="submit" disabled={!!busy || runningTaskIds.has(selectedDebateTask.id) || !followUp.trim()}>추가 논쟁 진행</button></div>
          </form>
        </div>}
      </> : <div className="panel"><Empty icon="◇" title="업무가 없습니다" detail="먼저 업무를 만들면 토론을 시작할 수 있습니다." /></div>}
    </div>
  );

  const renderHistory = () => (
    <div className="section-stack">
      <div className="toolbar"><div><h2>전체 이력</h2><p className="subtle">논쟁·작업·검수 원문을 검색합니다. 기록은 프로젝트 폴더에도 보존됩니다.</p></div><span className="badge neutral">원문 {events.length}개</span></div>
      <form onSubmit={searchHistory} className="search-box"><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="내용, 모델, 업무 기록 검색" aria-label="이력 검색어" /><button className="button primary" type="submit" disabled={!!busy}>검색</button>{searchResults && <button className="button" type="button" onClick={() => { setSearchResults(null); setSearchQuery(''); }}>초기화</button>}</form>
      <div className="panel panel-pad">
        {searchResults && <p className="subtle" style={{ marginBottom: 10 }}>검색 결과 {searchResults.length}개</p>}
        {searchDisplay.length ? searchDisplay.map((event) => (
          <div className="search-result" key={event.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="badge">{eventLabel[event.type]}</span><strong style={{ fontSize: 12 }}>{actorLabel(event.actor)}</strong><span className="activity-time">{shortTime(event.timestamp)}</span>{event.taskId && <span className="subtle">업무: {tasks.find((task) => task.id === event.taskId)?.title ?? event.taskId}</span>}{event.round !== undefined && <span className="subtle">{event.round}차</span>}{event.metadata?.transcript && <button className="button ghost small" onClick={() => openTranscript(event)}>CLI 원문 열기</button>}</div>
            <p>{event.message}</p>
          </div>
        )) : <Empty icon="⌕" title={searchResults ? '검색 결과가 없습니다' : '저장된 이력이 없습니다'} detail={searchResults ? '다른 검색어로 다시 찾아보세요.' : '모델과 주고받은 내용이 실행 시마다 이곳에 기록됩니다.'} />}
      </div>
    </div>
  );

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol"><img src={appIcon} alt="" /></div><span>LLM Collaboration</span></div>
      <div className="side-projects">
        <div className="side-label">프로젝트</div>
        {projects.map((item) => <button key={item.path} className={'project-item ' + (project?.path === item.path ? 'active' : '')} onClick={() => openProject(item)}><span className="project-dot" /><span className="project-name">{item.name}</span></button>)}
        <button className="side-action" onClick={() => setDialog('project')}><span className="plus">＋</span>새 프로젝트</button>
      </div>
      <div className="sidebar-bottom">
        <div className="side-label" style={{ padding: 0 }}>로컬 CLI</div>
        {(['codex', 'claude'] as Provider[]).map((provider) => {
          const status = bootstrap?.cli.find((item) => item.provider === provider);
          const ready = Boolean(status?.installed && /^(?:ChatGPT|Claude) 구독 로그인/u.test(status.authentication ?? ''));
          return <div className="cli-entry" key={provider}>
            <div className="cli-row"><strong>{providerLabel(provider)}</strong><span className={'status-indicator ' + (ready ? 'ok' : '')}>{ready ? '구독 준비됨' : status?.installed ? '로그인 확인 필요' : '설치 필요'}</span></div>
            <div className="cli-auth">{status?.authentication ?? '상태 확인 중'}</div>
          </div>;
        })}
      </div>
    </aside>
    <div className="main">
      <header className="topbar"><div className="breadcrumbs">프로젝트 <span> / </span><strong>{project?.name ?? '시작하기'}</strong></div><div className="topbar-actions"><span className={'topbar-note ' + (busy || runningTaskIds.size ? 'busy' : '')}>{busy ? '◌ ' + busy + '…' : runningTaskIds.size ? `◌ 업무 ${runningTaskIds.size}개 실행 중` : '로컬 CLI · 로컬 기록 · Git'}</span>{project && <button className="button small" onClick={() => void perform('새로고침 중', async () => refresh(project.path))} disabled={!!busy}>↻ 새로고침</button>}</div></header>
      <main className="content">
        {project ? <>
          <div className="page-head"><div><div className="eyebrow">WORKSPACE</div><h1>{project.name}</h1><p className="subtle">{project.goal || '프로젝트 목표를 바탕으로 두 모델이 계획하고 검수합니다.'}</p></div><div className="page-actions"><button className="button" onClick={() => setTab('history')}>이력 검색</button><button className="button primary" onClick={() => openTaskDialog()}>＋ 새 업무</button></div></div>
          <nav className="tabs" aria-label="프로젝트 화면"><button className={'tab ' + (tab === 'overview' ? 'active' : '')} onClick={() => setTab('overview')}>개요</button><button className={'tab ' + (tab === 'tasks' ? 'active' : '')} onClick={() => setTab('tasks')}>업무 <span className="tab-count">{tasks.length}</span></button><button className={'tab ' + (tab === 'debate' ? 'active' : '')} onClick={() => setTab('debate')}>논쟁</button><button className={'tab ' + (tab === 'history' ? 'active' : '')} onClick={() => setTab('history')}>전체 이력</button></nav>
          {tab === 'overview' ? renderOverview() : tab === 'tasks' ? renderTasks() : tab === 'debate' ? renderDebate() : renderHistory()}
        </> : <div className="welcome"><div className="panel welcome-card"><div className="brand-symbol"><img src={appIcon} alt="" /></div><div className="eyebrow">LOCAL FIRST WORKSPACE</div><h1>두 모델의 관점을 한곳에서</h1><p className="subtle">프로젝트 폴더를 지정하고 Codex와 Claude가 논쟁, 분업, 교차 검수를 진행하도록 설정하세요. 모든 대화와 산출물은 로컬에 보존됩니다.</p><button className="button primary" onClick={() => setDialog('project')}>첫 프로젝트 만들기</button></div></div>}
      </main>
    </div>
    {busy && <div className="busy-overlay"><div className="busy-bar" /></div>}
    {toast && <div className={'toast ' + (toast.error ? 'error' : '')} role="status" onClick={() => setToast(null)}>{toast.message}</div>}
    {dialog === 'project' && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="프로젝트 만들기"><div className="modal-header"><div><h2>새 프로젝트</h2><p className="subtle">지정한 폴더에 모든 산출물과 Git 기록을 저장합니다.</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><form className="modal-body form-stack" onSubmit={submitProject}>
      <div className="field"><label htmlFor="project-name">프로젝트 이름</label><input id="project-name" required value={projectDraft.name} onChange={(event) => setProjectDraft((previous) => ({ ...previous, name: event.target.value }))} placeholder="예: 새 서비스 개발" /></div>
      <div className="field"><label htmlFor="project-folder">프로젝트 폴더</label><div className="search-box"><input id="project-folder" required value={projectDraft.path} onChange={(event) => setProjectDraft((previous) => ({ ...previous, path: event.target.value }))} placeholder="절대 경로" /><button className="button" type="button" onClick={chooseDirectory}>폴더 선택</button></div><span>기존 폴더를 선택하거나 새 폴더 경로를 입력할 수 있습니다.</span></div>
      <div className="field"><label htmlFor="project-goal">프로젝트 목표</label><textarea id="project-goal" value={projectDraft.goal} onChange={(event) => setProjectDraft((previous) => ({ ...previous, goal: event.target.value }))} placeholder="이 프로젝트에서 달성할 결과를 적어 주세요." /></div>
      <div className="field"><label htmlFor="project-rounds">기본 토론 왕복 횟수</label><input id="project-rounds" type="number" min={1} max={8} value={projectDraft.defaultDebateRounds ?? 2} onChange={(event) => setProjectDraft((previous) => ({ ...previous, defaultDebateRounds: Number(event.target.value) }))} /><span>기본값은 2회이며 프로젝트와 업무마다 조정할 수 있습니다.</span></div>
      <div className="form-actions"><button className="button" type="button" onClick={() => setDialog(null)}>취소</button><button className="button primary" type="submit" disabled={!!busy}>프로젝트 만들기</button></div>
    </form></div></div>}
    {dialog === 'task' && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal" role="dialog" aria-modal="true" aria-label={editingTask ? '업무 편집' : '업무 만들기'}><div className="modal-header"><div><h2>{editingTask ? '업무 편집' : '새 업무'}</h2><p className="subtle">완료 기준과 모델별 역할을 명확히 지정합니다.</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><form className="modal-body form-stack" onSubmit={submitTask}>
      <div className="field"><label htmlFor="task-title">업무 제목</label><input id="task-title" required value={taskDraft.title} onChange={(event) => setTaskDraft((previous) => ({ ...previous, title: event.target.value }))} placeholder="예: 로그인 화면 구현" /></div>
      <div className="field"><label htmlFor="task-description">구체적인 지시</label><textarea id="task-description" required value={taskDraft.description} onChange={(event) => setTaskDraft((previous) => ({ ...previous, description: event.target.value }))} placeholder="필요한 기능, 범위, 제약을 적어 주세요." /></div>
      <div className="field"><label htmlFor="task-criteria">완료 기준</label><textarea id="task-criteria" value={criteriaDraft} onChange={(event) => setCriteriaDraft(event.target.value)} placeholder={'한 줄에 하나씩 입력\n예: 모든 입력 검증이 동작한다\n예: 테스트가 통과한다'} /><span>검수 모델이 각 항목을 확인합니다.</span></div>
      <div className="form-grid"><div className="field"><label htmlFor="assignment-mode">업무 분장</label><select id="assignment-mode" value={taskDraft.mode} onChange={(event) => setTaskDraft((previous) => ({ ...previous, mode: event.target.value as AssignmentMode }))}><option value="manual">직접 지정</option><option value="automatic">자동 배정</option></select></div><div className="field"><label htmlFor="task-rounds">토론 왕복 횟수</label><input id="task-rounds" type="number" min={1} max={8} value={taskDraft.debateRounds} onChange={(event) => setTaskDraft((previous) => ({ ...previous, debateRounds: Number(event.target.value) }))} /></div></div>
      <div className="form-grid"><div className="field"><label htmlFor="executor-provider">실행 모델</label><select id="executor-provider" value={taskDraft.executor.provider} onChange={(event) => changeModel('executor', 'provider', event.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option></select><input aria-label="실행 세부 모델" value={taskDraft.executor.model} onChange={(event) => changeModel('executor', 'model', event.target.value)} placeholder="세부 모델 (비우면 CLI 기본값)" /></div><div className="field"><label htmlFor="reviewer-provider">검수 모델</label><select id="reviewer-provider" value={taskDraft.reviewer.provider} onChange={(event) => changeModel('reviewer', 'provider', event.target.value)}><option value="claude">Claude</option><option value="codex">Codex</option></select><input aria-label="검수 세부 모델" value={taskDraft.reviewer.model} onChange={(event) => changeModel('reviewer', 'model', event.target.value)} placeholder="세부 모델 (비우면 CLI 기본값)" /></div></div>
      {taskDraft.mode === 'automatic' && <div className="note">저장 후 앱이 업무 성격에 따라 실행·검수 모델을 배정합니다. 배정 결과는 다시 편집할 수 있습니다.</div>}
      {tasks.filter((task) => task.id !== editingTask?.id).length > 0 && <div className="field"><label>선행 업무</label><div className="dependency-list">{tasks.filter((task) => task.id !== editingTask?.id).map((task) => <label className="dependency-item" key={task.id}><input type="checkbox" checked={taskDraft.dependsOn.includes(task.id)} onChange={(event) => setTaskDraft((previous) => ({ ...previous, dependsOn: event.target.checked ? [...previous.dependsOn, task.id] : previous.dependsOn.filter((id) => id !== task.id) }))} /><span>{task.title}</span></label>)}</div></div>}
      <div className="form-actions"><button className="button" type="button" onClick={() => setDialog(null)}>취소</button><button className="button primary" type="submit" disabled={!!busy}>저장</button></div>
    </form></div></div>}
    {dialog === 'transcript' && transcriptView && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal transcript-modal" role="dialog" aria-modal="true" aria-label="CLI 원문 기록"><div className="modal-header"><div><h2>CLI 원문 기록</h2><p className="subtle">{transcriptView.path}</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><div className="modal-body"><pre className="transcript-content">{transcriptView.content}</pre></div></div></div>}
  </div>;
}
