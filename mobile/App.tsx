import { useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadConnection, request, saveConnection, watchEvents, type Catalog, type Connection, type ConversationCandidate, type Event, type Operation, type Project, type Provider, type Snapshot, type Target, type Task } from './api';
import { finalResults } from './results';
import { MarkdownText } from './MarkdownText';
import { consensusLabel, parseDebateSummary } from '../src/shared/debate-summary';

const color = { dark: '#111c35', blue: '#5266e9', ink: '#172644', muted: '#7785a0', line: '#dfe5f0', white: '#fff' };
type Tab = 'chat' | 'overview' | 'tasks' | 'debate' | 'history';
const tabs: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'chat', label: '채팅' }, { id: 'overview', label: '개요' }, { id: 'tasks', label: '업무' },
  { id: 'debate', label: '논쟁' }, { id: 'history', label: '전체 이력' },
];
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const date = (value: string): string => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function Button({ label, onPress, active = false, disabled = false }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.button, active && s.activeButton, disabled && { opacity: 0.5 }]}><Text style={[s.buttonText, active && { color: color.white }]}>{label}</Text></Pressable>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.panel}><Text style={s.title}>{title}</Text>{children}</View>;
}

export default function App() {
  const historyRef = useRef<ScrollView>(null);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [address, setAddress] = useState('');
  const [secret, setSecret] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [tab, setTab] = useState<Tab>('chat');
  const [chatView, setChatView] = useState<'all' | Provider>('all');
  const [projectPicker, setProjectPicker] = useState(false);
  const [projectCreator, setProjectCreator] = useState(false);
  const [projectDeleter, setProjectDeleter] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [projectBasePath, setProjectBasePath] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectGoal, setProjectGoal] = useState('');
  const [projectFolder, setProjectFolder] = useState('');
  const [projectRounds, setProjectRounds] = useState('2');
  const [conversations, setConversations] = useState<ConversationCandidate[]>([]);
  const [initialConversation, setInitialConversation] = useState<ConversationCandidate | null>(null);
  const [conversationQuery, setConversationQuery] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [modelPicker, setModelPicker] = useState(false);
  const [composerOpen, setComposerOpen] = useState(true);
  const [taskEditor, setTaskEditor] = useState<'plan' | 'manual' | null>(null);
  const [historyLimit, setHistoryLimit] = useState(30);
  const [expandedMessages, setExpandedMessages] = useState<string[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [summaryEventId, setSummaryEventId] = useState('');
  const [summaryDraft, setSummaryDraft] = useState('');
  const [target, setTarget] = useState<Target>('both');
  const [message, setMessage] = useState('');
  const [discussion, setDiscussion] = useState(false);
  const [discussionRounds, setDiscussionRounds] = useState<number | null>(null);
  const [chatFiles, setChatFiles] = useState<{ name: string; data: string; size: number }[]>([]);
  const [models, setModels] = useState<Record<Provider, { model: string; effort: string }>>({ codex: { model: '', effort: '' }, claude: { model: '', effort: '' } });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [executor, setExecutor] = useState<Provider>('codex');
  const [plan, setPlan] = useState('');
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [operations, setOperations] = useState<Operation[]>([]);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const projectId = snapshot?.project.id;

  const refresh = async (current: Connection, id?: string): Promise<void> => {
    const [{ projects: found }, { operations: running }] = await Promise.all([
      request<{ projects: Project[] }>(current, '/projects'),
      request<{ operations: typeof operations }>(current, '/operations'),
    ]);
    setProjects(found);
    setOperations(running);
    const selected = id ?? found[0]?.id;
    if (selected) setSnapshot(await request<Snapshot>(current, `/projects/${selected}`));
    else setSnapshot(null);
  };
  useEffect(() => { void loadConnection().then((saved) => { if (saved) { setConnection(saved); setAddress(saved.url); setSecret(saved.token); } }); }, []);
  useEffect(() => {
    if (!connection) return;
    let active = true;
    const poll = (): void => { void refresh(connection, projectId).catch((error: unknown) => { if (active) setNotice(errorText(error)); }); };
    poll();
    const timer = setInterval(poll, 15_000);
    return () => { active = false; clearInterval(timer); };
  }, [connection, projectId]);
  useEffect(() => {
    if (!connection) return;
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connectStream = (): void => {
      void watchEvents(connection, () => { void refresh(connection, projectId).catch(() => undefined); }, controller.signal, () => setLive(true))
        .catch(() => undefined)
        .finally(() => { setLive(false); if (!controller.signal.aborted) retry = setTimeout(connectStream, 2_000); });
    };
    connectStream();
    return () => { controller.abort(); if (retry) clearTimeout(retry); setLive(false); };
  }, [connection, projectId]);
  useEffect(() => { if (connection) void request<{ catalogs: Catalog[] }>(connection, '/models').then(({ catalogs: found }) => setCatalogs(found)).catch(() => undefined); }, [connection]);
  useEffect(() => { if (connection) void request<{ basePath: string }>(connection, '/project-defaults').then(({ basePath }) => setProjectBasePath(basePath)).catch(() => undefined); }, [connection]);
  useEffect(() => { if (connection && projectCreator) void request<{ conversations: ConversationCandidate[] }>(connection, '/conversations').then(({ conversations: found }) => setConversations(found)).catch(() => undefined); }, [connection, projectCreator]);
  const act = async (work: () => Promise<unknown>, success: string): Promise<void> => {
    setBusy(true); setNotice('');
    try { await work(); setNotice(success); if (connection) await refresh(connection, projectId); }
    catch (error) { setNotice(errorText(error)); }
    finally { setBusy(false); }
  };
  const connect = (): void => { void act(async () => {
    const next = { url: address.trim().replace(/\/$/u, ''), token: secret.trim() };
    if (!/^http:\/\/100\.\d{1,3}\.\d{1,3}\.\d{1,3}:48721$/u.test(next.url)) throw new Error('데스크톱에 표시된 Tailscale 주소를 입력하세요.');
    await request(next, '/health'); await saveConnection(next); setConnection(next);
  }, '연결되었습니다.'); };
  const command = (route: string, body: unknown, success: string): void => {
    if (!connection) return;
    void act(() => request(connection, route, body), success);
  };
  const pickChatFiles = (): void => {
    void DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, base64: Platform.OS === 'web' })
      .then(async (selection) => {
        if (selection.canceled) return;
        if (chatFiles.length + selection.assets.length > 5) throw new Error('첨부 파일은 최대 5개입니다.');
        const files = await Promise.all(selection.assets.map(async (asset) => {
          if ((asset.size ?? 0) > 25 * 1024 * 1024) throw new Error('첨부 파일은 각각 25MB 이하여야 합니다.');
          const data = asset.base64 ?? await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
          return { name: asset.name, data, size: asset.size ?? Math.floor(data.length * 3 / 4) };
        }));
        if ([...chatFiles, ...files].reduce((total, file) => total + file.size, 0) > 50 * 1024 * 1024) throw new Error('첨부 파일 전체 크기는 50MB 이하여야 합니다.');
        setChatFiles((current) => [...current, ...files]);
      }).catch((error: unknown) => setNotice(errorText(error)));
  };
  const sendChat = (): void => {
    if (!connection || !projectId) return;
    const content = message;
    const files = chatFiles.map(({ name, data }) => ({ name, data }));
    void act(async () => {
      await request(connection, `/projects/${projectId}/chat`, { message: content, target, models, files, discussion: target === 'both' && discussion,
        discussionRounds: target === 'both' && discussion ? discussionRounds ?? snapshot?.project.defaultDebateRounds ?? 2 : undefined });
      setMessage(''); setChatFiles([]);
    }, '지시를 전달했습니다. 답변은 자동으로 갱신됩니다.');
  };
  const runTask = (task: Task, action: 'debate' | 'execute' | 'cancel'): void => {
    if (!projectId) return;
    const send = (): void => command(`/projects/${projectId}/tasks/${task.id}/${action}`, {}, `${task.title}: 요청을 보냈습니다.`);
    if (action === 'execute') Alert.alert('업무 실행', `${task.title} 업무를 데스크톱에서 실행할까요?`, [{ text: '취소' }, { text: '실행', onPress: send }]);
    else send();
  };
  const activity = (provider: Provider): string => {
    const events = snapshot?.events ?? [];
    const latestRequest = [...events].reverse().find((event) => event.actor === 'user' && event.type === 'chat'
      && (event.metadata?.target === provider || event.metadata?.target === 'both'));
    const completion = latestRequest && events.find((event) => event.metadata?.replyTo === latestRequest.id
      && (event.actor === provider || event.type === 'error' && event.metadata?.provider === provider));
    if (completion?.type === 'error') return `최근 요청 실패: ${completion.message.slice(0, 120)}`;
    const running = operations.filter((operation) => operation.state === 'running' && operation.projectId === projectId);
    const current = running.find((operation) => {
      if (operation.kind === 'chat' || operation.kind === 'chat-task') return operation.target === provider || operation.target === 'both';
      if (!operation.taskId) return false;
      const task = snapshot?.tasks.find((item) => item.id === operation.taskId);
      if (operation.kind === 'debate' || operation.kind === 'continue') return task?.executor.provider === provider || task?.reviewer.provider === provider;
      return task?.status === 'reviewing' ? task.reviewer.provider === provider : task?.executor.provider === provider;
    });
    const latest = [...(snapshot?.events ?? [])].reverse().find((event) => event.actor === provider);
    const title = snapshot?.tasks.find((task) => task.id === current?.taskId)?.title;
    return current ? `${title ? `${title} · ` : ''}${current.kind === 'chat' ? '답변 작성 중' : current.kind === 'chat-task' ? '업무 토론·실행 중' : current.kind === 'debate' || current.kind === 'continue' ? '토론 중' : current.kind === 'execute' ? snapshot?.tasks.find((task) => task.id === current.taskId)?.status === 'reviewing' ? '교차 검수 중' : '구현 중' : '작업 중'}`
      : latest ? `최근 작업: ${latest.message.slice(0, 90)}` : '대기 중';
  };
  const timeline = (snapshot?.events ?? []).filter((event) => event.actor === 'codex' || event.actor === 'claude'
    || event.actor === 'user' && event.type === 'chat' || event.type === 'error');
  const filtered = timeline.filter((event) => chatView === 'all' || event.actor === chatView
    || event.actor === 'user' && (event.metadata?.target === chatView || event.metadata?.target === 'both')
    || event.type === 'error' && event.metadata?.provider === chatView);
  const visible = filtered.slice(-historyLimit);
  const debateEvents = (snapshot?.events ?? []).filter((event) => ['proposal', 'critique', 'response', 'evaluation', 'decision'].includes(event.type)
    || !!event.metadata?.discussionRound || !!event.metadata?.discussionConclusion);
  const conclusions = finalResults(snapshot?.events ?? [], snapshot?.tasks ?? [], snapshot?.project.createdAt);
  const selectedConclusion = conclusions.find((event) => event.id === summaryEventId) ?? conclusions.at(-1);
  const debateSummary = selectedConclusion ? parseDebateSummary(selectedConclusion.message) : null;
  const summaryTitle = (event: Event): string => event.taskId
    ? snapshot?.tasks.find((task) => task.id === event.taskId)?.title ?? '업무 논쟁'
    : `프로젝트 토론 · ${(snapshot?.events.find((request) => request.id === event.metadata?.replyTo)?.message ?? '').slice(0, 80) || date(event.timestamp)}`;
  const directSummaryIssue = (issue: string): void => setSummaryDraft(`다음 이견을 다시 검토하고 두 모델의 근거를 비교해 결론을 수정해 주세요:\n${issue}`);
  const sendSummaryInstruction = (): void => {
    if (!connection || !projectId || !summaryDraft.trim()) return;
    const instruction = summaryDraft.trim();
    const route = selectedConclusion?.taskId
      ? `/projects/${projectId}/tasks/${selectedConclusion.taskId}/continue` : `/projects/${projectId}/chat`;
    const body = selectedConclusion?.taskId
      ? { message: instruction, target: 'both', additionalRounds: 1 }
      : { message: instruction, target: 'both', models, discussion: true };
    void act(async () => { await request(connection, route, body); setSummaryDraft(''); }, '추가 논쟁을 요청했습니다.');
  };
  const historyEvents = (snapshot?.events ?? []).filter((event) => !historyQuery.trim()
    || `${event.message} ${event.actor} ${event.type}`.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
  const eventCard = (event: Event): React.ReactNode => {
    const expanded = expandedMessages.includes(event.id);
    const limit = expanded ? event.message.length : 280;
    const clipped = event.message.length > limit;
    return <View key={event.id} style={[s.bubble, event.actor === 'user' && s.userBubble, event.type === 'error' && s.errorBubble]}>
      <View style={s.bubbleHead}><Text style={s.bubbleActor}>{event.type === 'error' ? '오류' : event.actor === 'user' ? '나' : event.actor === 'codex' ? 'Codex' : event.actor === 'claude' ? 'Claude' : '시스템'}{event.type !== 'chat' ? ` · ${event.type}` : ''}</Text><Text style={s.meta}>{date(event.timestamp)}</Text></View>
      <View style={!expanded && clipped ? { maxHeight: 180, overflow: 'hidden' } : undefined}><MarkdownText text={event.message} /></View>{clipped && <Text style={s.hint}>일부 미리보기 · 펼치면 전체 원문</Text>}
      {event.type === 'decision' && <Text style={s.label}>{consensusLabel(event.metadata)}</Text>}
      <View style={s.row}>{event.message.length > 280 && <Pressable onPress={() => setExpandedMessages((old) => expanded ? old.filter((id) => id !== event.id) : [...old, event.id])}><Text style={s.expand}>{expanded ? '접기' : '펼치기'}</Text></Pressable>}
        <Pressable onPress={() => setSelectedEvent(event)}><Text style={s.expand}>이 기록 크게 보기 ↗</Text></Pressable></View>
    </View>;
  };
  useEffect(() => { historyRef.current?.scrollToEnd({ animated: true }); }, [visible.at(-1)?.id, chatView]);
  const modelControl = (provider: Provider): React.ReactNode => {
    const catalog = catalogs.find((item) => item.provider === provider);
    const choice = catalog?.models.find((item) => item.id === models[provider].model);
    return <View key={provider} style={s.selector}><Text style={s.label}>{provider === 'codex' ? 'Codex' : 'Claude'} 모델</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.horizontal}>
        <Button label="기본 모델" active={!models[provider].model} onPress={() => setModels((old) => ({ ...old, [provider]: { model: '', effort: '' } }))} />
        {catalog?.models.map((model) => <Button key={model.id} label={model.label} active={models[provider].model === model.id}
          onPress={() => setModels((old) => ({ ...old, [provider]: { model: model.id, effort: '' } }))} />)}
      </ScrollView>
      {choice && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.horizontal}>
        <Button label="기본 추론" active={!models[provider].effort} onPress={() => setModels((old) => ({ ...old, [provider]: { ...old[provider], effort: '' } }))} />
        {choice.efforts.map((effort) => <Button key={effort} label={effort} active={models[provider].effort === effort}
          onPress={() => setModels((old) => ({ ...old, [provider]: { ...old[provider], effort } }))} />)}
      </ScrollView>}</View>;
  };
  const createProject = (): void => {
    if (!connection || !projectName.trim() || !projectGoal.trim()) return;
    const rounds = Number(projectRounds);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 8) { setNotice('토론 왕복 횟수는 1~8회로 입력하세요.'); return; }
    setBusy(true); setNotice('');
    void request<Snapshot>(connection, '/projects', { name: projectName.trim(), goal: projectGoal.trim(),
      ...(projectFolder.trim() ? { path: projectFolder.trim() } : {}), defaultDebateRounds: rounds,
      ...(initialConversation ? { initialConversation: { provider: initialConversation.provider, filePath: initialConversation.filePath } } : {}) })
      .then(async (created) => {
        await refresh(connection, created.project.id);
        setSnapshot(created);
        setProjectCreator(false);
        setProjectName(''); setProjectGoal(''); setProjectFolder(''); setProjectRounds('2'); setInitialConversation(null);
        setTab('chat');
        setNotice('프로젝트를 만들었습니다. 산출물과 Git 기록은 PC 폴더에 저장됩니다.');
      }).catch((error: unknown) => setNotice(errorText(error))).finally(() => setBusy(false));
  };
  const requestChatTask = (): void => {
    if (!connection || !projectId || !message.trim() || target === 'both') return;
    const content = message.trim();
    const files = chatFiles.map(({ name, data }) => ({ name, data }));
    void act(async () => {
      await request(connection, `/projects/${projectId}/chat-task`, { message: content, target, models, files });
      setMessage(''); setChatFiles([]); setTab('tasks');
    }, `${target === 'codex' ? 'Codex' : 'Claude'} 업무를 시작했습니다. 완료 후 상대 모델이 검수합니다.`);
  };
  const deleteProject = (mode: 'unregister' | 'trash'): void => {
    if (!connection || !projectId || !snapshot || deleteConfirmation !== snapshot.project.name) return;
    setBusy(true); setNotice('');
    void request(connection, `/projects/${projectId}/delete`, { confirmation: deleteConfirmation, mode })
      .then(async () => { setProjectDeleter(false); setDeleteConfirmation(''); setSnapshot(null); await refresh(connection); setNotice(mode === 'trash' ? '프로젝트 폴더를 PC 휴지통으로 옮겼습니다.' : '앱 목록에서 제거했습니다. PC 폴더는 그대로 있습니다.'); })
      .catch((error: unknown) => setNotice(errorText(error))).finally(() => setBusy(false));
  };
  return <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <StatusBar barStyle="light-content" />
    <View style={s.header}><Text style={s.brand}>LLM Collaboration</Text>
      {connection ? <Pressable onPress={() => setProjectPicker(true)} style={s.projectSwitch}>
        <Text numberOfLines={1} style={s.projectName}>{snapshot?.project.name ?? '프로젝트 선택'} ▾</Text>
        <Text style={s.connection}>{live ? '● 연결됨' : '○ 재연결 중'}</Text>
      </Pressable> : <Text style={s.subtitle}>iPhone 원격 연결</Text>}</View>
    {!connection ? <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Panel title="데스크톱 연결">
      <Text style={s.hint}>PC와 iPhone을 같은 Tailscale 네트워크에 연결한 뒤 PC 앱에서 모바일 연결을 켜세요.</Text>
      <TextInput style={s.input} placeholder="http://100.x.y.z:48721" autoCapitalize="none" value={address} onChangeText={setAddress} />
      <TextInput style={s.input} placeholder="연결 코드" autoCapitalize="none" secureTextEntry value={secret} onChangeText={setSecret} />
      <Button label="연결하기" active disabled={busy || !address || !secret} onPress={connect} /></Panel>
      {notice ? <Text style={s.notice}>{notice}</Text> : null}</ScrollView> : <>
      <View style={s.tabBar}><ScrollView horizontal style={s.tabScroller} showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabChoices}>
        {tabs.map((item) => <Pressable key={item.id} onPress={() => setTab(item.id)} style={[s.tab, tab === item.id && s.tabActive]}>
          <Text style={[s.tabText, tab === item.id && s.tabTextActive]}>{item.label}{item.id === 'tasks' ? ` ${snapshot?.tasks.length ?? 0}` : ''}</Text></Pressable>)}
      </ScrollView><Pressable style={s.refresh} accessibilityLabel="새로고침" onPress={() => { void act(() => refresh(connection, projectId), '갱신했습니다.'); }}><Text style={s.refreshText}>↻</Text></Pressable></View>
      {notice ? <Text style={s.inlineNotice} numberOfLines={2}>{notice}</Text> : null}
      {operations.filter((item) => item.projectId === projectId && item.state === 'error').slice(-1).map((item) => <Text key={item.id} style={s.operationError}>{item.error ?? '작업에 실패했습니다.'}</Text>)}
      {!snapshot && <View style={s.empty}><Text style={s.emptyTitle}>프로젝트가 없습니다</Text><Text style={s.hint}>PC 폴더에 기록을 저장할 협업 프로젝트를 만드세요.</Text><Button label="＋ 새 프로젝트" active onPress={() => setProjectCreator(true)} /></View>}
      {snapshot && <View style={s.statusStrip}>{(['codex', 'claude'] as Provider[]).map((provider) => <Pressable key={provider} style={s.statusItem} onPress={() => { setChatView(provider); setTab('chat'); }}>
          <Text style={s.statusName}>{provider === 'codex' ? 'Codex' : 'Claude'}</Text><Text numberOfLines={1} style={s.statusText}>{activity(provider)}</Text>
        </Pressable>)}</View>}
      {snapshot && (tab === 'chat' ? <>
        <View style={s.filterBar}>{(['all', 'codex', 'claude'] as const).map((item) => <Pressable key={item} style={[s.filter, chatView === item && s.filterActive]} onPress={() => { setChatView(item); setHistoryLimit(30); }}>
          <Text style={[s.filterText, chatView === item && s.filterTextActive]}>{item === 'all' ? '전체 대화' : item === 'codex' ? 'Codex' : 'Claude'}</Text></Pressable>)}</View>
        <ScrollView ref={historyRef} style={s.history} contentContainerStyle={s.historyContent} keyboardShouldPersistTaps="handled">
          {filtered.length > visible.length && <Button label="이전 대화 더 보기" onPress={() => setHistoryLimit((current) => current + 30)} />}
          {!visible.length && <View style={s.empty}><Text style={s.emptyTitle}>아직 대화가 없습니다</Text><Text style={s.hint}>아래에서 지시를 보내세요.</Text></View>}
          {conclusions.map((event) => <View key={`result-${event.id}`}><Text style={s.title}>최종 토론 결과 · {summaryTitle(event)}</Text>{eventCard(event)}</View>)}
          {visible.filter((event) => !conclusions.some((result) => result.id === event.id)).map(eventCard)}
          {operations.some((item) => item.state === 'running' && item.projectId === projectId) && <Text style={s.working}>● 응답 또는 작업 진행 중…</Text>}
        </ScrollView>
      </> : <ScrollView style={s.history} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        {tab === 'overview' && <>
          <Panel title="프로젝트 개요"><Text style={s.body}>{snapshot?.project.goal}</Text><Text style={s.hint}>PC 폴더: {snapshot?.project.path}</Text><Text style={s.hint}>기본 토론 {snapshot?.project.defaultDebateRounds ?? 2}회 왕복</Text></Panel>
          <View style={s.row}><Button label="＋ 새 업무" active onPress={() => { setTaskEditor('manual'); setTab('tasks'); }} /><Button label="이력 검색" onPress={() => setTab('history')} /><Button label="프로젝트 삭제" onPress={() => setProjectDeleter(true)} /></View>
          <View style={s.stats}><View style={s.stat}><Text style={s.statNumber}>{snapshot?.tasks.length ?? 0}</Text><Text style={s.hint}>전체 업무</Text></View><View style={s.stat}><Text style={s.statNumber}>{snapshot?.tasks.filter((task) => ['debating', 'executing', 'reviewing'].includes(task.status)).length ?? 0}</Text><Text style={s.hint}>진행 중</Text></View></View>
          {snapshot?.project.charter && <Panel title="프로젝트 헌장"><MarkdownText text={snapshot.project.charter} /></Panel>}
          <Panel title="최근 활동">{(snapshot?.events ?? []).slice(-5).reverse().map(eventCard)}</Panel>
        </>}
        {tab === 'tasks' && <>
        <View style={s.row}><Button label="＋ 직접 업무" active onPress={() => setTaskEditor(taskEditor === 'manual' ? null : 'manual')} /><Button label="자동 계획" onPress={() => setTaskEditor(taskEditor === 'plan' ? null : 'plan')} /></View>
        {taskEditor === 'plan' && <Panel title="업무 자동 계획"><TextInput style={[s.input, s.multiline]} multiline placeholder="목표와 완료 기준" value={plan} onChangeText={setPlan} /><Button label="계획 요청" active disabled={busy || !plan.trim()} onPress={() => { command(`/projects/${projectId}/plan`, { request: plan }, '계획을 요청했습니다.'); setPlan(''); setTaskEditor(null); }} /></Panel>}
        {taskEditor === 'manual' && <Panel title="직접 업무 지정"><TextInput style={s.input} placeholder="업무 제목" value={taskTitle} onChangeText={setTaskTitle} /><TextInput style={[s.input, s.multiline]} multiline placeholder="설명과 완료 기준" value={taskDescription} onChangeText={setTaskDescription} /><Text style={s.label}>실행 담당</Text><View style={s.row}>{(['codex', 'claude'] as Provider[]).map((provider) => <Button key={provider} label={provider} active={executor === provider} onPress={() => setExecutor(provider)} />)}</View><Button label="업무 추가" active disabled={busy || !taskTitle.trim() || !taskDescription.trim()} onPress={() => { command(`/projects/${projectId}/tasks`, { title: taskTitle, description: taskDescription, acceptanceCriteria: [taskDescription], mode: 'manual', executor: { provider: executor, model: 'default' }, reviewer: { provider: executor === 'codex' ? 'claude' : 'codex', model: 'default' }, dependsOn: [], debateRounds: snapshot!.project.defaultDebateRounds }, '업무를 추가했습니다.'); setTaskTitle(''); setTaskDescription(''); setTaskEditor(null); }} /></Panel>}
        {!snapshot?.tasks.length && <View style={s.empty}><Text style={s.emptyTitle}>등록된 업무가 없습니다</Text><Text style={s.hint}>위에서 업무를 추가하거나 자동 계획을 요청하세요.</Text></View>}
        {snapshot?.tasks.map((task) => <View key={task.id} style={s.taskCard}><Text style={s.taskTitle}>{task.title}</Text><Text style={s.taskMeta}>{task.status} · {task.executor.provider} 실행 · {task.reviewer.provider} 검수</Text><MarkdownText text={task.description} /><View style={s.row}><Button label="토론" onPress={() => runTask(task, 'debate')} /><Button label="실행" active onPress={() => runTask(task, 'execute')} /><Button label="중단" onPress={() => runTask(task, 'cancel')} /></View><TextInput style={s.input} placeholder="추가 반론이나 작업 수정" value={followUps[task.id] ?? ''} onChangeText={(value) => setFollowUps((old) => ({ ...old, [task.id]: value }))} /><Button label="추가 토론 · 1회 왕복" disabled={!(followUps[task.id] ?? '').trim()} onPress={() => { command(`/projects/${projectId}/tasks/${task.id}/continue`, { message: followUps[task.id], target: 'both', additionalRounds: 1 }, '추가 토론을 요청했습니다.'); setFollowUps((old) => ({ ...old, [task.id]: '' })); }} /></View>)}
        </>}
        {tab === 'debate' && <><Text style={s.title}>모델 논쟁</Text><Text style={s.hint}>두 모델의 제안·반론·평가·결론을 순서대로 봅니다.</Text>
          <Panel title="논쟁 요약">
            <Text style={s.hint}>최종 결론에 명시된 합의점과 이견만 표시합니다.</Text>
            {conclusions.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.horizontal}>{[...conclusions].reverse().map((event) => <Button key={event.id} label={summaryTitle(event)} active={event.id === selectedConclusion?.id} onPress={() => { setSummaryEventId(event.id); setSummaryDraft(''); }} />)}</ScrollView>}
            {selectedConclusion ? <>
              <Text style={s.label}>{consensusLabel(selectedConclusion.metadata)}</Text>
              {([
                { key: 'agreements' as const, title: '서로 동의한 점', empty: '구분된 합의 기록이 없습니다.' },
                { key: 'disagreements' as const, title: '남은 이견', empty: '구분된 이견 기록이 없습니다.' },
                { key: 'nextSteps' as const, title: '다음 지시·검증', empty: '구분된 후속 조치가 없습니다.' },
              ]).map(({ key, title, empty }) => <View key={key} style={[s.summaryGroup, key === 'agreements' ? s.summaryAgreement : key === 'disagreements' ? s.summaryDisagreement : s.summaryNext]}>
                <Text style={s.label}>{title}</Text>{debateSummary?.[key].length ? debateSummary[key].map((item, index) => <View key={`${key}-${index}`} style={s.summaryItem}><MarkdownText text={item} />{key === 'disagreements' && item !== '없음' && <Button label="이 쟁점 지시하기" onPress={() => directSummaryIssue(item)} />}</View>) : <Text style={s.hint}>{empty}</Text>}
              </View>)}
              <Button label="결론 원문 보기" onPress={() => setSelectedEvent(selectedConclusion)} />
              {summaryDraft && <View style={s.summaryInstruction}><Text style={s.label}>추가 논쟁 지시</Text><TextInput style={[s.input, s.multiline]} multiline value={summaryDraft} onChangeText={setSummaryDraft} /><Button label="지시 보내기" active disabled={busy || !summaryDraft.trim()} onPress={sendSummaryInstruction} /></View>}
            </> : <Text style={s.hint}>결론이 작성되면 합의점과 남은 이견이 여기에 표시됩니다.</Text>}
          </Panel>
          {debateEvents.length ? debateEvents.map(eventCard) : <View style={s.empty}><Text style={s.emptyTitle}>논쟁 기록이 없습니다</Text><Text style={s.hint}>두 모델을 선택하고 토론을 켜서 지시를 보내세요.</Text></View>}</>}
        {tab === 'history' && <><Text style={s.title}>전체 이력</Text><TextInput style={s.input} placeholder="내용, 모델, 업무 기록 검색" value={historyQuery} onChangeText={setHistoryQuery} />
          <Text style={s.hint}>{historyEvents.length}개 기록</Text>{historyEvents.slice(-historyLimit).reverse().map(eventCard)}
          {historyEvents.length > historyLimit && <Button label="이전 기록 더 보기" onPress={() => setHistoryLimit((current) => current + 30)} />}
        </>}
      </ScrollView>)}
    </>}
    {snapshot && <View style={s.composer}>
          <Pressable accessibilityRole="button" onPress={() => setComposerOpen((current) => !current)} style={s.composerToggle}><Text style={s.composerToggleText}>{composerOpen ? '대화 입력 접기 ▾' : '대화 입력 열기 ▴'}{!composerOpen && message.trim() ? ' · 작성 중' : ''}</Text></Pressable>
          {composerOpen && <>
          <View style={s.composerTop}><View style={s.targets}>{(['both', 'codex', 'claude'] as Target[]).map((item) => <Pressable key={item} onPress={() => setTarget(item)} style={[s.target, target === item && s.targetActive]}>
            <Text style={[s.targetText, target === item && s.targetTextActive]}>{item === 'both' ? '둘 다' : item === 'codex' ? 'Codex' : 'Claude'}</Text></Pressable>)}</View>
            <Pressable onPress={() => setModelPicker(true)}><Text style={s.settings}>모델·토론 ⚙</Text></Pressable></View>
          <Text numberOfLines={1} style={s.composerSummary}>{target === 'both' ? `Codex ${models.codex.model || '기본'} · Claude ${models.claude.model || '기본'}` : `${target === 'codex' ? 'Codex' : 'Claude'} ${models[target].model || '기본'}`}{target === 'both' && discussion ? discussionRounds === -1 ? ' · 끝장 토론' : ` · 토론 ${discussionRounds ?? snapshot?.project.defaultDebateRounds ?? 2}회` : ''}</Text>
          {chatFiles.length > 0 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.horizontal}>{chatFiles.map((file, index) => <Pressable key={`${file.name}-${index}`} style={s.fileChip} onPress={() => setChatFiles((old) => old.filter((_, position) => position !== index))}><Text numberOfLines={1}>📎 {file.name} ×</Text></Pressable>)}</ScrollView>}
          <View style={s.composerInput}><Pressable style={s.attach} accessibilityLabel="파일 첨부" disabled={busy || chatFiles.length >= 5} onPress={pickChatFiles}><Text style={s.attachText}>＋</Text></Pressable>
            <TextInput style={s.chatInput} multiline placeholder="지시하거나 질문하세요" value={message} onChangeText={setMessage} />
            <Pressable style={[s.send, (busy || (!message.trim() && !chatFiles.length)) && s.sendDisabled]} accessibilityLabel="메시지 보내기" disabled={busy || (!message.trim() && !chatFiles.length)} onPress={sendChat}><Text style={s.sendText}>➤</Text></Pressable></View>
          {target !== 'both' && <Button label="선택한 모델에 업무 요청" disabled={busy || !message.trim()} onPress={requestChatTask} />}
          {operations.some((item) => item.state === 'running' && item.projectId === projectId) && <Pressable onPress={() => command(`/projects/${projectId}/cancel-chat`, {}, '중단을 요청했습니다.')}><Text style={s.cancel}>응답 중단</Text></Pressable>}
          </>}
        </View>}
    <Modal visible={projectPicker} animationType="slide" transparent onRequestClose={() => setProjectPicker(false)}><View style={s.modalBackdrop}><View style={s.modalSheet}><View style={s.modalHead}><Text style={s.title}>프로젝트 선택</Text><Pressable onPress={() => setProjectPicker(false)}><Text style={s.close}>닫기</Text></Pressable></View><ScrollView style={s.modalList}>{projects.map((project) => <Pressable key={project.id} style={s.projectOption} onPress={() => { setProjectPicker(false); setHistoryLimit(30); void request<Snapshot>(connection!, `/projects/${project.id}`).then((selected) => { setSnapshot(selected); setNotice(''); }).catch((error: unknown) => setNotice(errorText(error))); }}><Text style={s.projectOptionText}>{project.name}</Text>{project.id === projectId && <Text style={s.check}>✓</Text>}</Pressable>)}</ScrollView><View style={s.row}><Button label="＋ 새 프로젝트" active onPress={() => { setProjectPicker(false); setProjectCreator(true); }} /><Button label="연결 해제" onPress={() => { setProjectPicker(false); void saveConnection(null).then(() => { setConnection(null); setSnapshot(null); }); }} /></View></View></View></Modal>
    <Modal visible={projectCreator} animationType="slide" transparent onRequestClose={() => setProjectCreator(false)}><View style={s.modalBackdrop}><View style={s.modalSheet}><View style={s.modalHead}><Text style={s.title}>새 프로젝트</Text><Pressable onPress={() => setProjectCreator(false)}><Text style={s.close}>닫기</Text></Pressable></View><ScrollView style={s.modalList} contentContainerStyle={s.modalContent} keyboardShouldPersistTaps="handled">
      <Text style={s.hint}>모든 산출물과 Git 기록을 PC 폴더에 저장합니다.</Text>
      <Text style={s.label}>프로젝트 이름</Text><TextInput style={s.input} placeholder="예: 새 서비스 개발" value={projectName} onChangeText={setProjectName} />
      <Text style={s.label}>프로젝트 목표</Text><TextInput style={[s.input, s.multiline]} multiline placeholder="달성할 결과를 적어 주세요" value={projectGoal} onChangeText={setProjectGoal} />
      <Text style={s.label}>PC 프로젝트 폴더 · 선택 사항</Text><TextInput style={s.input} placeholder="비워두면 PC 기본 폴더에 생성" value={projectFolder} onChangeText={setProjectFolder} autoCapitalize="none" />
      <Text style={s.hint}>기본 위치: {projectBasePath || 'PC의 Documents/LLM Collaboration'} · 다른 위치를 쓰려면 PC 절대 경로를 입력하세요.</Text>
      <Text style={s.label}>기본 토론 왕복 횟수</Text><TextInput style={s.input} keyboardType="number-pad" value={projectRounds} onChangeText={setProjectRounds} />
      <Text style={s.label}>기존 Codex·Claude 채팅에서 시작 · 선택 사항</Text>
      <TextInput style={s.input} placeholder="채팅 제목 검색" value={conversationQuery} onChangeText={setConversationQuery} />
      {initialConversation && <Button label={`선택됨: ${initialConversation.title} ×`} onPress={() => setInitialConversation(null)} />}
      {conversations.filter((candidate) => !conversationQuery.trim() || candidate.title.toLocaleLowerCase().includes(conversationQuery.toLocaleLowerCase())).slice(0, 20).map((candidate) => <Pressable key={`${candidate.provider}-${candidate.sessionId}`} style={[s.projectOption, initialConversation?.filePath === candidate.filePath && s.candidateSelected]} onPress={() => setInitialConversation(candidate)}><View style={s.candidateText}><Text numberOfLines={1} style={s.projectOptionText}>{candidate.provider === 'codex' ? 'Codex' : 'Claude'} · {candidate.title}</Text><Text style={s.hint}>{candidate.turnCount}개 발화 · {date(candidate.updatedAt)}</Text></View>{initialConversation?.filePath === candidate.filePath && <Text style={s.check}>✓</Text>}</Pressable>)}
      {notice ? <Text style={s.notice}>{notice}</Text> : null}
      <Button label={busy ? '프로젝트 생성 중…' : '프로젝트 만들기'} active disabled={busy || !projectName.trim() || !projectGoal.trim()} onPress={createProject} />
    </ScrollView></View></View></Modal>
    <Modal visible={projectDeleter} animationType="slide" transparent onRequestClose={() => setProjectDeleter(false)}><View style={s.modalBackdrop}><View style={s.modalSheet}><View style={s.modalHead}><Text style={s.title}>프로젝트 삭제</Text><Pressable onPress={() => setProjectDeleter(false)}><Text style={s.close}>닫기</Text></Pressable></View><Text style={s.hint}>{snapshot?.project.name} · {snapshot?.project.path}</Text><Text style={s.label}>확인하려면 프로젝트 이름을 그대로 입력하세요</Text><TextInput style={s.input} value={deleteConfirmation} onChangeText={setDeleteConfirmation} autoCapitalize="none" /><View style={s.row}><Button label="앱 목록에서만 제거" disabled={busy || deleteConfirmation !== snapshot?.project.name} onPress={() => deleteProject('unregister')} /><Button label="폴더도 휴지통으로 이동" disabled={busy || deleteConfirmation !== snapshot?.project.name} onPress={() => deleteProject('trash')} /></View><Text style={s.hint}>앱 목록에서만 제거하면 PC 폴더와 Git 기록은 그대로 남습니다.</Text></View></View></Modal>
    <Modal visible={modelPicker} animationType="slide" transparent onRequestClose={() => setModelPicker(false)}><View style={s.modalBackdrop}><View style={s.modalSheet}><View style={s.modalHead}><Text style={s.title}>모델·토론 설정</Text><Pressable onPress={() => setModelPicker(false)}><Text style={s.close}>완료</Text></Pressable></View><ScrollView style={s.modalList} contentContainerStyle={s.modalContent}><Button label="↻ 모델 목록 새로고침" onPress={() => { if (connection) void request<{ catalogs: Catalog[] }>(connection, '/models').then(({ catalogs: found }) => setCatalogs(found)).catch((error: unknown) => setNotice(errorText(error))); }} />{(['codex', 'claude'] as Provider[]).filter((provider) => target === 'both' || target === provider).map(modelControl)}<Pressable style={s.discussion} disabled={target !== 'both'} onPress={() => setDiscussion((old) => !old)}><Text style={s.label}>두 모델 토론</Text><Text style={s.check}>{discussion && target === 'both' ? '켜짐' : '꺼짐'}</Text></Pressable>{target === 'both' && discussion && <><Text style={s.label}>이번 지시의 토론 왕복 횟수</Text><View style={s.row}>{[1, 2, 3, 4, 5, 6, 7, 8, -1].map((round) => <Button key={round} label={round === -1 ? '끝장 토론 · 최대 10회' : `${round}회`} active={(discussionRounds ?? snapshot?.project.defaultDebateRounds ?? 2) === round} onPress={() => setDiscussionRounds(round)} />)}</View></>}</ScrollView></View></View></Modal>
    <Modal visible={!!selectedEvent} animationType="slide" transparent onRequestClose={() => setSelectedEvent(null)}><View style={s.modalBackdrop}><View style={[s.modalSheet, s.recordSheet]}><View style={s.modalHead}><View><Text style={s.title}>{selectedEvent?.actor === 'user' ? '내 지시' : selectedEvent?.actor === 'codex' ? 'Codex 기록' : selectedEvent?.actor === 'claude' ? 'Claude 기록' : '프로젝트 기록'}</Text><Text style={s.meta}>{selectedEvent ? date(selectedEvent.timestamp) : ''}</Text></View><Pressable onPress={() => setSelectedEvent(null)}><Text style={s.close}>닫기</Text></Pressable></View><ScrollView style={s.modalList} contentContainerStyle={s.modalContent}><MarkdownText text={selectedEvent?.message ?? ''} /></ScrollView></View></View></Modal>
  </KeyboardAvoidingView>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f5f7fb' },
  header: { backgroundColor: color.dark, paddingTop: Platform.OS === 'web' ? 16 : 52, paddingBottom: 14, paddingHorizontal: 18 },
  brand: { color: color.white, fontWeight: '800', fontSize: 17 },
  subtitle: { color: '#adbcdf', marginTop: 7 },
  projectSwitch: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName: { flex: 1, color: color.white, fontSize: 20, fontWeight: '800' },
  connection: { color: '#a8e5c4', fontSize: 11 },
  content: { padding: 14, paddingBottom: 32, gap: 12 },
  panel: { padding: 16, borderRadius: 16, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, gap: 12 },
  title: { color: color.ink, fontWeight: '800', fontSize: 18 },
  label: { color: color.ink, fontWeight: '700', fontSize: 14 },
  hint: { color: color.muted, fontSize: 13, lineHeight: 20 },
  input: { borderWidth: 1, borderColor: color.line, borderRadius: 12, padding: 12, color: color.ink, fontSize: 15, backgroundColor: color.white },
  multiline: { minHeight: 88, textAlignVertical: 'top' },
  button: { minHeight: 42, justifyContent: 'center', borderWidth: 1, borderColor: color.line, backgroundColor: color.white, paddingHorizontal: 13, paddingVertical: 8, borderRadius: 11, alignSelf: 'flex-start' },
  activeButton: { backgroundColor: color.blue, borderColor: color.blue },
  buttonText: { color: color.ink, fontWeight: '700', fontSize: 13 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  horizontal: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  tabBar: { flexDirection: 'row', backgroundColor: color.white, borderBottomWidth: 1, borderBottomColor: color.line, paddingLeft: 8, alignItems: 'center' },
  tabScroller: { flex: 1 },
  tabChoices: { flexDirection: 'row', alignItems: 'center', paddingRight: 8 },
  tab: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, marginRight: 7 },
  tabActive: { borderBottomWidth: 3, borderBottomColor: color.blue },
  tabText: { color: color.muted, fontSize: 15, fontWeight: '700' },
  tabTextActive: { color: color.blue },
  refresh: { marginLeft: 'auto', width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  refreshText: { color: color.blue, fontSize: 26 },
  notice: { padding: 12, backgroundColor: '#e8edff', color: color.ink, borderRadius: 10 },
  inlineNotice: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#e8edff', color: color.ink, fontSize: 12 },
  operationError: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff0f1', color: '#a83244', fontSize: 12 },
  statusStrip: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  statusItem: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 8 },
  statusName: { color: color.ink, fontWeight: '800', fontSize: 12 },
  statusText: { color: color.muted, fontSize: 11, marginTop: 2 },
  filterBar: { flexDirection: 'row', gap: 7, paddingHorizontal: 13, paddingBottom: 9 },
  filter: { paddingHorizontal: 12, minHeight: 34, justifyContent: 'center', borderRadius: 18, backgroundColor: color.white, borderWidth: 1, borderColor: color.line },
  filterActive: { backgroundColor: color.dark, borderColor: color.dark },
  filterText: { color: color.ink, fontSize: 12, fontWeight: '700' },
  filterTextActive: { color: color.white },
  history: { flex: 1 },
  historyContent: { paddingHorizontal: 12, paddingBottom: 20, gap: 10 },
  empty: { padding: 30, borderRadius: 16, backgroundColor: color.white, alignItems: 'center', gap: 5 },
  emptyTitle: { color: color.ink, fontSize: 16, fontWeight: '800' },
  bubble: { alignSelf: 'stretch', backgroundColor: color.white, borderWidth: 1, borderColor: color.line, borderRadius: 15, padding: 13, gap: 6 },
  userBubble: { backgroundColor: '#e9eeff', borderColor: '#d8e0ff', marginLeft: 28 },
  errorBubble: { backgroundColor: '#fff0f1', borderColor: '#ffcbd0' },
  bubbleHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  bubbleActor: { color: color.ink, fontWeight: '800', fontSize: 13 },
  meta: { color: color.muted, fontSize: 11 },
  body: { color: color.ink, lineHeight: 22, fontSize: 14 },
  expand: { color: color.blue, fontWeight: '700', paddingVertical: 6 },
  working: { color: color.blue, fontWeight: '700', padding: 10 },
  composer: { backgroundColor: color.white, borderTopWidth: 1, borderTopColor: color.line, paddingHorizontal: 11, paddingTop: 9, paddingBottom: Platform.OS === 'web' ? 12 : 24, gap: 8 },
  composerToggle: { minHeight: 28, justifyContent: 'center' },
  composerToggleText: { color: color.blue, fontSize: 12, fontWeight: '800' },
  composerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 },
  targets: { flexDirection: 'row', gap: 4 },
  target: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 7 },
  targetActive: { backgroundColor: '#e8edff' },
  targetText: { color: color.muted, fontSize: 12, fontWeight: '700' },
  targetTextActive: { color: color.blue },
  settings: { color: color.ink, fontSize: 12, fontWeight: '700' },
  composerSummary: { color: color.muted, fontSize: 11 },
  fileChip: { maxWidth: 180, backgroundColor: '#edf1fa', borderRadius: 8, padding: 7 },
  composerInput: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  attach: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#f0f3fa' },
  attachText: { color: color.ink, fontSize: 27, lineHeight: 32 },
  chatInput: { flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderColor: color.line, borderRadius: 13, paddingHorizontal: 12, paddingVertical: 9, color: color.ink, fontSize: 15, textAlignVertical: 'top' },
  send: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: color.blue },
  sendDisabled: { opacity: 0.45 },
  sendText: { color: color.white, fontSize: 20 },
  cancel: { color: '#b53844', fontSize: 12, fontWeight: '700', textAlign: 'right' },
  taskCard: { backgroundColor: color.white, borderWidth: 1, borderColor: color.line, borderRadius: 16, padding: 15, gap: 10 },
  stats: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, borderRadius: 14, padding: 14, gap: 4 },
  statNumber: { color: color.ink, fontSize: 25, fontWeight: '800' },
  taskTitle: { color: color.ink, fontSize: 16, fontWeight: '800' },
  taskMeta: { color: color.muted, fontSize: 12 },
  summaryGroup: { padding: 13, borderWidth: 1, borderColor: color.line, borderTopWidth: 3, borderRadius: 11, gap: 9, backgroundColor: '#f8faff' },
  summaryAgreement: { borderTopColor: '#58a67a' },
  summaryDisagreement: { borderTopColor: '#dc9167' },
  summaryNext: { borderTopColor: '#6076df' },
  summaryItem: { gap: 4 },
  summaryInstruction: { gap: 8, borderTopWidth: 1, borderTopColor: color.line, paddingTop: 12 },
  modalBackdrop: { flex: 1, backgroundColor: '#101b35aa', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: color.white, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: Platform.OS === 'web' ? 18 : 34, maxHeight: '82%', gap: 12 },
  recordSheet: { maxHeight: '94%', minHeight: '70%' },
  recordBody: { color: color.ink, fontSize: 15, lineHeight: 25 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  close: { color: color.blue, fontSize: 15, fontWeight: '700' },
  modalList: { flexGrow: 0 },
  modalContent: { gap: 16, paddingBottom: 12 },
  projectOption: { minHeight: 55, borderBottomWidth: 1, borderBottomColor: color.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projectOptionText: { color: color.ink, fontSize: 16, fontWeight: '700', flex: 1 },
  candidateSelected: { backgroundColor: '#eef1ff' },
  candidateText: { flex: 1, gap: 3 },
  check: { color: color.blue, fontWeight: '800' },
  selector: { gap: 9, paddingVertical: 8 },
  discussion: { borderTopWidth: 1, borderTopColor: color.line, flexDirection: 'row', justifyContent: 'space-between', paddingTop: 17 },
});
