import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from 'react-native';
import { loadConnection, request, saveConnection, type Catalog, type Connection, type Event, type Project, type Provider, type Snapshot, type Target, type Task } from './api';

const color = { dark: '#111c35', blue: '#5266e9', ink: '#172644', muted: '#7785a0', line: '#dfe5f0', white: '#fff' };
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
const date = (value: string): string => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function Button({ label, onPress, active = false, disabled = false }: { label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return <Pressable onPress={onPress} disabled={disabled} style={[s.button, active && s.activeButton, disabled && { opacity: 0.5 }]}><Text style={[s.buttonText, active && { color: color.white }]}>{label}</Text></Pressable>;
}
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={s.panel}><Text style={s.title}>{title}</Text>{children}</View>;
}

export default function App() {
  const [connection, setConnection] = useState<Connection | null>(null);
  const [address, setAddress] = useState('');
  const [secret, setSecret] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [tab, setTab] = useState<'chat' | 'tasks'>('chat');
  const [target, setTarget] = useState<Target>('both');
  const [message, setMessage] = useState('');
  const [models, setModels] = useState<Record<Provider, { model: string; effort: string }>>({ codex: { model: '', effort: '' }, claude: { model: '', effort: '' } });
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [executor, setExecutor] = useState<Provider>('codex');
  const [plan, setPlan] = useState('');
  const [followUps, setFollowUps] = useState<Record<string, string>>({});
  const [operations, setOperations] = useState<{ state: string; error?: string }[]>([]);
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
  };
  useEffect(() => { void loadConnection().then((saved) => { if (saved) { setConnection(saved); setAddress(saved.url); setSecret(saved.token); } }); }, []);
  useEffect(() => {
    if (!connection) return;
    let active = true;
    const poll = (): void => { void refresh(connection, projectId).catch((error: unknown) => { if (active) setNotice(errorText(error)); }); };
    poll();
    const timer = setInterval(poll, 5_000);
    return () => { active = false; clearInterval(timer); };
  }, [connection, projectId]);
  useEffect(() => { if (connection) void request<{ catalogs: Catalog[] }>(connection, '/models').then(({ catalogs: found }) => setCatalogs(found)).catch(() => undefined); }, [connection]);
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
  const runTask = (task: Task, action: 'debate' | 'execute' | 'cancel'): void => {
    if (!projectId) return;
    const send = (): void => command(`/projects/${projectId}/tasks/${task.id}/${action}`, {}, `${task.title}: 요청을 보냈습니다.`);
    if (action === 'execute') Alert.alert('업무 실행', `${task.title} 업무를 데스크톱에서 실행할까요?`, [{ text: '취소' }, { text: '실행', onPress: send }]);
    else send();
  };
  const chat = (provider: Provider): Event[] => (snapshot?.events ?? []).filter((event) => event.actor === provider || event.actor === 'user' && event.type === 'chat' && (event.metadata?.target === provider || event.metadata?.target === 'both')).slice(-30);
  return <View style={s.root}><StatusBar barStyle="light-content" /><View style={s.header}><Text style={s.brand}>LLM Collaboration</Text><Text style={s.subtitle}>{connection ? snapshot?.project.name ?? '프로젝트 선택' : 'iPhone 원격 연결'}</Text></View>
    {!connection ? <ScrollView contentContainerStyle={s.content}><Panel title="데스크톱 연결"><Text style={s.hint}>PC와 iPhone을 같은 Tailscale 네트워크에 로그인한 뒤, 데스크톱 앱에서 원격 연결을 켜세요.</Text><TextInput style={s.input} placeholder="http://100.x.y.z:48721" autoCapitalize="none" value={address} onChangeText={setAddress} /><TextInput style={s.input} placeholder="연결 코드" autoCapitalize="none" secureTextEntry value={secret} onChangeText={setSecret} /><Button label="연결" active disabled={busy || !address || !secret} onPress={connect} /></Panel>{notice ? <Text style={s.notice}>{notice}</Text> : null}</ScrollView>
      : <><ScrollView horizontal style={s.projects} contentContainerStyle={s.row}>{projects.map((project) => <Button key={project.id} label={project.name} active={projectId === project.id} onPress={() => { void act(() => request<Snapshot>(connection, `/projects/${project.id}`).then(setSnapshot), ''); }} />)}<Button label="연결 해제" onPress={() => { void saveConnection(null).then(() => { setConnection(null); setSnapshot(null); }); }} /></ScrollView><View style={s.tabBar}><Button label="대화" active={tab === 'chat'} onPress={() => setTab('chat')} /><Button label="업무" active={tab === 'tasks'} onPress={() => setTab('tasks')} /><Button label="갱신" onPress={() => { void act(() => refresh(connection, projectId), '갱신했습니다.'); }} /></View>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">{notice ? <Text style={s.notice}>{notice}</Text> : null}{busy && <ActivityIndicator color={color.blue} />}{operations.some((item) => item.state === 'running') && <Text style={s.hint}>데스크톱에서 작업을 처리 중입니다.</Text>}{operations.filter((item) => item.state === 'error').slice(-1).map((item, index) => <Text key={index} style={s.error}>{item.error}</Text>)}
          {snapshot && tab === 'chat' && <><Panel title="Codex · Claude 대화"><View style={s.columns}>{(['codex', 'claude'] as Provider[]).map((provider) => <View key={provider} style={s.column}><Text style={s.label}>{provider === 'codex' ? 'Codex' : 'Claude'}</Text>{chat(provider).map((event) => <View key={event.id} style={s.message}><Text style={s.meta}>{event.actor === 'user' ? '나' : provider} · {date(event.timestamp)}</Text><Text selectable style={s.body}>{event.message}</Text></View>)}</View>)}</View></Panel>
            <Panel title="지시 또는 질문"><View style={s.row}>{(['both', 'codex', 'claude'] as Target[]).map((option) => <Button key={option} label={option === 'both' ? '둘 다' : option === 'codex' ? 'Codex' : 'Claude'} active={target === option} onPress={() => setTarget(option)} />)}</View>{(['codex', 'claude'] as Provider[]).filter((provider) => target === 'both' || target === provider).map((provider) => { const catalog = catalogs.find((item) => item.provider === provider); const current = models[provider]; const choice = catalog?.models.find((item) => item.id === current.model); return <View key={provider} style={s.selector}><Text style={s.label}>{provider === 'codex' ? 'Codex' : 'Claude'} 모델</Text><ScrollView horizontal><View style={s.row}><Button label="기본" active={!current.model} onPress={() => setModels((old) => ({ ...old, [provider]: { model: '', effort: '' } }))} />{catalog?.models.filter((item) => !item.requiresCredits).map((model) => <Button key={model.id} label={model.label} active={current.model === model.id} onPress={() => setModels((old) => ({ ...old, [provider]: { model: model.id, effort: '' } }))} />)}</View></ScrollView>{choice && <View style={s.row}><Button label="기본 추론" active={!current.effort} onPress={() => setModels((old) => ({ ...old, [provider]: { ...old[provider], effort: '' } }))} />{choice.efforts.map((effort) => <Button key={effort} label={effort} active={current.effort === effort} onPress={() => setModels((old) => ({ ...old, [provider]: { ...old[provider], effort } }))} />)}</View>}</View>; })}<TextInput style={[s.input, s.multiline]} multiline placeholder="모델에 전달할 지시나 질문" value={message} onChangeText={setMessage} /><Button label="메시지 보내기" active disabled={busy || !message.trim()} onPress={() => { command(`/projects/${projectId}/chat`, { message, target, models }, '지시를 전달했습니다. 답변은 자동으로 갱신됩니다.'); setMessage(''); }} /><Button label="응답 중단" onPress={() => command(`/projects/${projectId}/cancel-chat`, {}, '중단을 요청했습니다.')} /></Panel></>}
          {snapshot && tab === 'tasks' && <><Panel title="업무 자동 계획"><TextInput style={[s.input, s.multiline]} multiline placeholder="목표와 완료 기준" value={plan} onChangeText={setPlan} /><Button label="계획 요청" active disabled={busy || !plan.trim()} onPress={() => { command(`/projects/${projectId}/plan`, { request: plan }, '계획을 요청했습니다.'); setPlan(''); }} /></Panel><Panel title="직접 업무 지정"><TextInput style={s.input} placeholder="업무 제목" value={taskTitle} onChangeText={setTaskTitle} /><TextInput style={[s.input, s.multiline]} multiline placeholder="설명과 완료 기준" value={taskDescription} onChangeText={setTaskDescription} /><Text style={s.label}>실행 담당</Text><View style={s.row}>{(['codex', 'claude'] as Provider[]).map((provider) => <Button key={provider} label={provider} active={executor === provider} onPress={() => setExecutor(provider)} />)}</View><Button label="업무 추가" active disabled={busy || !taskTitle.trim() || !taskDescription.trim()} onPress={() => { command(`/projects/${projectId}/tasks`, { title: taskTitle, description: taskDescription, acceptanceCriteria: [taskDescription], mode: 'manual', executor: { provider: executor, model: 'default' }, reviewer: { provider: executor === 'codex' ? 'claude' : 'codex', model: 'default' }, dependsOn: [], debateRounds: snapshot.project.defaultDebateRounds }, '업무를 추가했습니다.'); setTaskTitle(''); setTaskDescription(''); }} /></Panel><Panel title="업무 진행">{snapshot.tasks.map((task) => <View key={task.id} style={s.task}><Text style={s.label}>{task.title}</Text><Text style={s.hint}>{task.status} · {task.executor.provider} 실행 · {task.reviewer.provider} 검수</Text><Text style={s.body}>{task.description}</Text><View style={s.row}><Button label="토론" onPress={() => runTask(task, 'debate')} /><Button label="실행" active onPress={() => runTask(task, 'execute')} /><Button label="중단" onPress={() => runTask(task, 'cancel')} /></View><TextInput style={s.input} placeholder="추가 반론이나 작업 수정" value={followUps[task.id] ?? ''} onChangeText={(value) => setFollowUps((old) => ({ ...old, [task.id]: value }))} /><Button label="추가 토론 · 1회 왕복" disabled={!(followUps[task.id] ?? '').trim()} onPress={() => { command(`/projects/${projectId}/tasks/${task.id}/continue`, { message: followUps[task.id], target: 'both', additionalRounds: 1 }, '추가 토론을 요청했습니다.'); setFollowUps((old) => ({ ...old, [task.id]: '' })); }} /></View>)}</Panel></>}
        </ScrollView></>}
  </View>;
}

const s = StyleSheet.create({ root: { flex: 1, backgroundColor: '#f5f7fb' }, header: { backgroundColor: color.dark, paddingTop: 55, paddingBottom: 17, paddingHorizontal: 19 }, brand: { color: color.white, fontWeight: '800', fontSize: 21 }, subtitle: { color: '#adbcdf', marginTop: 5 }, content: { padding: 13, paddingBottom: 50, gap: 12 }, panel: { padding: 15, borderRadius: 16, backgroundColor: color.white, borderWidth: 1, borderColor: color.line, gap: 11 }, title: { color: color.ink, fontWeight: '800', fontSize: 17 }, label: { color: color.ink, fontWeight: '700' }, hint: { color: color.muted, fontSize: 13, lineHeight: 19 }, input: { borderWidth: 1, borderColor: color.line, borderRadius: 10, padding: 11, color: color.ink, fontSize: 15 }, multiline: { minHeight: 85, textAlignVertical: 'top' }, button: { borderWidth: 1, borderColor: color.line, backgroundColor: color.white, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, alignSelf: 'flex-start' }, activeButton: { backgroundColor: color.blue, borderColor: color.blue }, buttonText: { color: color.ink, fontWeight: '700', fontSize: 13 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, padding: 1 }, projects: { flexGrow: 0, backgroundColor: color.white }, tabBar: { flexDirection: 'row', gap: 8, padding: 10 }, notice: { padding: 11, backgroundColor: '#e8edff', color: color.ink, borderRadius: 9 }, error: { padding: 11, backgroundColor: '#ffebed', color: '#b53844', borderRadius: 9 }, columns: { flexDirection: 'row', gap: 8 }, column: { flex: 1, gap: 8 }, message: { padding: 8, borderColor: color.line, borderWidth: 1, borderRadius: 9 }, meta: { color: color.muted, fontSize: 10, marginBottom: 4 }, body: { color: color.ink, lineHeight: 19, fontSize: 13 }, selector: { gap: 7, borderTopColor: color.line, borderTopWidth: 1, paddingTop: 9 }, task: { gap: 8, borderTopColor: color.line, borderTopWidth: 1, paddingTop: 12 } });
