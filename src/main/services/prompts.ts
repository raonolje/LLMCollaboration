import type { CollaborationEvent, Project, Provider, Task } from '../../shared/types';

const compact = (value: string, max = 18_000): string =>
  value.length > max ? `${value.slice(0, max)}\n… (전체 원문은 프로젝트 기록에 보존됨)` : value;

const list = (values: readonly string[]): string =>
  values.length ? values.map((value, index) => `${index + 1}. ${value}`).join('\n') : '없음';

export const taskCard = (project: Project, task: Task, events: readonly CollaborationEvent[]): string => {
  const relevant = events
    .filter((event) => event.taskId === task.id)
    .slice(-28)
    .map((event) => `[${event.timestamp}] ${event.actor}/${event.type}${event.round ? `/${event.round}회차` : ''}: ${compact(event.message, 2200)}`)
    .join('\n\n');
  return [
    '## 변하지 않는 프로젝트 기준',
    `프로젝트: ${project.name}`,
    `프로젝트 목표: ${compact(project.goal, 2000)}`,
    `프로젝트 헌장/제약: ${compact(project.charter || '아직 별도 헌장 없음', 4000)}`,
    '## 현재 업무 카드',
    `업무 ID: ${task.id}`,
    `업무: ${task.title}`,
    `설명: ${compact(task.description, 3000)}`,
    `완료 기준:\n${compact(list(task.acceptanceCriteria), 3000)}`,
    `선행 업무 ID: ${task.dependsOn.join(', ') || '없음'}`,
    `수행: ${task.executor.provider}/${task.executor.model || '기본 모델'}`,
    `검수: ${task.reviewer.provider}/${task.reviewer.model || '기본 모델'}`,
    `현재 상태: ${task.status}`,
    `토론 요약: ${compact(task.debateSummary || '아직 없음', 3000)}`,
    `검수 요약: ${compact(task.reviewSummary || '아직 없음', 2000)}`,
    '## 가져온 대화의 작업 맥락',
    compact(task.sourceContext || '연결된 대화 없음', 28_000),
    '## 이 업무의 최근 원문 기록',
    compact(relevant || '기록 없음', 10_000),
    '위 프로젝트 기준과 업무 카드는 매 요청마다 다시 전달됩니다. 최근 기록은 맥락이며, 원문 전체는 프로젝트 기록에 보존됩니다.',
  ].join('\n\n');
};

export const debatePrompt = (
  project: Project,
  task: Task,
  events: readonly CollaborationEvent[],
  provider: Provider,
  stage: 'proposal' | 'critique' | 'response' | 'evaluation' | 'followUp',
  round?: number,
  question?: string,
): string => {
  const actions = {
    proposal: '독립적으로 업무 접근법을 제안하세요. 핵심 결정, 근거, 예상 실패 조건, 검증 방법을 명시하세요.',
    critique: '상대 모델의 제안과 근거를 검토하세요. 빠진 조건, 잘못된 가정, 더 나은 대안을 구체적으로 지적하고 상대가 답해야 할 질문을 제시하세요.',
    response: '상대의 반론에 답하고, 상대의 직전 답변도 평가하세요. 수용할 지적은 수용하고 계획을 수정하세요. 동의하지 않는 지적은 근거를 제시하세요.',
    evaluation: '상대의 최신 답변이 반론에 충분히 답했는지 평가하세요. 합의점, 미해결 쟁점, 권장 실행안과 검증 기준을 구분해 마무리하세요.',
    followUp: `사용자가 추가로 물었습니다: ${question || ''}\n이 질문에 직접 답하고 기존 계획에 필요한 수정을 설명하세요.`,
  } as const;
  return [
    `당신은 ${provider}입니다. 다른 모델과 함께 같은 업무의 계획을 논쟁합니다.`,
    '작업 폴더를 수정하지 마세요. 근거 없는 합의나 상대 입장 추측을 피하세요.',
    `현재 단계: ${stage}${round ? `, ${round}회차` : ''}`,
    actions[stage],
    taskCard(project, task, events),
  ].join('\n\n');
};

export const executionPrompt = (project: Project, task: Task, events: readonly CollaborationEvent[]): string => [
  '당신은 이 업무의 실행 담당자입니다. 아래 업무를 실제 파일에 구현하세요.',
  '현재 작업 폴더는 해당 업무 전용 Git worktree입니다. 프로젝트의 .llm-collaboration 폴더는 앱의 기록이므로 수정하지 마세요.',
  '완료 기준을 하나씩 충족하고 필요한 검증을 실행하세요. 다른 업무나 프로젝트 폴더 외부 파일은 수정하지 마세요.',
  '마지막 답변에는 수행 내용, 검증 명령과 결과, 미완료 항목, 수정 파일을 명시하세요.',
  taskCard(project, task, events),
].join('\n\n');

export const reviewPrompt = (
  project: Project,
  task: Task,
  events: readonly CollaborationEvent[],
  changedFiles: readonly string[],
  executionSummary: string,
): string => [
  '당신은 다른 모델이 구현한 결과의 독립 검수자입니다. 파일을 수정하지 마세요.',
  '완료 기준마다 실제 코드나 산출물의 증거를 확인하세요. 중요한 문제만 지적하세요.',
  '첫 줄에는 반드시 `APPROVED` 또는 `CHANGES_REQUESTED` 중 하나만 쓰세요.',
  '그 뒤에 기준별 평가, 파일 경로와 근거, 필요한 수정 사항을 적으세요.',
  `변경 파일:\n${list(changedFiles)}`,
  `실행 담당자 보고:\n${compact(executionSummary, 12_000)}`,
  taskCard(project, task, events),
].join('\n\n');
