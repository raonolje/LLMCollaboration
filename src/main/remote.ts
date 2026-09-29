import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { ChatModelSettings, DebateFollowUp, Provider, RemoteStatus, TaskInput } from '../shared/types';
import type { Service } from './services';

type Settings = { enabled: boolean; token: string };
type Operation = { id: string; kind: string; projectId: string; state: 'running' | 'done' | 'error'; error?: string };
const port = 48721;
const token = (): string => randomBytes(32).toString('hex');
const json = (response: ServerResponse, status: number, value: unknown): void => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
};
const readBody = async (request: IncomingMessage): Promise<unknown> => {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk as Buffer);
    size += buffer.length;
    if (size > 128_000) throw new Error('메시지 크기 제한을 초과했습니다.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('올바른 요청 본문이 아닙니다.');
  return value as Record<string, unknown>;
};
const text = (value: unknown, maximum = 20_000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) throw new Error('입력 내용을 확인하세요.');
  return value.trim();
};
const target = (value: unknown): Provider | 'both' => {
  if (value === 'codex' || value === 'claude' || value === 'both') return value;
  throw new Error('보낼 모델을 선택하세요.');
};
const authorized = (request: IncomingMessage, secret: string): boolean => {
  const provided = request.headers.authorization?.replace(/^Bearer /u, '') ?? '';
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  return left.length === right.length && timingSafeEqual(left, right);
};
const tailnetAddress = (): string | undefined => Object.entries(networkInterfaces())
  .filter(([name]) => /tailscale/iu.test(name))
  .flatMap(([, addresses]) => addresses ?? [])
  .find((address) => address.family === 'IPv4' && !address.internal)?.address;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export const createRemote = (service: Service, userData: string, options: { address?: string; port?: number } = {}) => {
  const settingsFile = path.join(userData, 'remote-settings.json');
  let server: Server | null = null;
  let boundAddress: string | undefined;
  let settings: Settings | null = null;
  let lastError: string | undefined;
  const operations = new Map<string, Operation>();
  const readSettings = async (): Promise<Settings> => {
    if (settings) return settings;
    const existing = await readFile(settingsFile, 'utf8').then((raw) => JSON.parse(raw) as Settings)
      .catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
    settings = existing?.token ? existing : { enabled: false, token: token() };
    return settings;
  };
  const save = async (next: Settings): Promise<void> => {
    await mkdir(userData, { recursive: true });
    await writeFile(settingsFile, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
    settings = next;
  };
  const projectPath = async (id: string): Promise<string> => {
    const project = (await service.listProjects()).find((entry) => entry.id === id);
    if (!project) throw new Error('프로젝트를 찾을 수 없습니다.');
    return project.path;
  };
  const launch = (kind: string, projectId: string, action: () => Promise<unknown>): Operation => {
    const id = randomBytes(12).toString('hex');
    const operation: Operation = { id, kind, projectId, state: 'running' };
    operations.set(id, operation);
    void action().then(() => { operations.set(id, { ...operation, state: 'done' }); })
      .catch((error: unknown) => { operations.set(id, { ...operation, state: 'error', error: message(error) }); });
    return operation;
  };
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (!authorized(request, (await readSettings()).token)) { json(response, 401, { error: '연결 코드가 올바르지 않습니다.' }); return; }
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const segments = url.pathname.split('/').filter(Boolean);
      if (request.method === 'GET' && url.pathname === '/v1/health') { json(response, 200, { ok: true, version: 1 }); return; }
      if (request.method === 'GET' && url.pathname === '/v1/projects') {
        json(response, 200, { projects: await service.listProjects() }); return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        json(response, 200, { catalogs: await service.refreshModelCatalogs() }); return;
      }
      if (request.method === 'GET' && segments[0] === 'v1' && segments[1] === 'operations') {
        json(response, 200, { operations: [...operations.values()].slice(-50) }); return;
      }
      if (segments[0] !== 'v1' || segments[1] !== 'projects' || !segments[2]) { json(response, 404, { error: '요청을 찾을 수 없습니다.' }); return; }
      const id = segments[2];
      const directory = await projectPath(id);
      if (request.method === 'GET' && segments.length === 3) {
        json(response, 200, await service.openProject(directory)); return;
      }
      if (request.method !== 'POST') { json(response, 405, { error: '지원하지 않는 요청입니다.' }); return; }
      const body = object(await readBody(request));
      const action = segments[3];
      if (action === 'chat') {
        const chatMessage = text(body.message);
        const chatTarget = target(body.target);
        const models = object(body.models ?? {});
        const selected = Object.fromEntries((['codex', 'claude'] as Provider[])
          .filter((provider) => models[provider])
          .map((provider) => [provider, models[provider]])) as Partial<Record<Provider, ChatModelSettings>>;
        json(response, 202, launch('chat', id, () => service.sendProjectMessage(directory, chatMessage, chatTarget, selected))); return;
      }
      if (action === 'cancel-chat') { await service.cancelProjectMessage(directory); json(response, 200, { ok: true }); return; }
      if (action === 'tasks' && segments.length === 4) {
        json(response, 200, await service.createTask(directory, body as TaskInput)); return;
      }
      if (action === 'plan') { json(response, 202, launch('plan', id, () => service.planTasks(directory, text(body.request)))); return; }
      if (action === 'tasks' && segments[4]) {
        const taskId = segments[4];
        const command = segments[5];
        if (command === 'debate') { json(response, 202, launch('debate', id, () => service.runDebate(directory, taskId))); return; }
        if (command === 'continue') {
          const followUp: DebateFollowUp = { message: text(body.message), target: target(body.target), additionalRounds: Number(body.additionalRounds) };
          json(response, 202, launch('continue', id, () => service.continueDebate(directory, taskId, followUp))); return;
        }
        if (command === 'execute') { json(response, 202, launch('execute', id, () => service.executeTask(directory, taskId))); return; }
        if (command === 'cancel') { await service.cancelRun(directory, taskId); json(response, 200, { ok: true }); return; }
      }
      json(response, 404, { error: '요청을 찾을 수 없습니다.' });
    } catch (error) { json(response, error instanceof SyntaxError ? 400 : 422, { error: message(error) }); }
  };
  const stop = async (): Promise<void> => {
    if (!server) return;
    const current = server;
    server = null;
    boundAddress = undefined;
    await new Promise<void>((resolve) => current.close(() => resolve()));
  };
  const start = async (): Promise<void> => {
    await stop();
    const address = options.address ?? tailnetAddress();
    if (!address) { lastError = 'Tailscale 연결을 찾지 못했습니다. PC와 iPhone에서 Tailscale을 연결하세요.'; return; }
    const next = createServer((request, response) => { void handle(request, response); });
    try {
      await new Promise<void>((resolve, reject) => {
        next.once('error', reject);
        next.listen(options.port ?? port, address, resolve);
      });
      server = next;
      boundAddress = address;
      lastError = undefined;
    } catch (error) { next.close(); lastError = message(error); }
  };
  const status = async (): Promise<RemoteStatus> => {
    const current = await readSettings();
    const listening = server?.address();
    const activePort = listening && typeof listening !== 'string' ? listening.port : port;
    return { enabled: current.enabled, url: boundAddress ? `http://${boundAddress}:${activePort}` : undefined,
      token: current.token, error: lastError };
  };
  return {
    initialize: async (): Promise<void> => { if ((await readSettings()).enabled) await start(); },
    status,
    setEnabled: async (enabled: boolean): Promise<RemoteStatus> => {
      const current = await readSettings();
      await save({ ...current, enabled });
      if (enabled) await start(); else { await stop(); lastError = undefined; }
      return status();
    },
    rotateToken: async (): Promise<RemoteStatus> => {
      const current = await readSettings();
      await save({ ...current, token: token() });
      return status();
    },
    close: stop,
  };
};
