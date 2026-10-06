import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { discussionContext, conclusionProvider } from '../src/main/services/discussion-context';
import { consensusLabel, explicitlyAgreed, finalConsensus, parseDebateSummary } from '../src/shared/debate-summary';
import type { CollaborationEvent } from '../src/shared/types';

const record = (id: string, actor: 'codex' | 'claude', message: string): CollaborationEvent => ({
  id, actor, message, type: 'chat', timestamp: '2026-10-02T00:00:00Z', projectId: 'fixture', metadata: { discussionRound: 1 },
});

describe('immutable discussion context', () => {
  it('preserves both complete tables beyond the old truncation boundary and deduplicates events', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'llm-context-'));
    try {
      const codex = record('c', 'codex', '본문'.repeat(5000) + '\n| 컷 | 수정 |\n|---|---|\n| 200 | 철회 |');
      const claude = record('a', 'claude', '## 남은 이견\n- 마지막 컷 색감\n| 컷 | 대안 |\n|---|---|\n|200|파랑|');
      const prompt = await discussionContext(folder, [codex, claude, codex]);
      expect(prompt).toContain(codex.message);
      expect(prompt).toContain(claude.message);
      const directory = path.join(folder, '.llm-collaboration', 'contexts');
      const files = await readdir(directory);
      const full = await readFile(path.join(directory, files[0]), 'utf8');
      expect(full.match(/이벤트 ID: c/g)).toHaveLength(1);
      await discussionContext(folder, [codex, claude, codex]);
      expect(await readdir(directory)).toEqual(files);
      const large = await discussionContext(folder, [record('large', 'codex', '본문'.repeat(60000) + '|마지막 표|'), claude]);
      expect(large.length).toBeLessThan(50_000);
      expect(large).toContain('입력 크기 제한');
      const all = await Promise.all((await readdir(directory)).map((file) => readFile(path.join(directory, file), 'utf8')));
      expect(all.some((text) => text.endsWith('|200|파랑|') && text.includes('|마지막 표|'))).toBe(true);
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});

describe('recorded consensus and reporting', () => {
  it('accepts decorated explicit no-disagreement but rejects missing, mixed and qualified uncertainty', () => {
    const reply = (issue: string) => `## 합의된 사항\n- 표 반영\n## 남은 이견\n- ${issue}`;
    expect(explicitlyAgreed(reply('**없음** — 모델 간 설계 쟁점 기준'))).toBe(true);
    expect(explicitlyAgreed(reply('모델 간 설계 이견은 없습니다.'))).toBe(true);
    expect(explicitlyAgreed(reply('없음이라고 단정할 수 없습니다.'))).toBe(false);
    expect(explicitlyAgreed(reply('없음\n- 립싱크 미해결'))).toBe(false);
    expect(explicitlyAgreed('두 모델이 동의합니다.')).toBe(false);
    expect(consensusLabel({ consensusReached: false })).toContain('미합의');
    expect(consensusLabel({ consensusReached: null })).toContain('미판정');
    expect(consensusLabel({ consensusReached: true })).toContain('합의 확인');
  });
  it('honors explicit final reporter without changing historical decisions', () => {
    expect(conclusionProvider('코덱스가 정리해서 보고')).toBe('codex');
    expect(conclusionProvider('Codex 정리, Claude 최종 요약')).toBe('claude');
    expect(conclusionProvider('양쪽 토론')).toBe('claude');
  });
  it('does not claim agreement when the final reporter finds a remaining issue, and preserves summary tables', () => {
    const agreed = '## 합의된 사항\n- 표 반영\n## 남은 이견\n- 없음';
    expect(finalConsensus([agreed, agreed], agreed)).toBe(true);
    expect(finalConsensus([agreed, agreed], agreed.replace('- 없음', '- 마지막 컷 미해결'))).toBe(false);
    expect(finalConsensus([agreed, agreed], '구조화된 결론 없음')).toBeNull();
    expect(parseDebateSummary('## 합의된 사항\n| 컷 | 내용 |\n|---|---|\n| 200 | 최종 |').agreements).toEqual(['| 컷 | 내용 |\n|---|---|\n| 200 | 최종 |']);
  });
});
