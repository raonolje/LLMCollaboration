import { randomUUID } from 'node:crypto';
import type { CliProgress, ModelActivity } from '../../shared/model-activity';
import { activityIsLive } from '../../shared/model-activity';
import { ActivityProgressTracker } from './activity-progress';

export class ModelActivities {
  private readonly records = new Map<string, ModelActivity>();
  private readonly trackers = new Map<string, ActivityProgressTracker>();
  constructor(private readonly clock = (): string => new Date().toISOString()) {}
  begin(input: Pick<ModelActivity, 'projectPath' | 'provider' | 'phase' | 'taskId'>): string {
    const id = randomUUID(), timestamp = this.clock();
    this.records.set(id, { ...input, id, state: 'queued', startedAt: timestamp, updatedAt: timestamp });
    return id;
  }
  start(id: string): void {
    // A resumed-session conflict can retry with a fresh CLI whose item IDs start over.
    this.trackers.delete(id);
    this.update(id, { state: 'starting', signal: undefined, processId: undefined, lastOutputAt: undefined, progress: undefined });
  }
  cancel(id: string): void {
    const current = this.records.get(id);
    if (current && activityIsLive(current)) this.update(id, { state: current.state === 'queued' ? 'cancelled' : 'cancelling' });
  }
  progress(id: string, signal: CliProgress): void {
    const current = this.records.get(id);
    if (!current || !activityIsLive(current)) return;
    let tracker = this.trackers.get(id);
    if (signal.details?.length && !tracker) { tracker = new ActivityProgressTracker(); this.trackers.set(id, tracker); }
    const progress = signal.kind === 'exited' ? tracker?.stop()
      : signal.details?.length ? tracker?.accept(signal.details, this.clock()) : undefined;
    this.update(id, { state: current.state === 'cancelling' ? 'cancelling' : signal.kind === 'exited' ? 'saving' : 'running', ...(signal.processId ? { processId: signal.processId } : {}),
      ...(progress ? { progress } : {}),
      ...(signal.kind === 'started' || signal.kind === 'exited' ? {} : { signal: signal.kind, lastOutputAt: this.clock() }) });
  }
  finish(id: string, state: 'completed' | 'cancelled' | 'failed', error?: string): void {
    if (this.records.get(id)?.state === 'cancelled' && state !== 'cancelled') return;
    const progress = this.trackers.get(id)?.stop();
    this.trackers.delete(id);
    this.update(id, { state, error, ...(progress ? { progress } : {}) });
    const terminal = [...this.records.values()].filter((record) => !activityIsLive(record));
    terminal.slice(0, Math.max(0, terminal.length - 200)).forEach((record) => this.records.delete(record.id));
  }
  list(): ModelActivity[] { return [...this.records.values()].map((record) => ({ ...record,
    ...(record.progress ? { progress: { ...record.progress, completed: { ...record.progress.completed }, messages: record.progress.messages.map((message) => ({ ...message })) } } : {}) })); }
  private update(id: string, patch: Partial<ModelActivity>): void {
    const current = this.records.get(id);
    if (current) this.records.set(id, { ...current, ...patch, updatedAt: this.clock() });
  }
}
