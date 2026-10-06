export type DebateSummary = Readonly<{
  agreements: readonly string[];
  disagreements: readonly string[];
  nextSteps: readonly string[];
}>;

type Section = keyof DebateSummary;

export const isNoDisagreement = (value: string): boolean => {
  const text = value.replace(/[*_`]/gu, '').trim();
  if (/(?:아직|하지만|그러나|제외|미해결|불일치|확인 필요|없다고|없음이라고|없지|없지는)/u.test(text)) return false;
  return /^(?:없음|없다|해당 없음)(?:[.!。\s]*|\s*[—–-]\s*[^\n]+)$/u.test(text)
    || /^(?:모델 간 |설계상 |설계 |남은 |핵심 )*(?:설계 )?(?:이견|쟁점)(?:은|는|이|가)?\s*(?:없습니다|없음|없다)[.!。\s]*$/u.test(text);
};

export const explicitlyAgreed = (message: string): boolean => {
  const summary = parseDebateSummary(message);
  return summary.agreements.length > 0 && summary.disagreements.length > 0
    && summary.disagreements.every(isNoDisagreement);
};

export const bilateralConsensus = (messages: readonly string[]): boolean | null => {
  if (messages.length !== 2) return null;
  if (messages.every(explicitlyAgreed)) return true;
  if (messages.some((message) => parseDebateSummary(message).disagreements.some((issue) => !isNoDisagreement(issue)))) return false;
  return null;
};

export const finalConsensus = (messages: readonly string[], conclusion: string): boolean | null => {
  const pair = bilateralConsensus(messages);
  if (pair === false || parseDebateSummary(conclusion).disagreements.some((issue) => !isNoDisagreement(issue))) return false;
  return pair === true && explicitlyAgreed(conclusion) ? true : null;
};

export const consensusLabel = (metadata?: Record<string, unknown>): string =>
  metadata?.consensusReached === true ? '양측 합의 확인'
    : metadata?.consensusReached === false ? '미합의 · 남은 이견 확인'
      : '최종 결과 · 합의 여부 미판정';

const sectionFor = (line: string, explicit = false): Section | null => {
  const isHeading = explicit || /^(?:#{1,6}\s|\*\*|\d+[.)]\s)/u.test(line) || /[:：]\s*$/u.test(line)
    || line.length <= 24 && !/[-*•]\s/u.test(line);
  if (!isHeading) return null;
  const heading = line.trim().replace(/^#{1,6}\s*/u, '').replace(/^\*{1,2}|\*{1,2}$/gu, '')
    .replace(/^\d+[.)]\s*/u, '').replace(/[:：]\s*$/u, '').trim();
  if (heading.length > 48) return null;
  if (/(?:남은|미해결|서로 다른|불일치|의견 차이|이견|쟁점)/u.test(heading)) return 'disagreements';
  if (/(?:합의|공통|동의|일치)/u.test(heading)) return 'agreements';
  if (/(?:다음|후속|실행|검증|권장|사용자 판단|결정 필요)/u.test(heading)) return 'nextSteps';
  return null;
};

const cleanItem = (line: string): string => {
  const item = line.trim().replace(/^(?:[-*•]|\d+[.)])\s+/u, '').trim();
  return /^\*\*[^*]+\*\*$/u.test(item) ? item.slice(2, -2) : item;
};

export const parseDebateSummary = (message: string): DebateSummary => {
  const initial: { section: Section | null; result: Record<Section, string[]> } = {
    section: null, result: { agreements: [], disagreements: [], nextSteps: [] },
  };
  const { result } = message.split(/\r?\n/u).reduce((state, rawLine) => {
    const line = rawLine.trim();
    if (!line) return state;
    const inline = line.match(/^(?:#{1,6}\s*|\d+[.)]\s*)?\*{0,2}([^:*：]{2,48})\*{0,2}\s*[:：]\s*(.+)$/u);
    const heading = sectionFor(inline ? inline[1] : line, !!inline);
    if (heading) {
      const item = inline ? cleanItem(inline[2]) : '';
      return { section: heading, result: item ? { ...state.result, [heading]: [...state.result[heading], item] } : state.result };
    }
    if (!state.section || /^#{1,6}\s/u.test(line)) return { ...state, section: null };
    const item = cleanItem(line);
    const items = state.result[state.section];
    if (/^\|.*\|$/u.test(item) && /^\|/u.test(items.at(-1) ?? '')) {
      return { ...state, result: { ...state.result, [state.section]: [...items.slice(0, -1), `${items.at(-1)}\n${item}`] } };
    }
    return { ...state, result: item ? { ...state.result, [state.section]: [...state.result[state.section], item] } : state.result };
  }, initial);
  return result;
};
