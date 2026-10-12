import { describe, expect, it, vi } from 'vitest';
vi.mock('../mobile/node_modules/react-native/index.js', async () => import('../mobile/node_modules/react-native-web/dist/index.js'));
import React from '../mobile/node_modules/react/index.js';
import { renderToStaticMarkup } from '../mobile/node_modules/react-dom/server.node.js';
import { ActivityProgressCard } from '../mobile/ActivityProgressCard';
import type { ModelActivity } from '../src/shared/model-activity';

describe('mobile live activity preview', () => {
  const activity: ModelActivity = { id: 'activity', projectPath: 'fixture', provider: 'codex', phase: 'project-discussion-1', state: 'running',
    startedAt: '2026-10-12T11:00:00Z', updatedAt: '2026-10-12T11:01:00Z', progress: {
      completed: { command: 53, search: 9, file: 0, other: 0 }, running: 1, failed: 0,
      messages: [{ id: 'message', text: '원문을 검토 중입니다. <script>unsafe</script>', at: '2026-10-12T11:01:00Z' }],
    } };
  it('shows public progress as escaped text with a non-final label', () => {
    const html = renderToStaticMarkup(React.createElement(ActivityProgressCard, { activity, connected: true }));
    expect(html).toContain('명령 완료 53'); expect(html).toContain('검색 완료 9'); expect(html).toContain('도구 실행 중 1');
    expect(html).toContain('최종 답변 아님'); expect(html).toContain('원문을 검토 중입니다.'); expect(html).not.toContain('<script>');
  });
  it('hides stale previews for disconnected, completed, queued-without-output and legacy hosts', () => {
    for (const props of [{ activity, connected: false }, { activity: { ...activity, state: 'completed' as const }, connected: true },
      { activity: { ...activity, progress: undefined }, connected: true }]) {
      expect(renderToStaticMarkup(React.createElement(ActivityProgressCard, props))).toBe('');
    }
  });
});
