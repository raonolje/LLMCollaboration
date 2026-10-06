import { describe, expect, it } from 'vitest';
import { isManagedConversation, parseConversation } from '../src/main/services/conversation-import';

describe('external conversation parsing', () => {
  it('recognizes project-managed CLI sessions without hiding a personal chat', () => {
    const turns = (text: string) => [{ role: 'user' as const, text }];
    expect(isManagedConversation(turns('당신은 claude입니다. 다른 모델과 함께 같은 업무의 계획을 논쟁합니다.'))).toBe(true);
    expect(isManagedConversation(turns('당신은 이 업무의 실행 담당자입니다. 아래 업무를 실제 파일에 구현하세요.'))).toBe(true);
    expect(isManagedConversation(turns('프로젝트 테스트의 협업 대화를 시작합니다.'))).toBe(true);
    expect(isManagedConversation(turns('Follow the full task instructions supplied on standard input.\n프로젝트: 테스트\n목표: 검증'))).toBe(true);
    expect(isManagedConversation(turns('프로젝트: 테스트\n목표: 검증\n사용자 요청: 진행'))).toBe(true);
    expect(isManagedConversation(turns('내 프로젝트의 협업 대화 방식을 제안해 줘'))).toBe(false);
  });
  it('keeps Codex user and assistant text while excluding system and tool records', () => {
    const raw = [
      { type: 'session_meta', payload: { session_id: 'codex-session' } },
      { type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'hidden instructions' }] } },
      { type: 'response_item', timestamp: '2026-09-29T01:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Build a search page' }] } },
      { type: 'response_item', payload: { type: 'function_call', name: 'exec_command' } },
      { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'I built the page' }] } },
    ].map(JSON.stringify).join('\n');
    expect(parseConversation('codex', raw)).toEqual({ sessionId: 'codex-session', turns: [
      { role: 'user', text: 'Build a search page', timestamp: '2026-09-29T01:00:00Z' },
      { role: 'assistant', text: 'I built the page', timestamp: undefined },
    ] });
  });

  it('keeps Claude text while excluding thinking, tools, and tool results', () => {
    const raw = [
      { type: 'user', sessionId: 'claude-session', message: { role: 'user', content: 'Explain the plan' } },
      { type: 'assistant', sessionId: 'claude-session', message: { role: 'assistant', content: [
        { type: 'thinking', thinking: 'hidden' }, { type: 'text', text: 'Here is the plan' }, { type: 'tool_use', name: 'Read' },
      ] } },
      { type: 'user', sessionId: 'claude-session', message: { role: 'user', content: [{ type: 'tool_result', content: 'secret tool output' }] } },
    ].map(JSON.stringify).join('\n');
    expect(parseConversation('claude', raw).turns.map((turn) => turn.text)).toEqual(['Explain the plan', 'Here is the plan']);
  });
});
