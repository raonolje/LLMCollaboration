import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { CollaborationEvent } from '../../shared/types.js';

/** Each simultaneous pair receives the same immutable snapshot, never a live log. */
export const contextPreview = (text: string, maximum: number): string => text.length <= maximum ? text
  : `${text.slice(0, maximum)}\n[입력 크기 제한: 이 부분은 미리보기입니다. 고정 스냅샷에서 전문을 확인하세요.]`;

export async function discussionContext(projectPath: string, records: readonly CollaborationEvent[], criteria = ''): Promise<string> {
  const unique = [...new Map(records.map((record) => [record.id, record])).values()];
  const body = `${criteria ? `# 공통 기준\n${criteria}\n\n` : ''}` + unique.map((record) => `## ${record.actor} · ${record.type} · 회차 ${record.metadata?.discussionRound ?? record.round ?? 0}\n이벤트 ID: ${record.id}\n\n${record.message}`)
    .join('\n\n---\n\n');
  const digest = createHash('sha256').update(body).digest('hex');
  const directory = path.join(projectPath, '.llm-collaboration', 'contexts');
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${digest}.md`);
  try { await writeFile(file, body, { encoding: 'utf8', flag: 'wx' }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const latest = ['codex', 'claude'].map((provider) => unique.filter((record) => record.actor === provider).at(-1))
    .filter((record): record is CollaborationEvent => !!record);
  const latestBody = latest.map((record) => `### ${record.actor} · 이벤트 ${record.id}\n${record.message}`).join('\n\n');
  return [
    `전체 원문·표의 고정 스냅샷: ${file}\nSHA256: ${digest}\n이벤트 수: ${unique.length}. 동일 이벤트는 한 번만 포함했습니다.`,
    '전체 스냅샷을 읽고 과거 합의·철회와 직전 양쪽 답변의 표를 대조하세요. 읽은 이벤트 ID·표·파일 범위를 답변에 명시하세요. 읽기에 실패하거나 일부만 확인했으면 미확인으로 밝히고 합의 완료라고 하지 마세요. 이견 목록은 원문의 대체물이 아닙니다. 같은 회차 양쪽은 동시에 답하므로 상대의 이번 회차 답변은 다음 회차에서 평가합니다.',
    latestBody.length <= 48_000 ? `직전 양쪽 답변 전체 (생략 없음):\n${latestBody}`
      : '직전 양쪽 답변은 입력 크기 제한 때문에 본문에 중복 삽입하지 않았습니다. 위 스냅샷에서 마지막 Codex·Claude 이벤트 전문과 표를 반드시 읽으세요.',
  ].join('\n\n');
}

export function conclusionProvider(message: string): 'codex' | 'claude' {
  const assignments = [...message.matchAll(/(코덱스|codex|클로드|claude)(?:가|는|에게)?\s*(?:최종\s*)?(?:정리|요약|보고|결론 작성)/giu)];
  const last = assignments.at(-1)?.[1];
  return last && /코덱스|codex/iu.test(last) ? 'codex' : 'claude';
}
