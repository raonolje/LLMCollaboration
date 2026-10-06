import { describe, expect, it } from 'vitest';
import {
  debatePrompt,
  executionPrompt,
  reviewPrompt,
  taskCard,
} from '../src/main/services/prompts';
import type { CollaborationEvent, Project, Task } from '../src/shared/types';

const project: Project = {
  id: 'project-one',
  name: 'Shared Product',
  path: '/an/example/project',
  goal: 'Ship a working reviewed feature',
  charter: 'Preserve all debate and work history',
  defaultDebateRounds: 2,
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
};

const task: Task = {
  id: 'task-one',
  title: 'Build searchable history',
  description: 'Search project events by content',
  acceptanceCriteria: ['Persist every event', 'Search events without losing source text'],
  mode: 'manual',
  executor: { provider: 'codex', model: 'gpt-example' },
  reviewer: { provider: 'claude', model: 'claude-example' },
  dependsOn: ['task-zero'],
  debateRounds: 2,
  status: 'reviewing',
  createdAt: '2026-09-29T00:00:00.000Z',
  updatedAt: '2026-09-29T00:00:00.000Z',
  debateSummary: 'Use a local event index',
  reviewSummary: 'Check the stored source',
  artifacts: [],
};

const event = (id: number, taskId = task.id, message = `event-${id}`): CollaborationEvent => ({
  id: `event-${id}`,
  projectId: project.id,
  taskId,
  actor: id % 2 === 0 ? 'codex' : 'claude',
  type: 'response',
  message,
  timestamp: `2026-09-29T00:00:${String(id).padStart(2, '0')}.000Z`,
  round: 2,
});

describe('context carried across model calls', () => {
  it('retains the project charter, acceptance criteria, assigned models, and dependency', () => {
    const card = taskCard(project, task, []);
    expect(card).toContain(project.goal);
    expect(card).toContain(project.charter);
    expect(task.acceptanceCriteria.map((criterion) => card.includes(criterion))).toEqual([true, true]);
    expect(card).toContain('수행: codex/gpt-example');
    expect(card).toContain('검수: claude/claude-example');
    expect(card).toContain('선행 업무 ID: task-zero');
    expect(card).toContain('현재 상태: reviewing');
    expect(card).toContain(task.debateSummary);
    expect(card).toContain(task.reviewSummary);
  });

  it('uses only recent records for the current task and explicitly signals truncation', () => {
    const otherTask = event(50, 'other-task', 'OTHER_TASK_PRIVATE_CONTEXT');
    const lengthy = event(51, task.id, `begin:${'x'.repeat(2_300)}:end-marker`);
    const events = [...Array.from({ length: 30 }, (_, id) => event(id)), otherTask, lengthy];
    const card = taskCard(project, task, events);

    expect(card).not.toContain('event-0\n');
    expect(card).not.toContain('event-1\n');
    expect(card).toContain('event-29');
    expect(card).not.toContain('OTHER_TASK_PRIVATE_CONTEXT');
    expect(card).toContain('begin:');
    expect(card).not.toContain(':end-marker');
    expect(card).toContain('전체 원문은 프로젝트 기록에 보존됨');
  });

  it('keeps both models\u2019 latest debate responses when earlier turns are long', () => {
    const events = Array.from({ length: 9 }, (_, id) => event(id, task.id,
      `turn-${id}-start ${'x'.repeat(2_100)} turn-${id}-end`));
    const card = taskCard(project, task, events);

    expect(card).toContain('turn-0-start');
    expect(card).toContain('turn-7-start');
    expect(card).toContain('turn-8-start');
    expect(card).toContain('.llm-collaboration');
    expect(card).toContain('events.jsonl');
  });

  it('repeats stable task context through debate, execution, and review prompts', () => {
    const events = [event(1)];
    const prompts = [
      debatePrompt(project, task, events, 'codex', 'proposal', 1),
      debatePrompt(project, task, events, 'claude', 'critique', 1),
      debatePrompt(project, task, events, 'codex', 'response', 2),
      debatePrompt(project, task, events, 'claude', 'evaluation', 2),
      executionPrompt(project, task, events),
      reviewPrompt(project, task, events, ['src/search.ts'], 'Implemented search'),
    ];

    expect(prompts.map((prompt) => prompt.includes(project.charter))).toEqual(Array(6).fill(true));
    expect(prompts.map((prompt) => prompt.includes(task.acceptanceCriteria[1]))).toEqual(Array(6).fill(true));
    expect(prompts.map((prompt) => prompt.includes('event-1'))).toEqual(Array(6).fill(true));
    expect(prompts.map((prompt) => prompt.includes('한국어로'))).toEqual(Array(6).fill(true));
    expect(prompts[1]).toContain('상대 모델의 제안과 근거를 검토');
    expect(prompts[2]).toContain('상대의 직전 답변도 평가');
    expect(prompts[3]).toContain('상대의 최신 답변이 반론에 충분히 답했는지 평가');
    expect(prompts[4]).toContain('실제 파일에 구현');
    expect(prompts[5]).toContain('독립 검수자');
  });

  it('includes the exact user follow-up and an evidence-based cross-review contract', () => {
    const question = '성능 병목을 재측정하고 대안을 서로 반박하세요.';
    const followUp = debatePrompt(project, task, [], 'claude', 'followUp', 3, question);
    const review = reviewPrompt(project, task, [], ['src/search.ts', 'docs/search.md'], 'Verified with local tests');

    expect(followUp).toContain(question);
    expect(followUp).toContain('3회차');
    expect(review).toContain('파일을 수정하지 마세요');
    expect(review).toContain('APPROVED');
    expect(review).toContain('CHANGES_REQUESTED');
    expect(review).toContain('src/search.ts');
    expect(review).toContain('docs/search.md');
    expect(review).toContain('Verified with local tests');
  });
});
