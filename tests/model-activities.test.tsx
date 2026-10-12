import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ModelActivities } from '../src/main/services/model-activities';
import { activityLabel, latestActivity, progressFromLine } from '../src/shared/model-activity';
import { PendingReply } from '../src/renderer/PendingReply';
import { queryActivity } from '../src/shared/activity-query';

describe('actual model activity', () => {
  it('offers scoped stop only for a connected live request even without a renderer send promise', () => {
    const base = { id: 'remote', projectPath: 'film', provider: 'codex' as const, phase: 'project-discussion-2', state: 'running' as const,
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const render = (state: typeof base.state | 'completed' | 'cancelling', connected = true) => renderToStaticMarkup(<PendingReply provider="codex" activity={{ ...base, state }} connected={connected} onStop={() => undefined} />);
    expect(render('running')).toContain('이 프로젝트 토론·응답 중단');
    expect(render('completed')).not.toContain('<button');
    expect(render('running', false)).not.toContain('<button');
    expect(render('cancelling')).toContain('disabled');
    expect(renderToStaticMarkup(<PendingReply provider="codex" activity={{ ...base, taskId: 'task' }} connected onStop={() => undefined} />)).toContain('이 업무 중단');
  });
  it('shows timing only for connected live responses and keeps failure details without ticking completed responses', () => {
    const base = { id: 'activity', projectPath: 'tarot', provider: 'codex' as const, phase: 'project-discussion-2',
      startedAt: '2026-10-12T08:00:00Z', updatedAt: '2026-10-12T09:00:00Z', lastOutputAt: '2026-10-12T08:59:00Z', processId: 123 };
    for (const state of ['completed', 'failed', 'cancelled'] as const) {
      const html = renderToStaticMarkup(<PendingReply provider="codex" activity={{ ...base, state }} connected />);
      expect(html).not.toContain('경과'); expect(html).not.toContain('CLI PID'); expect(html).not.toContain('마지막 CLI');
    }
    expect(renderToStaticMarkup(<PendingReply provider="codex" activity={{ ...base, state: 'running' }} connected />)).toContain('신호 이후');
    expect(renderToStaticMarkup(<PendingReply provider="codex" activity={{ ...base, state: 'running' }} connected={false} />)).not.toContain('경과');
    expect(activityLabel({ ...base, state: 'completed', phase: 'project-kickoff' })).toBe('연결 확인 완료');
  });
  it('times out a disconnected UI query without cancelling the model request', async () => {
    vi.useFakeTimers();
    const signal = new AbortController();
    const result = queryActivity(() => new Promise(() => undefined), 1000);
    const assertion = expect(result).rejects.toThrow('상태 조회');
    try { await vi.advanceTimersByTimeAsync(1000); await assertion; expect(signal.signal.aborted).toBe(false); }
    finally { vi.useRealTimers(); }
  });
  it('keeps three projects and both providers independent beyond one hour and across selection changes', () => {
    let clock = '2026-10-12T07:53:38Z';
    const activities = new ModelActivities(() => clock);
    const ids = ['tarot', 'rfg', 'film'].flatMap((projectPath) => (['codex', 'claude'] as const).map((provider) =>
      activities.begin({ projectPath, provider, phase: 'project-discussion-1' })));
    ids.forEach((id, index) => { activities.start(id); activities.progress(id, { kind: 'started', processId: index + 1 }); });
    clock = '2026-10-12T09:53:38Z';
    activities.progress(ids[0], { kind: 'tool' });
    const before = latestActivity(activities.list(), 'tarot', 'codex');
    expect(latestActivity(activities.list(), 'rfg', 'claude')?.state).toBe('running');
    expect(latestActivity(activities.list(), 'tarot', 'codex')).toEqual(before);
    vi.useFakeTimers(); vi.setSystemTime(new Date(clock));
    try {
      const html = renderToStaticMarkup(<PendingReply provider="codex" activity={before} connected />);
      expect(html).toContain('토론 중'); expect(html).toContain('120');
      expect(html).toContain('CLI PID');
      expect(renderToStaticMarkup(<PendingReply provider="codex" activity={before} connected={false} />)).toContain('연결 끊김');
    } finally { vi.useRealTimers(); }
  });
  it('separates compaction, queued work, cancellation request, confirmed exit and provider failure', () => {
    const activities = new ModelActivities();
    const id = activities.begin({ projectPath: 'tarot', provider: 'claude', phase: 'project-discussion-2' });
    activities.start(id); activities.progress(id, { kind: 'started', processId: 99 });
    const waiting = activities.begin({ projectPath: 'tarot', provider: 'claude', phase: 'project-discussion-3' });
    expect(latestActivity(activities.list(), 'tarot', 'claude')?.id).toBe(id);
    activities.progress(id, { kind: 'compacting' });
    expect(activityLabel(activities.list()[0])).toContain('맥락 정리');
    activities.cancel(id); expect(activities.list()[0].state).toBe('cancelling');
    activities.progress(id, { kind: 'thinking' }); expect(activities.list()[0].state).toBe('cancelling');
    activities.finish(id, 'cancelled');
    activities.progress(id, { kind: 'tool' }); expect(activities.list()[0].state).toBe('cancelled');
    activities.cancel(waiting); expect(activities.list()[1].state).toBe('cancelled');
    const failed = activities.begin({ projectPath: 'rfg', provider: 'codex', phase: 'cross-review-1' });
    activities.finish(failed, 'failed', 'CLI exited 1');
    expect(activityLabel(activities.list()[2])).toContain('응답 실패');
  });
  it('exposes stream activity types without prompts, reasoning text or tool inputs', () => {
    expect(progressFromLine(JSON.stringify({ type: 'system', subtype: 'status', status: 'compacting' }))).toBe('compacting');
    expect(progressFromLine(JSON.stringify({ type: 'system', subtype: 'thinking_tokens', text: 'private reasoning' }))).toBe('thinking');
    expect(progressFromLine(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'private command' } }))).toBe('tool');
    expect(progressFromLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } }))).toBe('output');
    expect(progressFromLine(JSON.stringify({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected' } }))).toBe('rate-limited');
  });
});
