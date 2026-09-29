export type DebateSummary = Readonly<{
  agreements: readonly string[];
  disagreements: readonly string[];
  nextSteps: readonly string[];
}>;

type Section = keyof DebateSummary;

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

const cleanItem = (line: string): string => line.trim()
  .replace(/^(?:[-*•]|\d+[.)])\s*/u, '')
  .replace(/^\*{1,2}|\*{1,2}$/gu, '').trim();

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
    return { ...state, result: item ? { ...state.result, [state.section]: [...state.result[state.section], item] } : state.result };
  }, initial);
  return result;
};
