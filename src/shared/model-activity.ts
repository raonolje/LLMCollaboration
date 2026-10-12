import type { Provider } from './types';

export type ToolCategory = 'command' | 'search' | 'file' | 'other';
export type ActivityProgress = Readonly<{
  completed: Readonly<Record<ToolCategory, number>>;
  running: number;
  failed: number;
  lastAction?: string;
  lastActionAt?: string;
  limited?: boolean;
  messages: readonly Readonly<{ id: string; text: string; at: string }>[];
}>;
export type ProgressDetail = Readonly<
  { type: 'tool'; id: string; category?: ToolCategory; state: 'running' | 'completed' | 'failed' }
  | { type: 'message'; id?: string; text: string }
>;

export type ModelActivity = Readonly<{
  id: string;
  projectPath: string;
  provider: Provider;
  taskId?: string;
  phase: string;
  state: 'queued' | 'starting' | 'running' | 'saving' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  startedAt: string;
  updatedAt: string;
  lastOutputAt?: string;
  processId?: number;
  signal?: 'output' | 'thinking' | 'tool' | 'compacting' | 'rate-limited';
  error?: string;
  progress?: ActivityProgress;
}>;

export type CliProgress = Readonly<{ kind: 'started' | 'exited' | NonNullable<ModelActivity['signal']>; processId?: number; details?: readonly ProgressDetail[] }>;
export const toolLabels: Readonly<Record<ToolCategory, string>> = { command: '명령', search: '검색', file: '파일 작업', other: '기타 도구' };
export const activityProgressText = (progress: ActivityProgress): string => [
  ...(['command', 'search', 'file', 'other'] as const).filter((key) => progress.completed[key] > 0)
    .map((key) => `${toolLabels[key]} 완료 ${progress.completed[key]}`),
  ...(progress.running ? [`도구 실행 중 ${progress.running}`] : []),
  ...(progress.failed ? [`도구 실패 ${progress.failed}`] : []),
].join(' · ');
export const activityIsLive = (activity: ModelActivity): boolean => ['queued', 'starting', 'running', 'saving', 'cancelling'].includes(activity.state);
export const latestActivity = (activities: readonly ModelActivity[], projectPath: string, provider: Provider): ModelActivity | undefined => {
  const matches = activities.filter((activity) => activity.projectPath.toLowerCase() === projectPath.toLowerCase() && activity.provider === provider);
  return matches.filter((activity) => activity.state === 'running' || activity.state === 'saving').at(-1)
    ?? matches.filter(activityIsLive).at(-1) ?? matches.at(-1);
};
export const activityLabel = (activity: ModelActivity): string => {
  if (activity.state === 'queued') return '실행 대기 중';
  if (activity.state === 'starting') return 'CLI 연결 중';
  if (activity.state === 'saving') return 'CLI 응답 종료 · 결과 저장 중';
  if (activity.state === 'cancelling') return '중단 요청 · CLI 종료 확인 중';
  if (activity.state === 'cancelled') return '중단됨';
  if (activity.state === 'failed') return '응답 실패 · 재시도 필요';
  if (activity.state === 'completed') return activity.phase === 'project-kickoff' ? '연결 확인 완료' : '이번 응답 완료';
  if (activity.signal === 'compacting') return '대화 맥락 정리 중';
  if (activity.signal === 'rate-limited') return '공급자 제한 · 대기 중';
  if (/review/u.test(activity.phase)) return '교차 검수 중';
  if (/discussion|debate/u.test(activity.phase)) return '토론 중';
  if (/execution|revision|file-work/u.test(activity.phase)) return '업무 실행 중';
  if (/planning/u.test(activity.phase)) return '업무 계획 중';
  return '검토 중 · 응답 생성 중';
};

/** Parse only public stream metadata; never expose prompts, tools' contents or reasoning. */
export const progressFromLine = (line: string): CliProgress['kind'] => {
  try {
    const record = JSON.parse(line) as { type?: string; subtype?: string; status?: string; item?: { type?: string }; message?: { content?: { type?: string }[] }; rate_limit_info?: { status?: string } };
    if (record.type === 'rate_limit_event') return record.rate_limit_info?.status === 'rejected' ? 'rate-limited' : 'output';
    if (record.subtype === 'status' && record.status === 'compacting') return 'compacting';
    if (record.subtype === 'thinking_tokens' || record.item?.type === 'reasoning'
      || record.message?.content?.some((item) => item.type === 'thinking')) return 'thinking';
    if (record.item?.type === 'command_execution' || record.item?.type === 'web_search'
      || record.message?.content?.some((item) => item.type === 'tool_use')) return 'tool';
  } catch { /* Non-JSON output is still observable activity. */ }
  return 'output';
};
