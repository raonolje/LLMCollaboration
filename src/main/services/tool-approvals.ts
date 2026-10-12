import { randomUUID } from 'node:crypto';
import type { ToolApproval } from '../../shared/types';
import { toolQuestions } from '../../shared/tool-questions';

export type ToolPermissionResult = { behavior: 'allow' | 'deny'; message?: string; updatedInput?: unknown };
export class ToolApprovals {
  private pending = new Map<string, { value: ToolApproval; settle: (allow: boolean, answers?: Record<string, string>) => void }>();
  list(): ToolApproval[] { return [...this.pending.values()].map(({ value }) => ({ ...value })); }
  request(projectPath: string, toolName: string, input: unknown, signal: AbortSignal): Promise<ToolPermissionResult> {
    if (signal.aborted) return Promise.resolve({ behavior: 'deny', message: '작업이 중단되었습니다.' });
    const id = randomUUID();
    const parameters = JSON.stringify(input ?? {});
    if (parameters.length > 100_000 || this.pending.size >= 100) return Promise.resolve({ behavior: 'deny', message: '도구 승인 요청 크기 또는 개수 제한을 초과했습니다.' });
    return new Promise((resolve) => {
      const settle = (allow: boolean, answers?: Record<string, string>): void => {
        signal.removeEventListener('abort', abort); this.pending.delete(id);
        resolve({ behavior: allow ? 'allow' : 'deny', ...(allow && answers ? { updatedInput: { ...JSON.parse(parameters), answers } } : {}), ...(!allow ? { message: '사용자가 이 도구 호출을 승인하지 않았습니다.' } : {}) });
      };
      const abort = (): void => settle(false);
      this.pending.set(id, { value: { id, projectPath, provider: 'claude', toolName, parameters, createdAt: new Date().toISOString() }, settle });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  respond(id: string, allow: boolean, answers?: Record<string, string>): void {
    if (typeof allow !== 'boolean') throw new Error('승인 여부를 선택하세요.');
    const request = this.pending.get(id);
    if (!request) throw new Error('이미 처리되거나 종료된 도구 승인 요청입니다.');
    const questions = toolQuestions(request.value);
    if (allow && questions.length && (!answers || questions.some((question) => typeof answers[question] !== 'string' || !answers[question].trim()))) throw new Error('각 질문의 답변을 입력하세요.');
    if (answers && (!questions.length || Object.values(answers).some((answer) => typeof answer !== 'string' || answer.length > 10_000)
      || Object.keys(answers).some((question) => !questions.includes(question)))) throw new Error('질문 답변 형식이 올바르지 않습니다.');
    request.settle(allow, answers);
  }
}
