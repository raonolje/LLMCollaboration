import type { Provider } from './types';

/** Recognize an explicit writer/reviewer assignment, never a bare mention of a model. */
export const assignedWriter = (text: string): Provider | undefined => {
  const sections = [...text.matchAll(/(코덱스|codex|클로드|claude)(?:는|은|에게|:|\s+(?=작성|제작|검수))\s*([^]*?)(?=(?:코덱스|codex|클로드|claude)(?:는|은|에게|:|\s+(?=작성|제작|검수))|$)/giu)];
  const writers = new Set<Provider>(); const reviewers = new Set<Provider>();
  for (const section of sections) {
    const provider: Provider = /코덱스|codex/iu.test(section[1]) ? 'codex' : 'claude';
    if (/생성|만들|작성|구현|수정/u.test(section[2]) && !/수정한.*(?:체크|검수|검증|확인)/u.test(section[2])) writers.add(provider);
    if (/체크|검수|검증|확인/u.test(section[2])) reviewers.add(provider);
  }
  const writer = [...writers][0];
  return writers.size === 1 && reviewers.has(writer === 'codex' ? 'claude' : 'codex') ? writer : undefined;
};
