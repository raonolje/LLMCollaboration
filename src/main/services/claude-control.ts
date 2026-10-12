import type { ToolPermissionResult } from './tool-approvals';

/** Official Claude stream-json host control protocol, not an approval bypass. */
export class ClaudeControl {
  private closed = false;
  private tasks = new Set<string>();
  private requests = new Map<string, AbortController>();
  private resultSeen = false;
  private sessionState: string | undefined;
  private abort = new AbortController();
  readonly signal: AbortSignal;
  constructor(private prompt: string, private send: (line: string) => void, private end: () => void,
    private permission: (name: string, input: unknown, signal: AbortSignal) => Promise<ToolPermissionResult>,
    signal: AbortSignal, private error: (text: string) => void) { this.signal = AbortSignal.any([signal, this.abort.signal]); }
  start(): void { this.write({ type: 'control_request', request_id: 'collab-initialize', request: { subtype: 'initialize' } }); }
  private write(value: unknown): void { if (!this.closed) this.send(JSON.stringify(value) + '\n'); }
  accept(value: Record<string, any>): void {
    if (this.closed) return;
    if (value.type === 'control_response' && value.response?.request_id === 'collab-initialize') {
      if (value.response.subtype === 'error') { this.error(String(value.response.error)); this.close(); return; }
      this.write({ type: 'user', session_id: '', message: { role: 'user', content: this.prompt }, parent_tool_use_id: null });
    } else if (value.type === 'control_request') {
      const request = value.request;
      if (request?.subtype !== 'can_use_tool') {
        this.write({ type: 'control_response', response: { subtype: 'error', request_id: value.request_id, error: '지원하지 않는 호스트 요청입니다.' } }); return;
      }
      const requestAbort = new AbortController(); this.requests.set(value.request_id, requestAbort);
      void this.permission(String(request.tool_name), request.input, AbortSignal.any([this.signal, requestAbort.signal])).then((answer) => {
        if (requestAbort.signal.aborted) return;
        this.write({ type: 'control_response', response: { subtype: 'success', request_id: value.request_id,
          response: answer.behavior === 'allow' ? { behavior: 'allow', updatedInput: answer.updatedInput ?? request.input } : answer } });
      }, (error) => this.write({ type: 'control_response', response: { subtype: 'error', request_id: value.request_id, error: String(error) } }))
        .finally(() => this.requests.delete(value.request_id));
    } else if (value.type === 'control_cancel_request') {
      this.requests.get(value.request_id)?.abort(); this.requests.delete(value.request_id);
    } else if (value.type === 'system' && value.subtype === 'task_started' && value.task_id) this.tasks.add(value.task_id);
    else if (value.type === 'system' && value.subtype === 'task_notification') this.tasks.delete(value.task_id);
    else if (value.type === 'system' && value.subtype === 'task_updated' && ['completed', 'failed', 'stopped', 'cancelled'].includes(value.patch?.status)) this.tasks.delete(value.task_id);
    else if (value.type === 'system' && value.subtype === 'session_state_changed') {
      this.sessionState = value.state; if (value.state === 'idle' && this.resultSeen && !this.tasks.size && !this.requests.size) this.close();
    } else if (value.type === 'result') {
      this.resultSeen = true;
      if ((!this.sessionState || this.sessionState === 'idle') && !this.tasks.size && !this.requests.size) this.close();
    }
  }
  close(): void { if (!this.closed) { this.closed = true; this.abort.abort(); this.end(); } }
}
