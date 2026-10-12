import { randomUUID } from 'node:crypto';
import { MAX_PREVIEW_MESSAGES, publicPreview } from '../../shared/cli-progress';
import { toolLabels, type ActivityProgress, type ProgressDetail, type ToolCategory } from '../../shared/model-activity';

export const MAX_TRACKED_TOOLS = 4096;

/** Per-invocation, bounded, in-memory display state. Never participates in task completion. */
export class ActivityProgressTracker {
  private readonly tools = new Map<string, { category: ToolCategory; state: 'running' | 'completed' | 'failed' }>();
  private value: ActivityProgress = { completed: { command: 0, search: 0, file: 0, other: 0 }, running: 0, failed: 0, messages: [] };

  accept(details: readonly ProgressDetail[], at: string): ActivityProgress {
    for (const detail of details) {
      if (detail.type === 'message') {
        const text = publicPreview(detail.text);
        if (!text) continue;
        const previous = this.value.messages.find((item) => detail.id ? item.id === detail.id : item.text === text);
        if (previous?.text === text) continue;
        const entry = { id: detail.id ?? previous?.id ?? randomUUID(), text, at };
        this.value = { ...this.value, lastAction: '중간 메시지 수신', lastActionAt: at,
          messages: [...this.value.messages.filter((item) => item.id !== entry.id), entry].slice(-MAX_PREVIEW_MESSAGES) };
        continue;
      }
      const previous = this.tools.get(detail.id);
      if (previous && (previous.state !== 'running' || previous.state === detail.state)) continue;
      if (!previous && this.tools.size >= MAX_TRACKED_TOOLS) {
        this.value = { ...this.value, limited: true };
        continue;
      }
      const category = previous?.category ?? detail.category ?? 'other';
      this.tools.set(detail.id, { category, state: detail.state });
      this.value = { ...this.value,
        running: this.value.running + (detail.state === 'running' ? 1 : previous ? -1 : 0),
        completed: { ...this.value.completed, [category]: this.value.completed[category] + (detail.state === 'completed' ? 1 : 0) },
        failed: this.value.failed + (detail.state === 'failed' ? 1 : 0),
        lastAction: toolLabels[category] + (detail.state === 'running' ? ' 실행 시작' : detail.state === 'failed' ? ' 실패' : ' 완료'),
        lastActionAt: at,
      };
    }
    return this.snapshot();
  }

  stop(): ActivityProgress { this.value = { ...this.value, running: 0 }; return this.snapshot(); }
  private snapshot(): ActivityProgress {
    return { ...this.value, completed: { ...this.value.completed }, messages: this.value.messages.map((message) => ({ ...message })) };
  }
}
