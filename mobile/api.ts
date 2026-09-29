import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type Provider = 'codex' | 'claude';
export type Target = Provider | 'both';
export type Project = { id: string; name: string; goal: string; path: string; charter?: string; defaultDebateRounds: number };
export type ConversationCandidate = { provider: Provider; sessionId: string; filePath: string; title: string; updatedAt: string; turnCount: number };
export type Event = { id: string; actor: Provider | 'user' | 'system'; type: string; message: string; timestamp: string; taskId?: string; metadata?: Record<string, string> };
export type Task = { id: string; title: string; description: string; status: string; executor: { provider: Provider; model: string }; reviewer: { provider: Provider; model: string }; debateRounds: number };
export type Snapshot = { project: Project; tasks: Task[]; events: Event[] };
export type Catalog = { provider: Provider; models: { id: string; label: string; efforts: string[]; defaultEffort?: string; requiresCredits?: boolean }[] };
export type Connection = { url: string; token: string };
export type Operation = { id: string; kind: string; projectId: string; state: 'running' | 'done' | 'error'; target?: Target; taskId?: string; error?: string };
const storageKey = 'llm-collaboration-connection';

export const loadConnection = async (): Promise<Connection | null> => {
  if (Platform.OS === 'web') {
    const token = new URLSearchParams(window.location.hash.slice(1)).get('pair');
    if (token && /^[a-f0-9]{64}$/u.test(token)) {
      const connection = { url: window.location.origin, token };
      window.localStorage.setItem(storageKey, JSON.stringify(connection));
      window.history.replaceState(null, '', window.location.pathname);
      return connection;
    }
  }
  const saved = Platform.OS === 'web' ? window.localStorage.getItem(storageKey) : await SecureStore.getItemAsync(storageKey);
  return saved ? JSON.parse(saved) as Connection : null;
};
export const saveConnection = async (connection: Connection | null): Promise<void> => {
  if (Platform.OS === 'web') {
    if (connection) window.localStorage.setItem(storageKey, JSON.stringify(connection));
    else window.localStorage.removeItem(storageKey);
  } else if (connection) await SecureStore.setItemAsync(storageKey, JSON.stringify(connection));
  else await SecureStore.deleteItemAsync(storageKey);
};
export const request = async <T>(connection: Connection, route: string, body?: unknown): Promise<T> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), route.endsWith('/chat') || route === '/projects' && body !== undefined ? 180_000 : 30_000);
  try {
    const response = await fetch(`${connection.url.replace(/\/$/u, '')}/v1${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${connection.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(result.error ?? `연결 오류 (${response.status})`);
    return result;
  } finally { clearTimeout(timeout); }
};

export const watchEvents = async (connection: Connection, onUpdate: () => void, signal: AbortSignal, onReady: () => void): Promise<void> => {
  const response = await fetch(`${connection.url}/v1/events`, { headers: { Authorization: `Bearer ${connection.token}` }, signal });
  if (!response.ok || !response.body) throw new Error('실시간 연결을 열 수 없습니다.');
  onReady();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const consume = async (pending: string): Promise<void> => {
    const { done, value } = await reader.read();
    if (done) return;
    const blocks = `${pending}${decoder.decode(value, { stream: true })}`.split(/\r?\n\r?\n/u);
    blocks.slice(0, -1).filter((block) => block.startsWith('data: ')).forEach(onUpdate);
    await consume(blocks.at(-1) ?? '');
  };
  await consume('');
};
