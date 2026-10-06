import type { Event, Task } from './api';

/** Display a saved summary when no matching decision exists; never change the stored events. */
export function finalResults(events: readonly Event[], tasks: readonly Task[], fallbackTimestamp = ''): Event[] {
  const decisions = events.filter((event) => event.type === 'decision'
    && (!!event.taskId || event.metadata?.discussionConclusion === true));
  const saved = tasks.filter((task) => !!task.debateSummary
    && !decisions.some((event) => event.taskId === task.id && event.message === task.debateSummary))
    .map((task): Event => ({
      id: `saved-${task.id}`, actor: task.reviewer.provider, type: 'decision', taskId: task.id,
      timestamp: task.updatedAt ?? fallbackTimestamp, message: task.debateSummary!, metadata: { savedSummary: true },
    }));
  return [...decisions, ...saved].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}
