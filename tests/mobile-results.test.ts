import { expect, it } from 'vitest';
import { finalResults } from '../mobile/results';
import type { Event, Task } from '../mobile/api';

it('preserves project decisions and complete task summaries without hiding later updates or inventing consensus', () => {
  const project: Event = { id: 'p', actor: 'claude', type: 'decision', message: '원문\n|끝|표|', timestamp: '2026-10-02', metadata: { discussionConclusion: true, consensusReached: false } };
  const task = { id: 't', title: '업무', description: '', status: 'ready', executor: { provider: 'codex', model: '' }, reviewer: { provider: 'claude', model: '' }, debateRounds: 2, debateSummary: '항목\n'.repeat(8) + '마지막 결론', updatedAt: '2026-10-03' } satisfies Task;
  const original = JSON.stringify([project, task]);
  const results = finalResults([project], [task]);
  expect(results).toHaveLength(2);
  expect(results[0].metadata?.consensusReached).toBe(false);
  expect(results[1].message).toBe(task.debateSummary);
  expect(results[1].metadata?.consensusReached).toBeUndefined();
  const decision: Event = { ...project, id: 'd', taskId: 't', message: task.debateSummary };
  expect(finalResults([project, decision], [task])).toHaveLength(2);
  expect(finalResults([project, { ...decision, message: '이전 요약' }], [task])).toHaveLength(3);
  expect(JSON.stringify([project, task])).toBe(original);
});
