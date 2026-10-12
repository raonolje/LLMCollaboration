import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cliProgressFromLine, MAX_PREVIEW_LENGTH, MAX_PREVIEW_MESSAGES } from '../src/shared/cli-progress';
import { ModelActivities } from '../src/main/services/model-activities';
import { ActivityProgressTracker, MAX_TRACKED_TOOLS } from '../src/main/services/activity-progress';
import { PendingReply } from '../src/renderer/PendingReply';
import { activityProgressText } from '../src/shared/model-activity';

const codex = (record: unknown) => cliProgressFromLine(JSON.stringify(record), 'codex');
const claude = (record: unknown) => cliProgressFromLine(JSON.stringify(record), 'claude');
const item = (id: string, type: string, event = 'item.completed', extra: Record<string, unknown> = {}) =>
  codex({ type: event, item: { id, type, ...extra } });

describe('allowlisted live CLI progress', () => {
  it('exposes public assistant messages and only tool category/lifecycle metadata', () => {
    expect(item('1', 'agent_message', 'item.completed', { text: '문서 원문을 교차 확인하고 있습니다.' }).details)
      .toEqual([{ type: 'message', id: '1', text: '문서 원문을 교차 확인하고 있습니다.' }]);
    const tool = item('2', 'command_execution', 'item.completed', { command: 'PRIVATE COMMAND', aggregated_output: 'PRIVATE OUTPUT', exit_code: 0 });
    expect(tool.details).toEqual([{ type: 'tool', id: '2', category: 'command', state: 'completed' }]);
    expect(JSON.stringify(tool)).not.toContain('PRIVATE');
    expect(item('3', 'reasoning', 'item.completed', { text: 'PRIVATE REASONING' }).details).toBeUndefined();
    expect(codex({ type: 'item.completed', item: { type: 'unknown', text: 'PRIVATE' } }).details).toBeUndefined();
    expect(claude({ type: 'assistant', uuid: 'a', message: { content: [
      { type: 'thinking', thinking: 'PRIVATE REASONING' }, { type: 'text', text: '계산을 확인합니다.' },
      { type: 'tool_use', id: 'call-1', name: 'Bash', input: 'PRIVATE INPUT' },
    ] } }).details).toEqual([
      { type: 'tool', id: 'call-1', category: 'command', state: 'running' },
      { type: 'message', id: 'a', text: '계산을 확인합니다.' },
    ]);
    expect(claude({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', is_error: true, content: 'PRIVATE OUTPUT' }] } }).details)
      .toEqual([{ type: 'tool', id: 'call-1', state: 'failed' }]);
  });

  it('ignores malformed, unknown and cross-provider events; never previews raw errors or prompts', () => {
    for (const line of ['not JSON', 'null', '[]', '{}', '{"message":{"content":"oops"}}', '{"type":"result","result":"RAW RESULT"}', '{"type":"error","message":"PRIVATE"}']) {
      expect(cliProgressFromLine(line, 'codex').details).toBeUndefined();
      expect(cliProgressFromLine(line, 'claude').details).toBeUndefined();
    }
    expect(codex({ type: 'assistant', message: { content: [{ type: 'text', text: 'other provider' }] } }).details).toBeUndefined();
    expect(claude({ type: 'item.completed', item: { type: 'agent_message', text: 'other provider' } }).details).toBeUndefined();
    expect(item('bad id', 'command_execution').details).toBeUndefined();
    expect(item('id', '__proto__').details).toBeUndefined();
  });

  it('counts completed tools once, separates failures, and never treats a tool or turn event as CLI completion', () => {
    const records = new ModelActivities();
    const id = records.begin({ projectPath: 'test', provider: 'codex', phase: 'project-discussion-1' });
    records.start(id);
    const command = item('cmd', 'command_execution');
    for (const signal of [item('cmd', 'command_execution', 'item.started'), item('cmd', 'command_execution', 'item.updated'), command, command,
      item('cmd', 'command_execution', 'item.started'), item('web', 'web_search'), item('fail', 'command_execution', 'item.completed', { exit_code: 1 }),
      item('mcp', 'mcp_tool_call', 'item.started'), codex({ type: 'turn.completed' })]) records.progress(id, signal);
    const activity = records.list()[0];
    expect(activity.state).toBe('running');
    expect(activity.progress).toMatchObject({ completed: { command: 1, search: 1, file: 0, other: 0 }, running: 1, failed: 1 });
    expect(activityProgressText(activity.progress!)).toBe('명령 완료 1 · 검색 완료 1 · 도구 실행 중 1 · 도구 실패 1');
    records.progress(id, { kind: 'exited' });
    expect(records.list()[0].state).toBe('saving');
    expect(records.list()[0].progress?.running).toBe(0);
    records.finish(id, 'completed');
    records.progress(id, item('late', 'web_search'));
    expect(records.list()[0].progress?.completed.search).toBe(1);
  });

  it('joins Claude tool results to their category without showing result contents', () => {
    const tracker = new ActivityProgressTracker();
    tracker.accept(claude({ type: 'assistant', message: { content: [
      { type: 'tool_use', id: 'read', name: 'Read' }, { type: 'tool_use', id: 'web', name: 'WebSearch' },
    ] } }).details!, 'now');
    const results = claude({ type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 'read', content: 'PRIVATE' }, { type: 'tool_result', tool_use_id: 'web', content: 'PRIVATE' },
    ] } }).details!;
    tracker.accept(results, 'now');
    expect(tracker.accept(results, 'now')).toMatchObject({ completed: { search: 1, file: 1 }, running: 0 });
  });

  it('resets item IDs and stale previews when the same activity retries in a new CLI', () => {
    const records = new ModelActivities();
    const id = records.begin({ projectPath: 'test', provider: 'codex', phase: 'project-discussion-1' });
    records.start(id);
    records.progress(id, item('item-1', 'command_execution'));
    records.start(id);
    expect(records.list()[0].progress).toBeUndefined();
    expect(records.list()[0].lastOutputAt).toBeUndefined();
    records.progress(id, item('item-1', 'web_search'));
    expect(records.list()[0].progress?.completed).toEqual({ command: 0, search: 1, file: 0, other: 0 });
  });

  it('bounds previews, deduplicates snapshots and tools, strips terminal controls and preserves Unicode', () => {
    const tracker = new ActivityProgressTracker();
    for (let i = 0; i < 10; i++) tracker.accept([{ type: 'message', id: String(i), text: '\u001b[31m한글😀'.repeat(2000) }], 'now');
    const latest = tracker.accept([{ type: 'message', id: '9', text: '수정된 중간 메시지' }], 'later');
    expect(latest.messages).toHaveLength(MAX_PREVIEW_MESSAGES);
    expect(latest.messages.at(-1)?.text).toBe('수정된 중간 메시지');
    expect(Array.from(latest.messages[0].text).length).toBeLessThanOrEqual(MAX_PREVIEW_LENGTH + 1);
    expect(latest.messages[0].text).not.toMatch(/[\u001b\ufffd]/u);
    for (let i = 0; i <= MAX_TRACKED_TOOLS; i++) tracker.accept([{ type: 'tool', id: 'cmd' + i, category: 'command', state: 'completed' }], 'now');
    expect(tracker.accept([], 'now')).toMatchObject({ completed: { command: MAX_TRACKED_TOOLS }, limited: true });
  });

  it('keeps previews isolated by project/provider and independent of consumers and cancellation', () => {
    const records = new ModelActivities();
    const ids = ['A', 'B'].flatMap((projectPath) => (['codex', 'claude'] as const).map((provider) => records.begin({ projectPath, provider, phase: 'project-discussion-1' })));
    records.progress(ids[0], item('m', 'agent_message', 'item.completed', { text: 'A Codex만' }));
    records.progress(ids[0], item('c', 'command_execution', 'item.started'));
    expect(records.list().slice(1).every((record) => !record.progress)).toBe(true);
    const mutable = JSON.parse(JSON.stringify(records.list()));
    mutable[0].progress.messages[0].text = 'changed';
    const view = records.list()[0].progress!;
    Reflect.set(view.completed, 'command', 999);
    Reflect.set(view.messages[0], 'text', 'changed');
    expect(records.list()[0].progress?.messages[0].text).toBe('A Codex만');
    expect(records.list()[0].progress?.completed.command).toBe(0);
    records.cancel(ids[0]);
    records.progress(ids[0], item('c', 'command_execution'));
    expect(records.list()[0].state).toBe('cancelling');
    records.finish(ids[0], 'cancelled');
    expect(records.list()[0].progress?.running).toBe(0);
  });

  it('renders a bounded escaped intermediate preview, hidden after completion or disconnection', () => {
    const records = new ModelActivities();
    const id = records.begin({ projectPath: 'test', provider: 'codex', phase: 'project-discussion-1' });
    records.progress(id, item('cmd', 'command_execution'));
    records.progress(id, item('msg', 'agent_message', 'item.completed', { text: '<script>intermediate()</script> 문서를 검토합니다.' }));
    const live = records.list()[0];
    const html = renderToStaticMarkup(<PendingReply activity={live} provider="codex" connected />);
    expect(html).toContain('명령 완료 1'); expect(html).toContain('중간 메시지 · 최종 답변 아님');
    expect(html).toContain('문서를 검토합니다.'); expect(html).not.toContain('<script>');
    expect(renderToStaticMarkup(<PendingReply activity={live} provider="codex" connected={false} />)).not.toContain('문서를 검토합니다.');
    records.finish(id, 'completed');
    expect(renderToStaticMarkup(<PendingReply activity={records.list()[0]} provider="codex" connected />)).not.toContain('중간 메시지');
  });

  it('exports an isolated renderer fixture without any product data or live model requests', () => {
    const records = new ModelActivities(() => new Date().toISOString());
    const id = records.begin({ projectPath: 'fixture-only', provider: 'codex', phase: 'project-discussion-1' });
    records.start(id);
    for (let i = 0; i < 53; i++) records.progress(id, item('cmd-' + i, 'command_execution'));
    for (let i = 0; i < 9; i++) records.progress(id, item('search-' + i, 'web_search'));
    records.progress(id, item('public-1', 'agent_message', 'item.completed', { text: '추출한 문단과 원문을 대조하고 있습니다.' }));
    records.progress(id, item('public-2', 'agent_message', 'item.completed', { text: '객관식 문항의 정답 분포를 다시 계산하고 있습니다. 확인이 끝나면 수정 우선순위를 정리하겠습니다.\n\n' + '긴메시지줄바꿈확인'.repeat(90) }));
    records.progress(id, item('current', 'command_execution', 'item.started'));
    const activity = records.list()[0];
    const html = renderToStaticMarkup(<main className="fixture"><PendingReply provider="codex" activity={activity} connected />
      <PendingReply provider="claude" activity={{ ...activity, provider: 'claude', state: 'completed' }} connected /></main>);
    mkdirSync('work/live-progress-20261012', { recursive: true });
    writeFileSync('work/live-progress-20261012/desktop.html', `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${readFileSync('src/renderer/styles.css', 'utf8')}\nhtml,body{height:auto;overflow:auto}.fixture{padding:20px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.fixture>.model-activity{position:static;width:100%;max-width:100%;align-self:start}@media(max-width:700px){.fixture{grid-template-columns:minmax(0,1fr);padding:12px}}</style></head><body>${html}</body></html>`);
    expect(html).toContain('명령 완료 53');
  });
});
