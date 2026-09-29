import { mkdtemp, rm } from 'node:fs/promises';
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
    const sendProjectMessage = vi.fn(async () => ({ project: { id: 'project-1' }, tasks: [], events: [] }));
    const service = {
      listProjects: async () => [{ id: 'project-1', name: 'Project', path: directory }],
      openProject: async () => ({ project: { id: 'project-1', name: 'Project', path: directory }, tasks: [], events: [] }),
      sendProjectMessage,
    } as unknown as Service;
    const remote = createRemote(service, directory, { address: '127.0.0.1', port: 0 });
    try {
      const status = await remote.setEnabled(true);
      expect(status.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);
      const unauthorized = await fetch(`${status.url}/v1/projects`);
      expect(unauthorized.status).toBe(401);
      const headers = { Authorization: `Bearer ${status.token}` };
      const projects = await fetch(`${status.url}/v1/projects`, { headers });
      expect((await projects.json() as { projects: { id: string }[] }).projects[0].id).toBe('project-1');
      const unknown = await fetch(`${status.url}/v1/projects/other`, { headers });
      expect(unknown.status).toBe(422);
      const sent = await fetch(`${status.url}/v1/projects/project-1/chat`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Check this', target: 'codex', models: {} }),
      });
      expect(sent.status).toBe(202);
      await vi.waitFor(() => expect(sendProjectMessage).toHaveBeenCalledWith(directory, 'Check this', 'codex', {}));
      const rotated = await remote.rotateToken();
      expect(rotated.token).not.toBe(status.token);
      expect((await fetch(`${status.url}/v1/projects`, { headers })).status).toBe(401);
    } finally { await remote.close(); }
  });
});
