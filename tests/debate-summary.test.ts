import { describe, expect, it } from 'vitest';
import { parseDebateSummary } from '../src/shared/debate-summary';

describe('debate summary', () => {
  it('keeps agreed points, unresolved differences, and next steps separate', () => {
    const message = [
      '## 합의된 사항', '- 캐릭터 의상은 모든 씬에서 유지한다.', '- 배경 색을 통일한다.',
      '## 남은 이견', '- Codex는 빠른 컷 전환, Claude는 긴 숏을 선호한다.',
      '## 다음 지시·검증', '- 1안과 2안을 비교한다.',
      '## 상세 콘티', '- 이 내용은 요약에 섞이지 않는다.',
    ].join('\n');
    expect(parseDebateSummary(message)).toEqual({
      agreements: ['캐릭터 의상은 모든 씬에서 유지한다.', '배경 색을 통일한다.'],
      disagreements: ['Codex는 빠른 컷 전환, Claude는 긴 숏을 선호한다.'],
      nextSteps: ['1안과 2안을 비교한다.'],
    });
  });

  it('does not infer agreement from an unstructured conclusion', () => {
    expect(parseDebateSummary('두 모델이 검토했습니다. 합의가 있는지 명확하지 않습니다.')).toEqual({
      agreements: [], disagreements: [], nextSteps: [],
    });
  });

  it('accepts inline headings in older records', () => {
    expect(parseDebateSummary('**합의점**: 파일은 로컬에 저장\n**미해결 쟁점**: 배포 방식\n**검증 방법**: 두 환경에서 실행')).toEqual({
      agreements: ['파일은 로컬에 저장'], disagreements: ['배포 방식'], nextSteps: ['두 환경에서 실행'],
    });
  });
});
