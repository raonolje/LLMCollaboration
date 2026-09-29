import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRemote } from '../src/main/remote';
import type { Service } from '../src/main/services';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('remote companion', () => {
  it('requires the pairing token and resolves only registered project IDs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'collab-remote-'));
    directories.push(directory);
    const webRoot = path.join(directory, 'web');
    await mkdir(webRoot);
    await writeFile(path.join(webRoot, 'index.html'), '<head></head><h1>Mobile connection</h1>');
    const sendProjectMessage = vi.fn(async () => ({ project: { id: 'project-1' }, tasks: [], events: [] }));
    const createProject = vi.fn(async (input: { path: string; name: string }) => ({ project: { id: 'created', ...input }, tasks: [], events: [] }));
    const createTask = vi.fn(async () => ({ tasks: [{ id: 'task-1' }] }));
    const runDebate = vi.fn(async () => undefined);
    const executeTask = vi.fn(async () => undefined);
    const unregisterProjectOnly = vi.fn(async () => undefined);
    const service = {
      listProjects: async () => [{ id: 'project-1', name: 'Project', path: directory }],
      openProject: async () => ({ project: { id: 'project-1', name: 'Project', path: directory, defaultDebateRounds: 2 }, tasks: [], events: [] }),
      createProject,
      listLocalConversations: async () => [{ provider: 'codex', filePath: path.join(directory, 'session.jsonl'), sessionId: 'session-1', title: 'Past chat', updatedAt: '2026-09-30T00:00:00.000Z', turnCount: 5 }],
      createTask,
      runDebate,
      executeTask,
      unregisterProjectOnly,
      sendProjectMessage,
    } as unknown as Service;
    const remote = createRemote(service, directory, { address: '127.0.0.1', port: 0, webRoot });
    try {
      const status = await remote.setEnabled(true);
      expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      const page = await fetch(`${status.url}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('Mobile connection');
      expect(html).toContain('/manifest.webmanifest');
      expect((await fetch(`${status.url}/remote-settings.json`)).status).toBe(404);
      const unauthorized = await fetch(`${status.url}/v1/projects`);
      expect(unauthorized.status).toBe(401);
      const headers = { Authorization: `Bearer ${status.token}` };
      const streamAbort = new AbortController();
      const stream = await fetch(`${status.url}/v1/events`, { headers, signal: streamAbort.signal });
      expect(stream.status).toBe(200);
      const reader = stream.body?.getReader();
      expect(new TextDecoder().decode((await reader?.read())?.value)).toContain('connected');
      const projects = await fetch(`${status.url}/v1/projects`, { headers });
      expect((await projects.json() as { projects: { id: string }[] }).projects[0].id).toBe('project-1');
      const defaults = await fetch(`${status.url}/v1/project-defaults`, { headers });
      expect((await defaults.json() as { basePath: string }).basePath).toContain('LLM Collaboration');
      const conversations = await fetch(`${status.url}/v1/conversations`, { headers });
      expect((await conversations.json() as { conversations: Array<{ title: string }> }).conversations[0].title).toBe('Past chat');
      const created = await fetch(`${status.url}/v1/projects`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Phone project', goal: 'Create from iPhone', path: path.join(directory, 'phone-project'), defaultDebateRounds: 3 }) });
      expect(created.status).toBe(201);
      expect((await created.json() as { project: { id: string } }).project.id).toBe('created');
      expect(createProject).toHaveBeenCalledWith({ name: 'Phone project', goal: 'Create from iPhone', path: path.join(directory, 'phone-project'), defaultDebateRounds: 3 });
      const invalidFolder = await fetch(`${status.url}/v1/projects`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad path', goal: 'Reject relative path', path: 'relative-folder' }) });
      expect(invalidFolder.status).toBe(422);
      const unregistered = await fetch(`${status.url}/v1/projects/project-1/delete`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmation: 'Project', mode: 'unregister' }) });
      expect(unregistered.status).toBe(200);
      expect(unregisterProjectOnly).toHaveBeenCalledWith(directory, 'project-1', 'Project');
      const unknown = await fetch(`${status.url}/v1/projects/other`, { headers });
      expect(unknown.status).toBe(422);
      const sent = await fetch(`${status.url}/v1/projects/project-1/chat`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Check this', target: 'codex', models: {} }),
      });
      expect(sent.status).toBe(202);
      expect(new TextDecoder().decode((await reader?.read())?.value)).toContain('"kind":"operation"');
      streamAbort.abort();
      await vi.waitFor(() => expect(sendProjectMessage).toHaveBeenCalledWith(directory, 'Check this', 'codex', {}));
      const mobileFile = { name: 'phone-photo.jpg', data: Buffer.from('image').toString('base64') };
      const attached = await fetch(`${status.url}/v1/projects/project-1/chat`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '', target: 'both', models: {}, files: [mobileFile] }),
      });
      expect(attached.status).toBe(202);
      await vi.waitFor(() => expect(sendProjectMessage).toHaveBeenCalledWith(directory, '', 'both', {}, [mobileFile], false));
      const taskRequest = await fetch(`${status.url}/v1/projects/project-1/chat-task`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Build a mobile screen', target: 'claude', models: {} }) });
      expect(taskRequest.status).toBe(202);
      await vi.waitFor(() => expect(createTask).toHaveBeenCalledWith(directory, expect.objectContaining({ title: 'Build a mobile screen', executor: expect.objectContaining({ provider: 'claude' }) })));
      await vi.waitFor(() => expect(executeTask).toHaveBeenCalledWith(directory, 'task-1'));
      const rotated = await remote.rotateToken();
      expect(rotated.token).not.toBe(status.token);
      expect((await fetch(`${status.url}/v1/projects`, { headers })).status).toBe(401);
    } finally { await remote.close(); }
  });
});
