import { useEffect, useMemo, useState, type ClipboardEvent, type DragEvent, type FormEvent } from 'react';
import QRCode from 'qrcode';
import type {
  AssignmentMode,
  AppUpdateCheck,
  Bootstrap,
  CollaborationEvent,
  ConversationCandidate,
  ConversationTurn,
  ChatModelSettings,
  ChatAttachment,
  ChatFileInput,
  ExternalSession,
  EventType,
  ModelChoice,
  ModelCatalog,
  ImportedConversation,
  LaunchRequest,
  Project,
  ProjectInput,
  ProjectSnapshot,
  RemoteStatus,
  Provider,
  SessionTurn,
  Task,
  TaskInput,
  TaskStatus,
} from '../shared/types';
import appIcon from '../../assets/icon.svg?url';
import './styles.css';

type Tab = 'chat' | 'overview' | 'tasks' | 'debate' | 'history';
type Dialog = 'project' | 'task' | 'delete-project' | 'import-conversation' | 'imported-history' | 'transcript' | 'session-history' | 'chat-message' | null;
const chatAttachments = (event: CollaborationEvent): ChatAttachment[] => {
  try {
    const value = JSON.parse(String(event.metadata?.attachments ?? '[]')) as unknown;
    return Array.isArray(value) ? value.filter((item): item is ChatAttachment =>
      !!item && typeof item === 'object' && typeof item.name === 'string' && typeof item.path === 'string' && typeof item.size === 'number') : [];
  } catch { return []; }
};
const pendingFileName = (file: ChatFileInput): string => typeof file === 'string' ? file.split(/[\\/]/u).at(-1) ?? file : file.name;
const durationLabel = (seconds: number): string => `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`;
const encodeBrowserFile = (file: File): Promise<ChatFileInput> => new Promise((resolve, reject) => {
  if (file.size > 25 * 1024 * 1024) { reject(new Error('첨부 파일은 각각 25MB 이하여야 합니다.')); return; }
  const reader = new FileReader();
  reader.onerror = () => reject(new Error(`${file.name || '이미지'} 파일을 읽지 못했습니다.`));
  reader.onload = () => resolve({ name: file.name || `스크린샷-${Date.now()}.png`, data: String(reader.result).split(',')[1] ?? '' });
  reader.readAsDataURL(file);
});

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
  chat: '채팅',
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
const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  .replace(/^Error invoking remote method '[^']+': Error: /u, '');
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
  return <span className={'model-chip ' + choice.provider}>{providerLabel(choice.provider)}{choice.model ? ' · ' + choice.model : ''}{choice.effort ? ' · ' + choice.effort : ''}</span>;
}

function Empty({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><strong>{title}</strong><span>{detail}</span></div>;
}

function PairingQR({ url, token }: { url: string; token: string }) {
  const [image, setImage] = useState('');
  const link = `${url}/#pair=${token}`;
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(link, { width: 264, margin: 2, errorCorrectionLevel: 'M' })
      .then((value) => { if (active) setImage(value); })
      .catch(() => { if (active) setImage(''); });
    return () => { active = false; };
  }, [link]);
  return <div className="pairing-qr">{image && <img src={image} width="264" height="264" alt="아이폰 연결 QR 코드" />}<p className="subtle">아이폰 카메라로 스캔하면 모바일 화면이 바로 열립니다. Safari에서 공유 → 홈 화면에 추가를 누르면 아이콘으로 열 수 있습니다.</p></div>;
}

function SessionCard({ session, localHostId, onOpen, onOpenDesktop, onHandoff, onHistory }: { session: ExternalSession; localHostId: string; onOpen: (session: ExternalSession) => void; onOpenDesktop: (session: ExternalSession) => void; onHandoff: (session: ExternalSession) => void; onHistory: (session: ExternalSession) => void }) {
  const isLocal = session.hostId === localHostId;
  return <div className={'session-card ' + session.provider}>
    <div className="session-card-head"><span className={'model-chip ' + session.provider}>{providerLabel(session.provider)}</span><span className="badge neutral">{sessionPurposeLabel[session.purpose]}</span>{!isLocal && <span className="badge warning">다른 앱 환경</span>}{session.handedOffAt && <span className="badge success">데스크톱으로 이동됨</span>}<span className="activity-time">{shortTime(session.updatedAt)}</span></div>
    <div className="session-id" title={session.sessionId}>{session.sessionId}</div>
    <div className="session-actions"><button className="button small" type="button" disabled={!isLocal || !!session.handedOffAt} onClick={() => onOpen(session)}>{isLocal ? 'CLI에서 이어 열기 ↗' : '이 컴퓨터에서 열 수 없음'}</button>{session.provider === 'claude' && <button className="button small" type="button" disabled={!isLocal || !!session.handedOffAt} onClick={() => onHandoff(session)} title="Claude 대화형 CLI에 /desktop 명령을 자동 입력해 데스크톱으로 이동합니다.">{session.handedOffAt ? '데스크톱 이동 완료' : 'Claude Code로 자동 이동 ↗'}</button>}<button className="button small" type="button" onClick={() => onHistory(session)}>저장된 대화 보기</button><button className="button small" type="button" disabled={!isLocal || !!session.handedOffAt} onClick={() => onOpenDesktop(session)} title={session.provider === 'claude' ? '현재 CLI 기록을 Claude Code 데스크톱에 사본으로 가져옵니다. 이후 CLI와 데스크톱 대화는 자동 동기화되지 않습니다.' : undefined}>{session.provider === 'codex' ? 'Codex 앱에서 보기 ↗' : 'Claude Code에 사본 가져오기 ↗'}</button></div>
  </div>;
}

function SessionGroups({ sessions, localHostId, onOpen, onOpenDesktop, onHandoff, onHistory }: { sessions: ExternalSession[]; localHostId: string; onOpen: (session: ExternalSession) => void; onOpenDesktop: (session: ExternalSession) => void; onHandoff: (session: ExternalSession) => void; onHistory: (session: ExternalSession) => void }) {
  const card = (session: ExternalSession) => <SessionCard key={`${session.hostId}:${session.sessionId}`} session={session} localHostId={localHostId} onOpen={onOpen} onOpenDesktop={onOpenDesktop} onHandoff={onHandoff} onHistory={onHistory} />;
  return <div className="session-group-grid">{(['codex', 'claude'] as Provider[]).map((provider) => {
    const matching = sessions.filter((session) => session.provider === provider).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (!matching.length) return null;
    const primary = matching.find((session) => session.hostId === localHostId && !session.handedOffAt)
      ?? matching.find((session) => session.hostId === localHostId) ?? matching[0];
    const older = matching.filter((session) => session !== primary);
    return <section className="session-group" key={provider} aria-label={`${providerLabel(provider)} 대화 세션`}><h3>{providerLabel(provider)} 대화 <span className="badge neutral">{matching.length}개 기록</span></h3>{card(primary)}{older.length > 0 && <details className="session-older"><summary>이전 대화 {older.length}개 보기</summary><div className="session-grid">{older.map(card)}</div></details>}</section>;
  })}</div>;
}

function ConversationPicker({ candidates, selected, manualPath, manualProvider, busy, onSelect, onManualChange, onProviderChange, onChooseFile }: {
  candidates: ConversationCandidate[];
  selected: ConversationCandidate | null;
  manualPath: string;
  manualProvider: Provider;
  busy: boolean;
  onSelect: (candidate: ConversationCandidate) => void;
  onManualChange: (value: string) => void;
  onProviderChange: (value: Provider) => void;
  onChooseFile: () => void;
}) {
  return <div className="form-stack"><div className="import-candidates">{candidates.length ? candidates.map((candidate) => <button type="button" key={`${candidate.provider}:${candidate.sessionId}`} title={`${candidate.title}\n${candidate.cwd ?? ''}\n${candidate.sessionId}`} className={'import-candidate ' + (selected?.sessionId === candidate.sessionId && selected.provider === candidate.provider ? 'selected' : '')} onClick={() => onSelect(candidate)}><span className={'model-chip ' + candidate.provider}>{providerLabel(candidate.provider)}</span><strong>{candidate.title}</strong><small>{candidate.cwd ? `${candidate.cwd} · ` : ''}{candidate.turnCount}개 발화 · {shortTime(candidate.updatedAt)} · {candidate.sessionId.slice(0, 8)}</small></button>) : <div className="session-empty">{busy ? '채팅 목록을 찾고 있습니다…' : '자동으로 찾은 채팅이 없습니다. JSONL 파일을 직접 선택할 수 있습니다.'}</div>}</div><div className="field"><label>JSONL 파일 직접 선택</label><div className="search-box"><input value={manualPath} onChange={(event) => onManualChange(event.target.value)} placeholder="Codex 또는 Claude 대화 파일 경로" /><button className="button" type="button" onClick={onChooseFile}>파일 선택</button></div><select aria-label="직접 선택한 대화의 모델" value={manualProvider} onChange={(event) => onProviderChange(event.target.value as Provider)}><option value="codex">Codex</option><option value="claude">Claude</option></select></div></div>;
}

export default function App() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [projectDraft, setProjectDraft] = useState<ProjectInput>(defaultProject);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
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
  const [expandedChat, setExpandedChat] = useState<CollaborationEvent | null>(null);
  const [sessionHistory, setSessionHistory] = useState<{ session: ExternalSession; turns: SessionTurn[] } | null>(null);
  const [localConversations, setLocalConversations] = useState<ConversationCandidate[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<ConversationCandidate | null>(null);
  const [manualConversationPath, setManualConversationPath] = useState('');
  const [manualConversationProvider, setManualConversationProvider] = useState<Provider>('codex');
  const [importedHistory, setImportedHistory] = useState<{ conversation: ImportedConversation; turns: ConversationTurn[] } | null>(null);
  const [planRequest, setPlanRequest] = useState('');
  const [runningTaskIds, setRunningTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cliBusy, setCliBusy] = useState<Provider | 'refresh' | null>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [chatFiles, setChatFiles] = useState<ChatFileInput[]>([]);
  const [chatDragActive, setChatDragActive] = useState(false);
  const [chatDiscussion, setChatDiscussion] = useState(false);
  const [discussingMessageId, setDiscussingMessageId] = useState<string | null>(null);
  const [clockMs, setClockMs] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setClockMs(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const [chatTarget, setChatTarget] = useState<Provider | 'both'>('both');
  const [debateScope, setDebateScope] = useState<'project' | 'task'>('project');
  const [projectDiscussionId, setProjectDiscussionId] = useState('');
  const [chatModels, setChatModels] = useState<Record<Provider, ChatModelSettings>>({ codex: { model: '', effort: '' }, claude: { model: '', effort: '' } });
  const [modelCatalogs, setModelCatalogs] = useState<ModelCatalog[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [updateCheck, setUpdateCheck] = useState<AppUpdateCheck | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null);
  const [remoteOpen, setRemoteOpen] = useState(false);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const openRemote = (): void => {
    setRemoteOpen(true);
    setRemoteBusy(true);
    void window.collab.setRemoteEnabled(true)
      .then(setRemoteStatus)
      .catch((error: unknown) => notify(errorText(error), true))
      .finally(() => setRemoteBusy(false));
  };
  const [chatSendingPaths, setChatSendingPaths] = useState<ReadonlySet<string>>(() => new Set());

  const project = snapshot?.project ?? null;
  const tasks = snapshot?.tasks ?? [];
  const events = snapshot?.events ?? [];
  const chatSending = !!project && chatSendingPaths.has(project.path);
  const chatEvents = useMemo(() => events.filter((event) => event.actor === 'codex' || event.actor === 'claude'
    || (event.type === 'chat' && event.actor === 'user')
    || (event.type === 'status' && event.actor === 'user' && event.metadata?.taskRequest === true)
    || (event.type === 'error' && typeof event.metadata?.provider === 'string')), [events]);
  const selectedDebateTask = tasks.find((task) => task.id === debateTaskId) ?? tasks[0];
  const debateEvents = useMemo(
    () => events.filter((event) => event.taskId === selectedDebateTask?.id && debateTypes.includes(event.type)),
    [events, selectedDebateTask?.id],
  );
  const projectDiscussions = useMemo(() => events.filter((record) => record.type === 'chat' && record.actor === 'user'
    && events.some((reply) => reply.metadata?.replyTo === record.id
      && (typeof reply.metadata?.discussionRound === 'number' || reply.metadata?.discussionConclusion === true))), [events]);
  const selectedProjectDiscussion = projectDiscussions.find((record) => record.id === projectDiscussionId) ?? projectDiscussions.at(-1);
  const projectDebateEvents = useMemo(() => selectedProjectDiscussion
    ? [selectedProjectDiscussion, ...events.filter((record) => record.metadata?.replyTo === selectedProjectDiscussion.id
      && (record.type === 'chat' || record.metadata?.discussionConclusion === true))] : [],
  [events, selectedProjectDiscussion]);
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
    const openLinkedChat = async (request: LaunchRequest): Promise<void> => {
      const candidates = await window.collab.listLocalConversations(request);
      const matching = candidates.find((item) => item.provider === request.provider && item.sessionId === request.sessionId);
      setLocalConversations(candidates);
      setSelectedConversation(matching ?? null);
      setManualConversationPath('');
      setProjectDraft(defaultProject);
      setDialog('project');
      if (!matching) notify('현재 채팅을 로컬 기록에서 찾지 못했습니다. 채팅 목록 또는 JSONL 파일을 선택해 주세요.', true);
    };
    const unsubscribe = window.collab.onLaunchRequest((request) => { void openLinkedChat(request); });
    void window.collab.consumeLaunchRequest().then((request) => request && openLinkedChat(request));
    return unsubscribe;
  }, []);

  useEffect(() => {
    setCharterDraft(project?.charter ?? '');
    setRoundDraft(project?.defaultDebateRounds ?? 2);
  }, [project?.path, project?.charter, project?.defaultDebateRounds]);

  const openProject = (item: Project): void => {
    void perform('프로젝트를 여는 중', async () => {
      await refresh(item.path);
      setTab('chat');
    });
  };

  const removeProjectFromView = (removed: Project, message: string): void => {
    setProjects((previous) => previous.filter((item) => item.id !== removed.id));
    setBootstrap((previous) => previous && ({ ...previous, projects: previous.projects.filter((item) => item.id !== removed.id) }));
    setSnapshot(null);
    setDialog(null);
    setDeleteConfirmation('');
    setTab('overview');
    notify(message);
  };

  const deleteCurrentProject = (): void => {
    if (!project || deleteConfirmation !== project.name || runningTaskIds.size > 0) return;
    const removed = project;
    void perform('프로젝트 삭제 중', async () => {
      const result = await window.collab.deleteProject(removed.path, removed.id, deleteConfirmation);
      removeProjectFromView(removed, result === 'trashed'
        ? `${removed.name} 프로젝트 폴더를 휴지통으로 이동했습니다.`
        : `${removed.name} 프로젝트 등록을 목록에서 제거했습니다.`);
    });
  };

  const unregisterCurrentProject = (): void => {
    if (!project || deleteConfirmation !== project.name || runningTaskIds.size > 0) return;
    const removed = project;
    void perform('프로젝트 등록 제거 중', async () => {
      await window.collab.unregisterProjectOnly(removed.path, removed.id, deleteConfirmation);
      removeProjectFromView(removed, `${removed.name} 프로젝트를 앱 목록에서 제거했습니다. 로컬 폴더는 그대로 둡니다.`);
    });
  };

  const forgetMissingProject = (projectPath: string): void => {
    void perform('없는 프로젝트 정리 중', async () => {
      await window.collab.forgetMissingProject(projectPath);
      setBootstrap((previous) => previous && ({ ...previous,
        missingProjectPaths: previous.missingProjectPaths.filter((item) => item !== projectPath),
      }));
      notify('이미 삭제된 폴더의 프로젝트 등록을 제거했습니다.');
    });
  };

  const chooseDirectory = (): void => {
    void perform('폴더 선택 중', async () => {
      const path = await window.collab.chooseDirectory();
      if (path) setProjectDraft((previous) => ({ ...previous, path }));
    });
  };

  const updateCliStatuses = (cli: Bootstrap['cli']): void =>
    setBootstrap((previous) => previous && ({ ...previous, cli }));

  const refreshCliStatuses = async (): Promise<void> => {
    setCliBusy('refresh');
    try {
      updateCliStatuses(await window.collab.refreshCliStatus());
      await refreshModelCatalogs();
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setCliBusy(null);
    }
  };

  const refreshModelCatalogs = async (): Promise<void> => {
    setModelBusy(true);
    try {
      const catalogs = await window.collab.refreshModelCatalogs();
      setModelCatalogs(catalogs);
      setChatModels((previous) => Object.fromEntries((['codex', 'claude'] as Provider[]).map((provider) => {
        const current = previous[provider];
        const selected = catalogs.find((catalog) => catalog.provider === provider)?.models.find((model) => model.id === current.model);
        return [provider, selected ? { model: current.model, effort: selected.efforts.includes(current.effort) ? current.effort : '' } : { model: '', effort: '' }];
      })) as Record<Provider, ChatModelSettings>);
    } catch (error) { notify(errorText(error), true); }
    finally { setModelBusy(false); }
  };

  const checkForUpdate = async (): Promise<void> => {
    setUpdateBusy(true);
    try { setUpdateCheck(await window.collab.checkAppUpdate()); }
    catch (error) { notify(errorText(error), true); }
    finally { setUpdateBusy(false); }
  };

  const installUpdate = async (): Promise<void> => {
    setUpdateBusy(true);
    try { await window.collab.downloadAppUpdate(); }
    catch (error) { notify(errorText(error), true); setUpdateBusy(false); }
  };

  useEffect(() => {
    void refreshModelCatalogs();
    const onFocus = (): void => { void refreshModelCatalogs(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const configureCli = async (provider: Provider, automatic = false): Promise<void> => {
    setCliBusy(provider);
    try {
      const executable = automatic ? null : await window.collab.chooseCliExecutable();
      if (!automatic && !executable) return;
      updateCliStatuses(await window.collab.setCliExecutable(provider, executable));
    } catch (error) {
      notify(errorText(error), true);
    } finally {
      setCliBusy(null);
    }
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
        ...((selectedConversation || manualConversationPath.trim()) ? { initialConversation: {
          provider: selectedConversation?.provider ?? manualConversationProvider,
          filePath: selectedConversation?.filePath ?? manualConversationPath.trim(),
        } } : {}),
      }));
      setDialog(null);
      setTab('chat');
      setProjectDraft(defaultProject);
      notify(selectedConversation || manualConversationPath.trim()
        ? '기존 대화를 가져와 협업 프로젝트를 만들었습니다. 대화는 프로젝트 Git에 저장됐습니다.'
        : '프로젝트를 만들었습니다. 기록과 산출물은 지정한 폴더의 Git에 저장됩니다.');
    });
  };

  const loadLocalConversations = (): void => {
    void perform('로컬 대화를 찾는 중', async () => {
      setLocalConversations(await window.collab.listLocalConversations());
    });
  };

  const openProjectDialog = (): void => {
    setSelectedConversation(null);
    setManualConversationPath('');
    setDialog('project');
    loadLocalConversations();
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
      sourceConversationIds: task.sourceConversationIds ?? [],
    } : emptyTask(project?.defaultDebateRounds ?? 2));
    setCriteriaDraft(task?.acceptanceCriteria.join('\n') ?? '');
    setDialog('task');
  };

  const openImportDialog = (): void => {
    setSelectedConversation(null);
    setManualConversationPath('');
    setDialog('import-conversation');
    loadLocalConversations();
  };

  const chooseConversationFile = (): void => {
    void perform('대화 파일 선택 중', async () => {
      const filePath = await window.collab.chooseConversationFile();
      if (filePath) { setManualConversationPath(filePath); setSelectedConversation(null); }
    });
  };

  const importSelectedConversation = (): void => {
    if (!project) return;
    const selected = selectedConversation;
    const filePath = selected?.filePath ?? manualConversationPath;
    if (!filePath) return;
    void perform('대화를 가져오는 중', async () => {
      applySnapshot(await window.collab.importConversation(project.path, selected?.provider ?? manualConversationProvider, filePath));
      setDialog(null);
      notify('대화 원문을 프로젝트 Git에 저장했습니다. 이 대화를 선택해 협업 업무를 만들 수 있습니다.');
    });
  };

  const viewImportedConversation = (conversation: ImportedConversation): void => {
    if (!project) return;
    void perform('가져온 대화를 읽는 중', async () => {
      setImportedHistory({ conversation, turns: await window.collab.readImportedConversation(project.path, conversation.id) });
      setDialog('imported-history');
    });
  };

  const viewImportedRaw = (conversation: ImportedConversation): void => {
    if (!project) return;
    void perform('대화 원문을 읽는 중', async () => {
      const content = await window.collab.readImportedConversationRaw(project.path, conversation.id);
      setTranscriptView({ path: `.llm-collaboration/imports/${conversation.id}.jsonl`, content });
      setDialog('transcript');
    });
  };

  const createTaskFromConversation = (conversation: ImportedConversation): void => {
    setEditingTask(null);
    setTaskDraft({ ...emptyTask(project?.defaultDebateRounds ?? 2),
      title: `${conversation.title.slice(0, 65)} 협업`,
      description: '가져온 대화를 검토하고 남은 문제를 해결하세요. 대화의 기존 결정과 맥락을 확인한 뒤 필요한 작업을 수행하세요.',
      sourceConversationIds: [conversation.id],
    });
    setCriteriaDraft('가져온 대화의 요구사항과 현재 상태를 확인한다\n두 모델의 토론을 거쳐 합의된 작업을 구현하고 교차 검수한다');
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
          setDebateScope('task');
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

  const viewSessionHistory = (session: ExternalSession): void => {
    if (!project) return;
    void perform('저장된 대화를 읽는 중', async () => {
      const turns = await window.collab.readSessionHistory(project.path, session.sessionId);
      setSessionHistory({ session, turns });
      setDialog('session-history');
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

  const openDesktopSession = (session: ExternalSession): void => {
    if (!project) return;
    if (session.hostId !== snapshot?.localHostId) return notify('다른 컴퓨터에서 만든 채팅은 해당 컴퓨터에서 열 수 있습니다.', true);
    const appName = session.provider === 'codex' ? 'Codex' : 'Claude Code';
    void perform(`${appName} 앱에서 채팅을 여는 중`, async () => {
      await window.collab.openDesktopSession(project.path, session.sessionId, session.provider);
      notify(`${appName} 앱에 채팅을 열도록 요청했습니다.`);
    });
  };
  const handoffClaudeSession = (session: ExternalSession): void => {
    if (!project) return;
    void perform('Claude Code 데스크톱으로 이동 중', async () => {
      await window.collab.handoffClaudeSession(project.path, session.sessionId);
      await refresh(project.path);
      notify('Claude 대화를 데스크톱으로 이동했습니다. 이후 앱의 CLI 작업은 새 대화로 이어집니다.');
    });
  };

  const changeModel = (role: 'executor' | 'reviewer', field: keyof ModelChoice, value: string): void => {
    setTaskDraft((previous) => ({
      ...previous,
      [role]: { ...previous[role], [field]: value },
    }));
  };

  const sendChat = (submitEvent: FormEvent<HTMLFormElement>): void => {
    submitEvent.preventDefault();
    if (!project || (!chatDraft.trim() && !chatFiles.length) || chatSending) return;
    const projectPath = project.path;
    const message = chatDraft.trim();
    const target = chatTarget;
    const models = { ...chatModels };
    const files = [...chatFiles];
    setChatSendingPaths((previous) => new Set([...previous, projectPath]));
    setChatDraft('');
    void window.collab.sendProjectMessage(projectPath, message, target, models, files, chatDiscussion)
      .then((next) => { setSnapshot((current) => current?.project.path === projectPath ? next : current); setChatFiles([]); })
      .catch((error) => { setChatDraft((current) => current || message); notify(errorText(error), true); })
      .finally(() => setChatSendingPaths((previous) => new Set([...previous].filter((item) => item !== projectPath))));
  };

  const requestChatTask = (): void => {
    if (!project || !chatDraft.trim() || chatSending) return;
    if (chatTarget === 'both') { notify('업무 담당 모델을 Codex만 또는 Claude만으로 선택해 주세요.', true); return; }
    const projectPath = project.path;
    const message = chatDraft.trim();
    const files = [...chatFiles];
    const executor = chatTarget;
    const reviewer: Provider = executor === 'codex' ? 'claude' : 'codex';
    const title = message.split(/\r?\n/u).find((line) => line.trim())?.trim().slice(0, 80) ?? '채팅 업무';
    setChatSendingPaths((previous) => new Set([...previous, projectPath]));
    void (async () => {
      try {
        const attachmentSnapshot = files.length
          ? await window.collab.sendProjectMessage(projectPath, message, chatTarget, chatModels, files, false)
          : null;
        const attachmentEvent = attachmentSnapshot?.events.filter((item) => item.type === 'chat' && item.actor === 'user').at(-1);
        const attachmentPaths = typeof attachmentEvent?.metadata?.attachments === 'string'
          ? (JSON.parse(attachmentEvent.metadata.attachments) as Array<{ path: string }>).map((file) => file.path).join('\n')
          : '';
        const created = await window.collab.createTask(projectPath, {
          title,
          description: [message, attachmentPaths && `첨부 자료 경로 (프로젝트 폴더 기준):\n${attachmentPaths}`].filter(Boolean).join('\n\n'),
          acceptanceCriteria: ['요청한 결과를 프로젝트 폴더에 저장하고, 상대 모델이 요구사항 충족 여부를 확인한다.'],
          mode: 'manual', executor: { provider: executor, model: chatModels[executor].model, effort: chatModels[executor].effort },
          reviewer: { provider: reviewer, model: chatModels[reviewer].model, effort: chatModels[reviewer].effort }, dependsOn: [],
          debateRounds: project.defaultDebateRounds,
        });
        const task = created.tasks.at(-1);
        if (!task) throw new Error('생성된 업무를 찾을 수 없습니다. 업무 탭을 확인해 주세요.');
        setSnapshot((current) => current?.project.path === projectPath ? created : current);
        setChatDraft('');
        setChatFiles([]);
        setChatSendingPaths((previous) => new Set([...previous].filter((item) => item !== projectPath)));
        setRunningTaskIds((previous) => new Set([...previous, task.id]));
        setDebateTaskId(task.id);
        setDebateScope('task');
        setTab('debate');
        notify(`${providerLabel(executor)} 업무를 시작했습니다. 완료 후 ${providerLabel(reviewer)}가 검수합니다.`);
        try {
          await window.collab.runDebate(projectPath, task.id);
          const debated = await window.collab.openProject(projectPath);
          if (!debated.tasks.find((item) => item.id === task.id)?.debateSummary) throw new Error(`${task.title}의 토론이 완료되지 않아 실행을 중단했습니다.`);
          await window.collab.executeTask(projectPath, task.id);
          const finished = await window.collab.openProject(projectPath);
          const opposite = finished.tasks.filter((item) => item.id !== task.id && item.status === 'approved'
            && item.executor.provider === reviewer).at(-1);
          if (finished.tasks.find((item) => item.id === task.id)?.status === 'approved' && opposite) {
            await window.collab.sendProjectMessage(projectPath,
              `완료된 두 업무의 산출물을 서로 읽고 비교 분석하세요. ${providerLabel(executor)} 업무: ${task.title}. ${providerLabel(reviewer)} 업무: ${opposite.title}. 요구사항 누락, 파일 간 충돌, 품질 차이와 보완할 일을 구체적으로 토론하고 결론을 내려 주세요.`,
              'both', chatModels, [], true);
            notify('두 모델의 업무 결과를 교차 비교한 토론을 기록했습니다.');
          } else notify('업무 실행과 상대 모델의 검수가 끝났습니다.');
        } finally {
          setRunningTaskIds((previous) => new Set([...previous].filter((id) => id !== task.id)));
        }
      } catch (error) {
        notify(errorText(error), true);
      } finally {
        await refresh(projectPath).catch((error: unknown) => notify(errorText(error), true));
        setChatSendingPaths((previous) => new Set([...previous].filter((item) => item !== projectPath)));
      }
    })();
  };

  const addBrowserFiles = (files: readonly File[]): void => {
    if (!files.length) return;
    if (chatSending) { notify('현재 답변이 끝난 뒤 파일을 첨부해 주세요.', true); return; }
    void Promise.all(files.map(encodeBrowserFile)).then((encoded) => setChatFiles((current) => {
      if (current.length + encoded.length > 5) { notify('첨부 파일은 최대 5개입니다.', true); return current; }
      return [...current, ...encoded];
    })).catch((error: unknown) => notify(errorText(error), true));
  };
  const dropChatFiles = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setChatDragActive(false);
    addBrowserFiles([...event.dataTransfer.files]);
  };
  const pasteChatFiles = (event: ClipboardEvent<HTMLTextAreaElement>): void => {
    const files = [...event.clipboardData.items].filter((item) => item.kind === 'file')
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    if (files.length) { event.preventDefault(); addBrowserFiles(files); }
  };
  const continueChatDiscussion = (messageId: string): void => {
    if (!project || chatSending) return;
    const projectPath = project.path;
    setDiscussingMessageId(messageId);
    setChatSendingPaths((previous) => new Set([...previous, projectPath]));
    void window.collab.continueProjectDiscussion(projectPath, messageId)
      .then((next) => setSnapshot((current) => current?.project.path === projectPath ? next : current))
      .catch((error: unknown) => notify(errorText(error), true))
      .finally(() => { setDiscussingMessageId(null); setChatSendingPaths((previous) => new Set([...previous].filter((item) => item !== projectPath))); });
  };

  const renderChat = () => (
    <div className={`section-stack chat-drop-area${chatDragActive ? ' is-dragging' : ''}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        if (!chatDragActive) setChatDragActive(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setChatDragActive(false);
      }}
      onDrop={dropChatFiles}>
      {chatDragActive && <div className="chat-drop-hint" aria-hidden="true">이미지·파일을 놓아 첨부하기</div>}
      <div className="toolbar"><div><h2>프로젝트 채팅</h2><p className="subtle">Codex와 Claude의 답변을 나란히 보며 팀장으로서 방향을 조정하세요.</p></div></div>
      <div className="chat-grid">
        {(['codex', 'claude'] as Provider[]).map((provider) => {
          const visible = chatEvents.filter((item) => item.actor === provider
            || (item.actor === 'user' && (item.metadata?.target === 'both' || item.metadata?.target === provider))
            || (item.type === 'error' && item.metadata?.provider === provider));
          const latestRequest = visible.filter((item) => item.actor === 'user' && item.type === 'chat').at(-1);
          const pending = !!latestRequest && clockMs - Date.parse(latestRequest.timestamp) < 60 * 60_000
            && (latestRequest.metadata?.discussion || discussingMessageId === latestRequest.id
              ? !events.some((item) => item.metadata?.replyTo === latestRequest.id && item.metadata?.discussionConclusion)
              : !events.some((item) => item.metadata?.replyTo === latestRequest.id
                && (item.actor === provider || item.type === 'error' && item.metadata?.provider === provider)));
          const elapsed = latestRequest ? Math.max(0, Math.floor((clockMs - Date.parse(latestRequest.timestamp)) / 1000)) : 0;
          const samples = events.filter((item) => item.actor === provider && item.type === 'chat' && item.metadata?.replyTo)
            .map((item) => {
              const request = events.find((candidate) => candidate.id === item.metadata?.replyTo);
              return request ? Math.floor((Date.parse(item.timestamp) - Date.parse(request.timestamp)) / 1000) : 0;
            }).filter((seconds) => seconds >= 2 && seconds <= 3600).slice(-5).sort((left, right) => left - right);
          const typical = samples.length ? samples[Math.floor(samples.length / 2)] : 0;
          const discussionReplies = latestRequest ? events.filter((item) => item.metadata?.replyTo === latestRequest.id && typeof item.metadata?.discussionRound === 'number') : [];
          const completedRound = [1, 2, 3, 4, 5, 6, 7, 8].filter((round) => ['codex', 'claude'].every((name) =>
            discussionReplies.some((item) => item.actor === name && item.metadata?.discussionRound === round))).at(-1) ?? 0;
          return <section className={'panel chat-column ' + provider} key={provider} aria-label={`${providerLabel(provider)} 채팅`}>
            <div className="chat-column-head"><span className={'model-chip ' + provider}>{providerLabel(provider)}</span><span className="subtle">{visible.length}개 기록</span></div>
            <div className="chat-messages" aria-live="polite">
              {visible.length ? visible.map((item) => <article className={'chat-message ' + (item.actor === 'user' ? 'from-user' : item.type === 'error' ? 'from-error' : 'from-model')} key={item.id}>
                <div className="chat-message-head"><strong>{actorLabel(item.actor)}</strong>{item.type !== 'chat' && <span className="badge neutral">{item.metadata?.taskRequest ? '업무 요청' : eventLabel[item.type]}</span>}{item.metadata?.discussionRound && <span className="badge neutral">토론 {item.metadata.discussionRound}회차</span>}{item.taskId && <span className="badge neutral">{tasks.find((task) => task.id === item.taskId)?.title ?? '업무'}</span>}{item.actor === 'user' && item.metadata?.target === 'both' && <span className="badge neutral">두 모델 모두</span>}{item.type === 'chat' && item.actor === provider && item.metadata?.model && <span className="badge neutral">{item.metadata.model}{item.metadata.effort && item.metadata.effort !== 'default' ? ` · ${item.metadata.effort}` : ''}</span>}<span className="activity-time">{shortTime(item.timestamp)}</span></div>
                <div className="chat-message-text">{item.message}</div>
                {chatAttachments(item).length > 0 && <div className="chat-attachments">{chatAttachments(item).map((file) => <span className="badge neutral" key={file.path}>📎 {file.name} · {(file.size / 1024).toFixed(0)}KB</span>)}</div>}
                {item.actor === 'user' && provider === 'codex' && item.metadata?.target === 'both' && !item.metadata?.discussion && !events.some((record) => record.metadata?.replyTo === item.id && record.metadata?.discussionConclusion)
                  && ['codex', 'claude'].every((name) => events.some((record) => record.metadata?.replyTo === item.id && record.actor === name && record.type === 'chat'))
                  && <button className="button small" type="button" disabled={chatSending} onClick={() => continueChatDiscussion(item.id)}>이 두 답변으로 토론 시작</button>}
                <div className="chat-message-actions"><button className="button ghost small" type="button" onClick={() => { setExpandedChat(item); setDialog('chat-message'); }}>전체 보기</button>{item.metadata?.transcript && <button className="button ghost small" type="button" onClick={() => openTranscript(item)}>CLI 원문</button>}</div>
              </article>) : <Empty icon="◎" title="아직 대화가 없습니다" detail={`${providerLabel(provider)}에게 첫 메시지를 보내세요.`} />}
              {pending && <article className="chat-message from-model pending" role="status"><strong>{providerLabel(provider)} 생각 중 · 응답 생성 중…</strong><div className="chat-message-text">{latestRequest?.metadata?.discussion || discussingMessageId === latestRequest?.id ? `토론 ${Math.min(completedRound + 1, project?.defaultDebateRounds ?? 2)} / ${project?.defaultDebateRounds ?? 2}회차 · ` : ''}경과 {durationLabel(elapsed)} · {typical ? elapsed < typical ? `최근 응답 기준 예상 약 ${durationLabel(typical - elapsed)} 남음` : '최근 응답보다 오래 걸리는 중' : '완료 기록이 쌓이면 남은 시간을 예측합니다.'}<br />답변이 완성되면 자동으로 표시됩니다.</div></article>}
            </div>
          </section>;
        })}
      </div>
      <form className="panel panel-pad chat-compose" onSubmit={sendChat}>
        <div className="panel-head"><div><h2>지시 또는 질문</h2><p className="subtle">보낼 대상을 선택하세요. 지시는 프로젝트 Git 기록에 저장되고 이후 해당 모델의 업무 단계에도 전달됩니다.</p></div></div>
        <div className="chat-targets" role="group" aria-label="메시지 받을 모델">
          {([{ value: 'both', label: '두 모델 모두' }, { value: 'codex', label: 'Codex만' }, { value: 'claude', label: 'Claude만' }] as const).map(({ value, label }) => <button type="button" key={value} className={'button ' + (chatTarget === value ? 'primary' : '')} aria-pressed={chatTarget === value} onClick={() => setChatTarget(value)}>{label}</button>)}
        </div>
        <div className="chat-model-heading"><strong>모델과 추론 수준</strong><button className="button ghost small" type="button" disabled={modelBusy} onClick={() => void refreshModelCatalogs()}>{modelBusy ? '목록 확인 중…' : '↻ 모델 목록 새로고침'}</button></div>
        <div className="form-grid chat-models">{(['codex', 'claude'] as Provider[]).map((provider) => {
          const catalog = modelCatalogs.find((item) => item.provider === provider);
          const settings = chatModels[provider];
          const selected = catalog?.models.find((item) => item.id === settings.model);
          const disabled = chatTarget !== 'both' && chatTarget !== provider;
          return <div className="field" key={provider}><label htmlFor={`chat-model-${provider}`}>{providerLabel(provider)} 모델</label>
            <select id={`chat-model-${provider}`} value={settings.model} disabled={disabled || modelBusy} onChange={(event) => setChatModels((current) => ({ ...current, [provider]: { model: event.target.value, effort: '' } }))}>
              <option value="">CLI 기본 모델</option>{catalog?.models.map((item) => <option key={item.id} value={item.id}>{item.label}{item.requiresCredits ? ' · 추가 크레딧 사용 가능성' : ''}</option>)}
            </select>
            <label htmlFor={`chat-effort-${provider}`}>추론 수준</label>
            <select id={`chat-effort-${provider}`} value={settings.effort} disabled={disabled || !selected} onChange={(event) => setChatModels((current) => ({ ...current, [provider]: { ...current[provider], effort: event.target.value } }))}>
              <option value="">CLI 기본 수준</option>{selected?.efforts.map((effort) => <option key={effort} value={effort}>{effort}{selected.defaultEffort === effort ? ' · 기본값' : ''}</option>)}
            </select>
            <span>{catalog ? `${catalog.source} · ${catalog.cliVersion}` : '모델 목록을 확인하고 있습니다.'}</span>
            {catalog?.warning && <span className="chat-model-warning">{catalog.warning}</span>}
          </div>;
        })}</div>
        <div className="field"><label htmlFor="project-chat-input">메시지</label><textarea id="project-chat-input" value={chatDraft} maxLength={20_000} rows={4} onChange={(event) => setChatDraft(event.target.value)} onPaste={pasteChatFiles} placeholder="메시지 입력 · 이미지 여러 개 드래그 또는 Ctrl+V로 스크린샷 붙여넣기" /></div>
        <label className="chat-discussion-toggle"><input type="checkbox" checked={chatDiscussion} disabled={chatTarget !== 'both'} onChange={(event) => setChatDiscussion(event.target.checked)} />두 모델이 서로 반론하며 토론하기 · 기본 {project?.defaultDebateRounds ?? 2}회 왕복</label>
        <div className="chat-attachments"><button className="button small" type="button" disabled={chatSending || chatFiles.length >= 5} onClick={() => void window.collab.chooseChatFiles().then((chosen) => setChatFiles((current) => [...current, ...chosen].slice(0, 5))).catch((error: unknown) => notify(errorText(error), true))}>＋ 이미지·파일 첨부</button>{chatFiles.map((file, index) => <button className="button ghost small" type="button" key={`${pendingFileName(file)}-${index}`} title={pendingFileName(file)} onClick={() => setChatFiles((current) => current.filter((_, position) => position !== index))}>📎 {pendingFileName(file)} ×</button>)}</div>
        <div className="chat-compose-actions"><span className="subtle">첨부 파일은 프로젝트 Git에 저장됩니다. 업무는 Codex만 또는 Claude만을 선택해 각각 요청하세요. 완료되면 상대 모델이 검수합니다. 파일당 25MB, 총 50MB · 5개까지.</span><div className="session-actions">{chatSending && <button className="button danger" type="button" onClick={() => project && void window.collab.cancelProjectMessage(project.path)}>응답 중단</button>}<button className="button" type="button" disabled={!chatDraft.trim() || chatSending || chatTarget === 'both'} onClick={requestChatTask}>선택한 모델에 업무 요청</button><button className="button primary" type="submit" disabled={(!chatDraft.trim() && !chatFiles.length) || chatSending}>{chatSending ? '진행 중…' : '메시지 보내기'}</button></div></div>
      </form>
    </div>
  );

  const renderOverview = () => (
    <div className="section-stack">
      <div className="grid three">
        <div className="panel stat"><span className="stat-label">전체 업무</span><div className="stat-value">{taskCounts.total}</div><div className="stat-help">계획과 실행을 포함</div></div>
        <div className="panel stat"><span className="stat-label">진행 중</span><div className="stat-value">{taskCounts.active}</div><div className="stat-help">논쟁 · 실행 · 교차 검수</div></div>
        <div className="panel stat"><span className="stat-label">승인된 결과</span><div className="stat-value">{taskCounts.approved}</div><div className="stat-help">교차 검수를 통과</div></div>
      </div>
      <div className="panel panel-pad">
        <div className="panel-head"><div><h2>프로젝트 모델 채팅</h2><p className="subtle">이 컴퓨터에서 만든 CLI 채팅은 이어 열 수 있습니다. Claude Code 데스크톱으로 가져오면 그 시점의 사본이 생성되며 이후 답변은 자동 동기화되지 않습니다.</p></div><span className="badge neutral">{project?.sessions?.length ?? 0}개 기록</span></div>
        {project?.sessions?.length ? <SessionGroups sessions={project.sessions} localHostId={snapshot?.localHostId ?? ''} onOpen={openSession} onOpenDesktop={openDesktopSession} onHandoff={handoffClaudeSession} onHistory={viewSessionHistory} />
          : <div className="session-empty">CLI 채팅이 아직 없습니다. CLI 로그인 상태와 전체 이력의 오류를 확인한 뒤 새로고침해 다시 시도하세요.</div>}
      </div>
      <div className="panel panel-pad">
        <div className="panel-head"><div><h2>가져온 모델 대화</h2><p className="subtle">이 컴퓨터의 Codex·Claude 대화를 프로젝트에 복사하고 협업 업무의 맥락으로 연결합니다.</p></div><button className="button primary small" disabled={!!busy} onClick={openImportDialog}>＋ 대화 가져오기</button></div>
        {project?.importedConversations?.length ? <div className="imported-list">{project.importedConversations.map((conversation) => <div className="imported-item" key={conversation.id}><div><span className={'model-chip ' + conversation.provider}>{providerLabel(conversation.provider)}</span><strong>{conversation.title}</strong><p className="subtle">{conversation.turnCount}개 발화 · {shortTime(conversation.updatedAt)} · 프로젝트 Git에 보관</p></div><div className="session-actions"><button className="button small" onClick={() => viewImportedConversation(conversation)}>대화 보기</button><button className="button primary small" onClick={() => createTaskFromConversation(conversation)}>이 대화로 업무 만들기</button></div></div>)}</div>
          : <div className="session-empty">가져온 대화가 없습니다. 로컬 대화 목록 또는 JSONL 파일에서 선택하세요.</div>}
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
                {!!task.sourceConversationIds?.length && <span>참고 대화 {task.sourceConversationIds.length}개</span>}
              </div>
              <div className="model-pair" style={{ marginTop: 9 }}><ModelChip choice={task.executor} /><span>실행 → 검수</span><ModelChip choice={task.reviewer} /></div>
              {!!task.sessions?.length && <details className="task-sessions"><summary>별도 CLI 채팅 {task.sessions.length}개</summary><SessionGroups sessions={task.sessions} localHostId={snapshot?.localHostId ?? ''} onOpen={openSession} onOpenDesktop={openDesktopSession} onHandoff={handoffClaudeSession} onHistory={viewSessionHistory} /></details>}
              {task.reviewSummary && <p className="subtle" style={{ marginTop: 8 }}>검수: {task.reviewSummary.slice(0, 150)}</p>}
            </div>
            <div className="task-controls">
              <button className="button small" disabled={!!busy} onClick={() => openTaskDialog(task)}>편집</button>
              {task.mode === 'automatic' && <button className="button small" disabled={!!busy} onClick={() => assignTask(task)}>자동 배정</button>}
              <button className="button small" disabled={!!busy} onClick={() => { setDebateTaskId(task.id); setDebateScope('task'); setTab('debate'); }}>논쟁 보기</button>
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
        <div><h2>모델 논쟁</h2><p className="subtle">프로젝트 채팅과 업무에서 진행한 반론·재평가·결론의 원문을 보존합니다.</p></div>
        <div className="toolbar-actions">
          <button className={`button ${debateScope === 'project' ? 'primary' : ''}`} type="button" onClick={() => setDebateScope('project')}>프로젝트 채팅 토론 {projectDiscussions.length}</button>
          <button className={`button ${debateScope === 'task' ? 'primary' : ''}`} type="button" onClick={() => setDebateScope('task')}>업무 논쟁</button>
          {debateScope === 'project' && projectDiscussions.length > 0 && <select aria-label="프로젝트 토론 선택" value={selectedProjectDiscussion?.id ?? ''} onChange={(event) => setProjectDiscussionId(event.target.value)} className="button">{[...projectDiscussions].reverse().map((record) => <option key={record.id} value={record.id}>{shortTime(record.timestamp)} · {record.message.slice(0, 50)}</option>)}</select>}
          {debateScope === 'task' && tasks.length > 0 && <select aria-label="토론할 업무" value={selectedDebateTask?.id ?? ''} onChange={(event) => setDebateTaskId(event.target.value)} className="button"><option value="" disabled>업무 선택</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select>}
          {debateScope === 'task' && selectedDebateTask && <><button className="button primary" disabled={!!busy || runningTaskIds.has(selectedDebateTask.id)} onClick={() => runTaskAction(selectedDebateTask, 'debate')}>논쟁 시작</button>{runningTaskIds.has(selectedDebateTask.id) && <button className="button danger" disabled={cancelBusy} onClick={() => cancelTask(selectedDebateTask)}>중단</button>}</>}
        </div>
      </div>
      {debateScope === 'project' ? projectDebateEvents.length > 0 ? <div className="debate-flow">{projectDebateEvents.map((record) => <div className={'debate-card ' + (record.actor === 'system' || record.actor === 'user' ? '' : record.actor)} key={record.id}><div className="debate-header"><span className={'model-chip ' + record.actor}>{actorLabel(record.actor)}</span><span className="debate-role">{record.metadata?.discussionConclusion ? '최종 결론' : record.metadata?.discussionRound ? '상호 반론' : record.actor === 'user' ? '토론 요청' : '최초 답변'}</span>{record.metadata?.discussionRound && <span className="badge neutral">{record.metadata.discussionRound}회차</span>}{record.metadata?.transcript && <button className="button ghost small" onClick={() => openTranscript(record)}>CLI 원문</button>}<span className="activity-time" style={{ marginLeft: 'auto' }}>{shortTime(record.timestamp)}</span></div><div className="debate-content">{record.message}</div></div>)}</div> : <div className="panel"><Empty icon="◇" title="프로젝트 채팅 토론이 없습니다" detail="채팅에서 두 모델을 선택하고 토론을 요청하면 이곳에 왕복 기록이 표시됩니다." /></div> : selectedDebateTask ? <>
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
      <div className="toolbar"><div><h2>전체 이력</h2><p className="subtle">논쟁·작업·검수와 가져온 대화를 검색합니다. 기록은 프로젝트 폴더에도 보존됩니다.</p></div><span className="badge neutral">원문 {events.length}개</span></div>
      <form onSubmit={searchHistory} className="search-box"><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="내용, 모델, 업무 기록 검색" aria-label="이력 검색어" /><button className="button primary" type="submit" disabled={!!busy}>검색</button>{searchResults && <button className="button" type="button" onClick={() => { setSearchResults(null); setSearchQuery(''); }}>초기화</button>}</form>
      <div className="panel panel-pad">
        {searchResults && <p className="subtle" style={{ marginBottom: 10 }}>검색 결과 {searchResults.length}개</p>}
        {searchDisplay.length ? searchDisplay.map((event) => (
          <div className="search-result" key={event.id}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="badge">{event.metadata?.source === 'imported' ? '가져온 대화' : eventLabel[event.type]}</span><strong style={{ fontSize: 12 }}>{actorLabel(event.actor)}</strong><span className="activity-time">{shortTime(event.timestamp)}</span>{event.taskId && <span className="subtle">업무: {tasks.find((task) => task.id === event.taskId)?.title ?? event.taskId}</span>}{event.round !== undefined && <span className="subtle">{event.round}차</span>}{event.metadata?.transcript && <button className="button ghost small" onClick={() => openTranscript(event)}>CLI 원문 열기</button>}{typeof event.metadata?.conversationId === 'string' && <button className="button ghost small" onClick={() => { const conversation = project?.importedConversations?.find((item) => item.id === event.metadata?.conversationId); if (conversation) viewImportedConversation(conversation); }}>대화 보기</button>}</div>
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
        {bootstrap?.missingProjectPaths.map((projectPath) => <div className="missing-project" key={projectPath}><span title={projectPath}>폴더/기록 없음 · {projectPath}</span><button type="button" disabled={!!busy} onClick={() => forgetMissingProject(projectPath)}>등록만 제거</button></div>)}
        <button className="side-action" onClick={openProjectDialog}><span className="plus">＋</span>새 프로젝트</button>
      </div>
      <div className="sidebar-bottom">
        <div className="cli-heading"><div className="side-label">로컬 CLI</div><button className="cli-refresh" type="button" onClick={() => void refreshCliStatuses()} disabled={cliBusy !== null} title="CLI 설치 및 로그인 상태 다시 확인">{cliBusy === 'refresh' ? '확인 중…' : '↻ 상태 새로고침'}</button></div>
        {(['codex', 'claude'] as Provider[]).map((provider) => {
          const status = bootstrap?.cli.find((item) => item.provider === provider);
          const ready = Boolean(status?.installed && /^(?:ChatGPT|Claude) 구독 로그인/u.test(status.authentication ?? ''));
          return <div className="cli-entry" key={provider}>
            <div className="cli-row"><strong>{providerLabel(provider)}</strong><span className={'status-indicator ' + (ready ? 'ok' : '')}>{ready ? '구독 준비됨' : status?.installed ? '로그인 확인 필요' : status?.configured ? '지정 경로 확인 필요' : 'CLI 미발견'}</span></div>
            <div className="cli-auth">{status?.authentication ?? '상태 확인 중'}</div>
            {status?.executable && <div className="cli-path" title={status.executable}>{status.executable}</div>}
            <div className="cli-actions"><button type="button" onClick={() => void configureCli(provider)} disabled={cliBusy !== null}>{cliBusy === provider ? '확인 중…' : '경로 지정'}</button>{status?.configured && <button type="button" onClick={() => void configureCli(provider, true)} disabled={cliBusy !== null}>자동 탐색</button>}</div>
          </div>;
        })}
        <p className="cli-help">로그인은 Codex·Claude CLI에서 진행합니다. 이 앱에는 계정 정보를 입력하지 않습니다.</p>
      </div>
    </aside>
    <div className="main">
      <header className="topbar"><div className="breadcrumbs">프로젝트 <span> / </span><strong>{project?.name ?? '시작하기'}</strong></div><div className="topbar-actions"><span className={'topbar-note ' + (busy || runningTaskIds.size ? 'busy' : '')}>{busy ? '◌ ' + busy + '…' : runningTaskIds.size ? `◌ 업무 ${runningTaskIds.size}개 실행 중` : '로컬 CLI · 로컬 기록 · Git'}</span><button className="button small" type="button" disabled={remoteBusy} onClick={openRemote}>{remoteBusy ? '모바일 연결 중…' : '모바일 연결'}</button><button className="button small" type="button" disabled={updateBusy} onClick={() => void checkForUpdate()}>{updateBusy ? '업데이트 확인 중…' : '앱 업데이트'}</button>{project && <button className="button small" onClick={() => void perform('새로고침 중', async () => refresh(project.path))} disabled={!!busy}>↻ 새로고침</button>}</div></header>
      <main className="content">
        {project ? <>
          <div className="page-head"><div><div className="eyebrow">WORKSPACE</div><h1>{project.name}</h1><p className="subtle">{project.goal || '프로젝트 목표를 바탕으로 두 모델이 계획하고 검수합니다.'}</p></div><div className="page-actions"><button className="button danger" type="button" disabled={!!busy || runningTaskIds.size > 0} onClick={() => { setDeleteConfirmation(''); setDialog('delete-project'); }}>프로젝트 삭제</button><button className="button" onClick={() => setTab('history')}>이력 검색</button><button className="button primary" onClick={() => openTaskDialog()}>＋ 새 업무</button></div></div>
          <nav className="tabs" aria-label="프로젝트 화면"><button className={'tab ' + (tab === 'chat' ? 'active' : '')} onClick={() => setTab('chat')}>채팅</button><button className={'tab ' + (tab === 'overview' ? 'active' : '')} onClick={() => setTab('overview')}>개요</button><button className={'tab ' + (tab === 'tasks' ? 'active' : '')} onClick={() => setTab('tasks')}>업무 <span className="tab-count">{tasks.length}</span></button><button className={'tab ' + (tab === 'debate' ? 'active' : '')} onClick={() => setTab('debate')}>논쟁</button><button className={'tab ' + (tab === 'history' ? 'active' : '')} onClick={() => setTab('history')}>전체 이력</button></nav>
          {tab === 'chat' ? renderChat() : tab === 'overview' ? renderOverview() : tab === 'tasks' ? renderTasks() : tab === 'debate' ? renderDebate() : renderHistory()}
        </> : <div className="welcome"><div className="panel welcome-card"><div className="brand-symbol"><img src={appIcon} alt="" /></div><div className="eyebrow">LOCAL FIRST WORKSPACE</div><h1>두 모델의 관점을 한곳에서</h1><p className="subtle">프로젝트 폴더를 지정하고 Codex와 Claude가 논쟁, 분업, 교차 검수를 진행하도록 설정하세요. 모든 대화와 산출물은 로컬에 보존됩니다.</p><button className="button primary" onClick={openProjectDialog}>첫 프로젝트 만들기</button></div></div>}
      </main>
    </div>
    {busy && <div className="busy-overlay"><div className="busy-bar" /></div>}
    {toast && <div className={'toast ' + (toast.error ? 'error' : '')} role="status" onClick={() => setToast(null)}>{toast.message}</div>}
    {updateCheck && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setUpdateCheck(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="앱 업데이트"><div className="modal-header"><div><h2>앱 업데이트</h2><p className="subtle">현재 {updateCheck.currentVersion} · 최신 {updateCheck.latestVersion}</p></div><button className="close" aria-label="닫기" onClick={() => setUpdateCheck(null)}>×</button></div><div className="modal-body"><p className="subtle">{updateCheck.available ? updateCheck.assetName ? `${updateCheck.assetName} 파일을 내려받아 SHA-256 확인 후 실행합니다. 앱이 종료됩니다.` : '새 버전이 있지만 이 운영체제용 파일이 없습니다.' : '현재 최신 버전을 사용 중입니다.'}</p><div className="form-actions"><button className="button" type="button" onClick={() => setUpdateCheck(null)}>닫기</button>{updateCheck.available && updateCheck.assetName && <button className="button primary" type="button" disabled={updateBusy} onClick={() => void installUpdate()}>{updateBusy ? '다운로드 중…' : '다운로드하고 업데이트'}</button>}</div></div></div></div>}
    {remoteOpen && remoteStatus && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setRemoteOpen(false)}><div className="modal" role="dialog" aria-modal="true" aria-label="아이폰 원격 연결"><div className="modal-header"><div><h2>아이폰 원격 연결</h2><p className="subtle">PC와 iPhone을 같은 Tailscale 네트워크에 연결하세요.</p></div><button className="close" aria-label="닫기" onClick={() => setRemoteOpen(false)}>×</button></div><div className="modal-body form-stack"><p className="subtle">데스크톱이 켜져 있는 동안 아이폰에서 프로젝트 기록을 보고 Codex·Claude에게 지시할 수 있습니다. CLI 구독 로그인은 이 PC에만 유지됩니다.</p><div className="note"><strong>상태</strong><br />{remoteStatus.enabled ? remoteStatus.url ? '연결 대기 중' : 'Tailscale 연결 필요' : '꺼짐'}{remoteStatus.error && <p>{remoteStatus.error}</p>}</div>{remoteStatus.url && remoteStatus.token && <PairingQR url={remoteStatus.url} token={remoteStatus.token} />}{remoteStatus.url && <div className="field"><label>아이폰에 입력할 주소</label><input readOnly value={remoteStatus.url} onFocus={(event) => event.currentTarget.select()} /></div>}<div className="field"><label>연결 코드 · 비밀번호처럼 보관하세요</label><input readOnly value={remoteStatus.token ?? ''} onFocus={(event) => event.currentTarget.select()} /></div><div className="form-actions"><button className="button" type="button" disabled={remoteBusy} onClick={() => { setRemoteBusy(true); void window.collab.rotateRemoteToken().then(setRemoteStatus).catch((error: unknown) => notify(errorText(error), true)).finally(() => setRemoteBusy(false)); }}>코드 재발급</button>{remoteStatus.enabled && !remoteStatus.url && <button className="button" type="button" disabled={remoteBusy} onClick={() => { setRemoteBusy(true); void window.collab.setRemoteEnabled(true).then(setRemoteStatus).catch((error: unknown) => notify(errorText(error), true)).finally(() => setRemoteBusy(false)); }}>연결 다시 시도</button>}<button className={'button ' + (remoteStatus.enabled ? 'danger' : 'primary')} type="button" disabled={remoteBusy} onClick={() => { setRemoteBusy(true); void window.collab.setRemoteEnabled(!remoteStatus.enabled).then(setRemoteStatus).catch((error: unknown) => notify(errorText(error), true)).finally(() => setRemoteBusy(false)); }}>{remoteStatus.enabled ? '원격 연결 끄기' : '원격 연결 켜기'}</button></div></div></div></div>}
    {dialog === 'project' && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal" role="dialog" aria-modal="true" aria-label="프로젝트 만들기"><div className="modal-header"><div><h2>새 프로젝트</h2><p className="subtle">지정한 폴더에 모든 산출물과 Git 기록을 저장합니다.</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><form className="modal-body form-stack" onSubmit={submitProject}>
      <div className="field"><label htmlFor="project-name">프로젝트 이름</label><input id="project-name" required value={projectDraft.name} onChange={(event) => setProjectDraft((previous) => ({ ...previous, name: event.target.value }))} placeholder="예: 새 서비스 개발" /></div>
      <div className="field"><label htmlFor="project-folder">프로젝트 폴더</label><div className="search-box"><input id="project-folder" required value={projectDraft.path} onChange={(event) => setProjectDraft((previous) => ({ ...previous, path: event.target.value }))} placeholder="절대 경로" /><button className="button" type="button" onClick={chooseDirectory}>폴더 선택</button></div><span>기존 폴더를 선택하거나 새 폴더 경로를 입력할 수 있습니다.</span></div>
      <div className="field"><label htmlFor="project-goal">프로젝트 목표</label><textarea id="project-goal" value={projectDraft.goal} onChange={(event) => setProjectDraft((previous) => ({ ...previous, goal: event.target.value }))} placeholder="이 프로젝트에서 달성할 결과를 적어 주세요." /></div>
      <div className="field"><label htmlFor="project-rounds">기본 토론 왕복 횟수</label><input id="project-rounds" type="number" min={1} max={8} value={projectDraft.defaultDebateRounds ?? 2} onChange={(event) => setProjectDraft((previous) => ({ ...previous, defaultDebateRounds: Number(event.target.value) }))} /><span>기본값은 2회이며 프로젝트와 업무마다 조정할 수 있습니다.</span></div>
      <div className="field"><label>기존 Codex·Claude 채팅에서 시작 (선택)</label><span>채팅 제목과 작업 폴더로 찾거나, Codex·Claude Code 채팅에서 “LLM콜라보레이션 하자”라고 요청해 이 창을 열 수 있습니다.</span><button className="button small" type="button" onClick={() => void perform('채팅 연결 설정 중', async () => { await window.collab.installChatSkills(); notify('채팅 연결을 설치했습니다. Codex·Claude Code에서 새 채팅을 열거나 스킬을 다시 불러와 주세요.'); })}>채팅 연결 설치·복구</button><ConversationPicker candidates={localConversations} selected={selectedConversation} manualPath={manualConversationPath} manualProvider={manualConversationProvider} busy={!!busy} onSelect={(candidate) => { setSelectedConversation(candidate); setManualConversationPath(''); }} onManualChange={(value) => { setManualConversationPath(value); setSelectedConversation(null); }} onProviderChange={setManualConversationProvider} onChooseFile={chooseConversationFile} /></div>
      <div className="form-actions"><button className="button" type="button" onClick={() => setDialog(null)}>취소</button><button className="button primary" type="submit" disabled={!!busy}>프로젝트 만들기</button></div>
    </form></div></div>}
    {dialog === 'delete-project' && project && <div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-label="프로젝트 삭제 확인"><div className="modal-header"><div><h2>프로젝트 삭제</h2><p className="subtle">앱 목록에서만 제거하거나 폴더까지 휴지통으로 이동할 수 있습니다.</p></div><button className="close" aria-label="닫기" disabled={!!busy} onClick={() => setDialog(null)}>×</button></div><div className="modal-body form-stack"><div className="note"><strong>삭제할 프로젝트</strong><br />{project.name}</div><div className="folder-line" title={project.path}>{project.path}</div><div className="field"><label htmlFor="delete-project-name">확인하려면 프로젝트 이름을 그대로 입력하세요</label><input id="delete-project-name" autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={project.name} /></div><p className="subtle">앱 목록에서만 제거하면 위 경로의 폴더와 Git 기록은 그대로 남습니다.</p><div className="form-actions"><button className="button" type="button" disabled={!!busy} onClick={() => setDialog(null)}>취소</button><button className="button" type="button" disabled={!!busy || deleteConfirmation !== project.name || runningTaskIds.size > 0} onClick={unregisterCurrentProject}>앱 목록에서만 제거</button><button className="button danger" type="button" disabled={!!busy || deleteConfirmation !== project.name || runningTaskIds.size > 0} onClick={deleteCurrentProject}>폴더도 휴지통으로 이동</button></div></div></div></div>}
    {dialog === 'import-conversation' && project && <div className="modal-backdrop"><div className="modal import-modal" role="dialog" aria-modal="true" aria-label="기존 대화 가져오기"><div className="modal-header"><div><h2>Codex·Claude 대화 가져오기</h2><p className="subtle">로컬 대화를 골라 현재 프로젝트에 사본을 저장합니다.</p></div><button className="close" aria-label="닫기" disabled={!!busy} onClick={() => setDialog(null)}>×</button></div><div className="modal-body form-stack"><ConversationPicker candidates={localConversations} selected={selectedConversation} manualPath={manualConversationPath} manualProvider={manualConversationProvider} busy={!!busy} onSelect={(candidate) => { setSelectedConversation(candidate); setManualConversationPath(''); }} onManualChange={(value) => { setManualConversationPath(value); setSelectedConversation(null); }} onProviderChange={setManualConversationProvider} onChooseFile={chooseConversationFile} /><p className="subtle">선택한 시점의 대화 원문을 프로젝트 Git에 복사합니다. 이후 원래 채팅과 자동 동기화되지는 않습니다.</p><div className="form-actions"><button className="button" type="button" disabled={!!busy} onClick={() => setDialog(null)}>취소</button><button className="button primary" type="button" disabled={!!busy || !(selectedConversation || manualConversationPath)} onClick={importSelectedConversation}>대화 가져오기</button></div></div></div></div>}
    {dialog === 'imported-history' && importedHistory && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal session-history-modal" role="dialog" aria-modal="true" aria-label="가져온 모델 대화"><div className="modal-header"><div><h2>{providerLabel(importedHistory.conversation.provider)}에서 가져온 대화</h2><p className="subtle">{importedHistory.conversation.title}</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><div className="modal-body"><div className="session-turn-head"><p className="subtle session-history-note">{importedHistory.turns.length}개 발화 · 프로젝트 Git에 원문 JSONL이 저장되어 있습니다.</p><button className="button small" type="button" onClick={() => viewImportedRaw(importedHistory.conversation)}>원본 JSONL 보기</button></div>{importedHistory.turns.map((turn, index) => <article className="session-turn" key={index}><div className="session-turn-head"><span className="badge neutral">{turn.role === 'user' ? '사용자' : providerLabel(importedHistory.conversation.provider)}</span>{turn.timestamp && <span className="activity-time">{shortTime(turn.timestamp)}</span>}</div><div className="session-response">{turn.text}</div></article>)}</div></div></div>}
    {dialog === 'task' && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal" role="dialog" aria-modal="true" aria-label={editingTask ? '업무 편집' : '업무 만들기'}><div className="modal-header"><div><h2>{editingTask ? '업무 편집' : '새 업무'}</h2><p className="subtle">완료 기준과 모델별 역할을 명확히 지정합니다.</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><form className="modal-body form-stack" onSubmit={submitTask}>
      <div className="field"><label htmlFor="task-title">업무 제목</label><input id="task-title" required value={taskDraft.title} onChange={(event) => setTaskDraft((previous) => ({ ...previous, title: event.target.value }))} placeholder="예: 로그인 화면 구현" /></div>
      <div className="field"><label htmlFor="task-description">구체적인 지시</label><textarea id="task-description" required value={taskDraft.description} onChange={(event) => setTaskDraft((previous) => ({ ...previous, description: event.target.value }))} placeholder="필요한 기능, 범위, 제약을 적어 주세요." /></div>
      <div className="field"><label htmlFor="task-criteria">완료 기준</label><textarea id="task-criteria" value={criteriaDraft} onChange={(event) => setCriteriaDraft(event.target.value)} placeholder={'한 줄에 하나씩 입력\n예: 모든 입력 검증이 동작한다\n예: 테스트가 통과한다'} /><span>검수 모델이 각 항목을 확인합니다.</span></div>
      {!!project?.importedConversations?.length && <div className="field"><label>참고할 기존 대화 (최대 3개)</label><div className="dependency-list">{project.importedConversations.map((conversation) => <label className="dependency-item" key={conversation.id}><input type="checkbox" checked={taskDraft.sourceConversationIds?.includes(conversation.id) ?? false} onChange={(event) => setTaskDraft((previous) => ({ ...previous, sourceConversationIds: event.target.checked ? [...previous.sourceConversationIds ?? [], conversation.id] : (previous.sourceConversationIds ?? []).filter((id) => id !== conversation.id) }))} /><span>{providerLabel(conversation.provider)} · {conversation.title}</span></label>)}</div><span>선택한 대화의 시작과 최근 내용을 토론·실행·검수 요청마다 전달합니다. 전체 원문은 프로젝트 Git에 보관합니다.</span></div>}
      <div className="form-grid"><div className="field"><label htmlFor="assignment-mode">업무 분장</label><select id="assignment-mode" value={taskDraft.mode} onChange={(event) => setTaskDraft((previous) => ({ ...previous, mode: event.target.value as AssignmentMode }))}><option value="manual">직접 지정</option><option value="automatic">자동 배정</option></select></div><div className="field"><label htmlFor="task-rounds">토론 왕복 횟수</label><input id="task-rounds" type="number" min={1} max={8} value={taskDraft.debateRounds} onChange={(event) => setTaskDraft((previous) => ({ ...previous, debateRounds: Number(event.target.value) }))} /></div></div>
      <div className="form-grid"><div className="field"><label htmlFor="executor-provider">실행 모델</label><select id="executor-provider" value={taskDraft.executor.provider} onChange={(event) => changeModel('executor', 'provider', event.target.value)}><option value="codex">Codex</option><option value="claude">Claude</option></select><input aria-label="실행 세부 모델" value={taskDraft.executor.model} onChange={(event) => changeModel('executor', 'model', event.target.value)} placeholder="세부 모델 (비우면 CLI 기본값)" /></div><div className="field"><label htmlFor="reviewer-provider">검수 모델</label><select id="reviewer-provider" value={taskDraft.reviewer.provider} onChange={(event) => changeModel('reviewer', 'provider', event.target.value)}><option value="claude">Claude</option><option value="codex">Codex</option></select><input aria-label="검수 세부 모델" value={taskDraft.reviewer.model} onChange={(event) => changeModel('reviewer', 'model', event.target.value)} placeholder="세부 모델 (비우면 CLI 기본값)" /></div></div>
      {taskDraft.mode === 'automatic' && <div className="note">저장 후 앱이 업무 성격에 따라 실행·검수 모델을 배정합니다. 배정 결과는 다시 편집할 수 있습니다.</div>}
      {tasks.filter((task) => task.id !== editingTask?.id).length > 0 && <div className="field"><label>선행 업무</label><div className="dependency-list">{tasks.filter((task) => task.id !== editingTask?.id).map((task) => <label className="dependency-item" key={task.id}><input type="checkbox" checked={taskDraft.dependsOn.includes(task.id)} onChange={(event) => setTaskDraft((previous) => ({ ...previous, dependsOn: event.target.checked ? [...previous.dependsOn, task.id] : previous.dependsOn.filter((id) => id !== task.id) }))} /><span>{task.title}</span></label>)}</div></div>}
      <div className="form-actions"><button className="button" type="button" onClick={() => setDialog(null)}>취소</button><button className="button primary" type="submit" disabled={!!busy}>저장</button></div>
    </form></div></div>}
    {dialog === 'session-history' && sessionHistory && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal session-history-modal" role="dialog" aria-modal="true" aria-label="저장된 모델 대화"><div className="modal-header"><div><h2>{providerLabel(sessionHistory.session.provider)} 저장된 대화</h2><p className="subtle">{sessionHistory.session.sessionId}</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><div className="modal-body"><p className="subtle session-history-note">프로젝트 Git에 저장된 기록입니다. CLI나 데스크톱 앱 연결 없이 볼 수 있습니다.</p>{sessionHistory.turns.length ? sessionHistory.turns.map(({ event, prompt }) => <article className="session-turn" key={event.id}><div className="session-turn-head"><span className="badge neutral">{eventLabel[event.type]}</span><span className="activity-time">{shortTime(event.timestamp)}</span>{event.metadata?.transcript && <button className="button ghost small" type="button" onClick={() => openTranscript(event)}>CLI 원문</button>}</div>{prompt && <details className="session-prompt"><summary>모델에 전달한 요청</summary><pre>{prompt}</pre></details>}<div className="session-response">{event.message}</div></article>) : <Empty icon="◎" title="저장된 응답이 없습니다" detail="해당 세션의 작업 이력이 기록되면 이곳에 표시됩니다." />}</div></div></div>}
    {dialog === 'chat-message' && expandedChat && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal chat-response-modal" role="dialog" aria-modal="true" aria-label="채팅 답변 전체 보기"><div className="modal-header"><div><h2>{actorLabel(expandedChat.actor)} 답변 전체 보기</h2><p className="subtle">{shortTime(expandedChat.timestamp)} · {expandedChat.message.length.toLocaleString()}자</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><div className="modal-body"><div className="session-response">{expandedChat.message}</div></div></div></div>}
    {dialog === 'transcript' && transcriptView && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDialog(null)}><div className="modal transcript-modal" role="dialog" aria-modal="true" aria-label="CLI 원문 기록"><div className="modal-header"><div><h2>CLI 원문 기록</h2><p className="subtle">{transcriptView.path}</p></div><button className="close" aria-label="닫기" onClick={() => setDialog(null)}>×</button></div><div className="modal-body"><pre className="transcript-content">{transcriptView.content}</pre></div></div></div>}
  </div>;
}
