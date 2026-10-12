import { describe, expect, it } from 'vitest';
import { newestTimestamp, recentProjects, projectsWithLiveActivity } from '../src/shared/project-order';
import type { ModelActivity } from '../src/shared/model-activity';

describe('project recency', () => {
  it('sorts by activity, preserves stable ties and does not mutate the registry list', () => {
    const items = [{ path: 'old', createdAt: '2026-10-01T00:00:00Z', lastActivityAt: '2026-10-12T02:00:00Z' },
      { path: 'new', createdAt: '2026-10-11T00:00:00Z' }, { path: 'unknown' }, { path: 'unknown2' }];
    expect(recentProjects(items).map((item) => item.path)).toEqual(['old', 'new', 'unknown', 'unknown2']);
    expect(items.map((item) => item.path)).toEqual(['old', 'new', 'unknown', 'unknown2']);
    expect(newestTimestamp('invalid', '2026-10-12T00:00:00Z', '2026-10-11T00:00:00Z')).toBe('2026-10-12T00:00:00Z');
  });
  it('counts real CLI output but not timer updates and keeps selection independent', () => {
    const items = [{ path: 'A', lastActivityAt: '2026-10-12T02:00:00Z' }, { path: 'B', lastActivityAt: '2026-10-12T01:00:00Z' }];
    const activity: ModelActivity = { id: 'b', projectPath: 'b', provider: 'claude', phase: 'project-discussion-1', state: 'running',
      startedAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T05:00:00Z' };
    expect(projectsWithLiveActivity(items, [activity]).map((item) => item.path)).toEqual(['A', 'B']);
    expect(projectsWithLiveActivity(items, [{ ...activity, lastOutputAt: '2026-10-12T03:00:00Z' }]).map((item) => item.path)).toEqual(['B', 'A']);
  });
});
