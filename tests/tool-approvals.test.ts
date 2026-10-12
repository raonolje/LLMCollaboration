import { describe, expect, it, vi } from 'vitest';
import { ToolApprovals } from '../src/main/services/tool-approvals';
import { ClaudeControl } from '../src/main/services/claude-control';

describe('tool permissions through the app', () => {
  it('relays an actual question answer without granting or changing arbitrary tool parameters', async () => {
    const approvals = new ToolApprovals(); const input = { questions: [{ question: '저장 폴더는?', options: [{ label: '검토' }] }] };
    const pending = approvals.request('A', 'AskUserQuestion', input, new AbortController().signal); const id = approvals.list()[0].id;
    expect(() => approvals.respond(id, true)).toThrow('답변');
    approvals.respond(id, true, { '저장 폴더는?': '검토' });
    expect(await pending).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { '저장 폴더는?': '검토' } } });
  });
  it('asks for each exact call, denies on cancellation, and never persists a permission rule', async () => {
    const approvals = new ToolApprovals(); const one = new AbortController(), two = new AbortController();
    const a = approvals.request('A', 'Bash', { command: 'create file' }, one.signal);
    const b = approvals.request('B', 'mcp__aimoviestorage__project_get', { projectId: 'B' }, two.signal);
    expect(approvals.list()).toHaveLength(2);
    const first = approvals.list().find((item) => item.projectPath === 'A')!;
    approvals.respond(first.id, true); expect(await a).toEqual({ behavior: 'allow' });
    expect(() => approvals.respond(first.id, true)).toThrow('이미 처리');
    two.abort(); expect((await b).behavior).toBe('deny'); expect(approvals.list()).toEqual([]);
  });
  it('initializes Claude, sends the real prompt, and relays a host permission response without closing stdin early', async () => {
    const sent: any[] = [], end = vi.fn(); const approvals = new ToolApprovals();
    const control = new ClaudeControl('write the file', (line) => sent.push(JSON.parse(line)), end,
      (name, input, signal) => approvals.request('project', name, input, signal), new AbortController().signal, vi.fn());
    control.start(); expect(sent[0].request.subtype).toBe('initialize');
    control.accept({ type: 'control_response', response: { request_id: 'collab-initialize', subtype: 'success', response: {} } });
    expect(sent[1].message.content).toBe('write the file');
    control.accept({ type: 'system', subtype: 'session_state_changed', state: 'running' });
    control.accept({ type: 'control_request', request_id: 'tool-1', request: { subtype: 'can_use_tool', tool_name: 'Write', input: { file_path: 'new.txt', content: 'new' } } });
    expect(end).not.toHaveBeenCalled(); approvals.respond(approvals.list()[0].id, true); await Promise.resolve();
    expect(sent[2].response.response).toEqual({ behavior: 'allow', updatedInput: { file_path: 'new.txt', content: 'new' } });
    expect(sent[2].response.response.updatedPermissions).toBeUndefined();
    await Promise.resolve(); control.accept({ type: 'result' }); expect(end).not.toHaveBeenCalled();
    control.accept({ type: 'system', subtype: 'session_state_changed', state: 'idle' }); expect(end).toHaveBeenCalledOnce();
  });
  it('keeps background tasks alive after a turn and withdraws only a cancelled permission request', async () => {
    const sent: any[] = [], end = vi.fn(); const approvals = new ToolApprovals();
    const control = new ClaudeControl('work', (line) => sent.push(JSON.parse(line)), end,
      (name, input, signal) => approvals.request('project', name, input, signal), new AbortController().signal, vi.fn());
    control.accept({ type: 'system', subtype: 'task_started', task_id: 'background' });
    control.accept({ type: 'control_request', request_id: 'a', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } });
    control.accept({ type: 'control_cancel_request', request_id: 'a' }); await Promise.resolve();
    expect(approvals.list()).toEqual([]); expect(sent).toEqual([]);
    control.accept({ type: 'result' }); expect(end).not.toHaveBeenCalled();
    control.accept({ type: 'system', subtype: 'task_notification', task_id: 'background' });
    control.accept({ type: 'system', subtype: 'session_state_changed', state: 'idle' }); expect(end).toHaveBeenCalledOnce();
  });
});
