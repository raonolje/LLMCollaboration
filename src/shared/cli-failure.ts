/** Failure records are errors, even when Claude emits them as assistant text. */
export const cliFailure = (value: unknown): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, any>;
  if (record.error === 'authentication_failed') {
    return 'Claude 로그인 세션이 만료됐습니다. Claude CLI에서 다시 로그인한 뒤 검수를 재시도하세요. 기존 답변과 파일은 보존됩니다.';
  }
  if (record.type === 'error' || record.type === 'turn.failed') {
    const text = record.error?.message ?? record.message;
    if (typeof text === 'string') return text.slice(-2000);
  }
  if (record.type === 'assistant' && record.is_api_error_message) {
    const text = record.message?.content?.filter((part: any) => part?.type === 'text' && typeof part.text === 'string').map((part: any) => part.text).join('\n');
    if (text) return text.slice(-2000);
  }
  if (record.type === 'result' && record.is_error && Array.isArray(record.errors)) {
    return record.errors.filter((item: unknown) => typeof item === 'string').join('\n').slice(-2000) || undefined;
  }
  return undefined;
};
