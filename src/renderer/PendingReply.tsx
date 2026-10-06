import { useEffect, useState } from 'react';
import type { CollaborationEvent, Provider } from '../shared/types';

const durationLabel = (seconds: number): string => `${Math.floor(seconds / 60)}분 ${String(seconds % 60).padStart(2, '0')}초`;
const maximumAge = 60 * 60_000;

export function PendingReply({ provider, request, discussion, completedRound, defaultRounds, typical }: {
  provider: Provider; request: CollaborationEvent; discussion: boolean;
  completedRound: number; defaultRounds: number; typical: number;
}) {
  const [clockMs, setClockMs] = useState(() => Date.now());
  const started = Date.parse(request.timestamp);
  useEffect(() => {
    if (Date.now() - started >= maximumAge) return;
    const timer = window.setInterval(() => {
      const next = Date.now();
      setClockMs(next);
      if (next - started >= maximumAge) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [started]);
  if (clockMs - started >= maximumAge) return null;
  const elapsed = Math.max(0, Math.floor((clockMs - started) / 1000));
  const rounds = Number(request.metadata?.discussionRounds ?? defaultRounds);
  const roundLabel = !discussion ? '' : rounds === -1 ? `끝장 토론 ${completedRound + 1}회차 · `
    : `토론 ${Math.min(completedRound + 1, rounds)} / ${rounds}회차 · `;
  return <article className="chat-message from-model pending" role="status">
    <strong>{provider === 'codex' ? 'Codex' : 'Claude'} 생각 중 · 응답 생성 중…</strong>
    <div className="chat-message-text">{roundLabel}경과 {durationLabel(elapsed)} · {typical
      ? elapsed < typical ? `최근 응답 기준 예상 약 ${durationLabel(typical - elapsed)} 남음` : '최근 응답보다 오래 걸리는 중'
      : '완료 기록이 쌓이면 남은 시간을 예측합니다.'}<br />답변이 완성되면 자동으로 표시됩니다.</div>
  </article>;
}
