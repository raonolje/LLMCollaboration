import { useEffect, useState } from 'react';
import type { Provider } from '../shared/types';
import { activityIsLive, activityLabel, activityProgressText, type ModelActivity } from '../shared/model-activity';

export function PendingReply({ provider, activity, connected, onStop }: {
  provider: Provider; activity?: ModelActivity; connected: boolean; onStop?: () => void;
}) {
  const live = !!activity && activityIsLive(activity);
  const showTiming = connected && live;
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    if (!showTiming) return;
    setClock(Date.now());
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [showTiming, activity?.id]);
  const elapsed = activity ? Math.max(0, Math.floor(((live ? clock : Date.parse(activity.updatedAt)) - Date.parse(activity.startedAt)) / 1000)) : 0;
  const silent = activity?.lastOutputAt ? Math.max(0, Math.floor((clock - Date.parse(activity.lastOutputAt)) / 1000)) : null;
  const round = activity?.phase.match(/(?:discussion|critique|response)-(\d+)/u)?.[1];
  const progress = showTiming ? activity?.progress : undefined;
  const latestMessage = progress?.messages.at(-1);
  return <article className={'chat-message from-model model-activity' + (connected && live ? ' pending' : '')} role="status" aria-live="polite">
    <strong>{provider === 'codex' ? 'Codex' : 'Claude'} · {!connected ? '실행 상태 연결 끊김' : activity ? activityLabel(activity) : '현재 CLI 작업 없음'}</strong>
    {showTiming && activity && <div className="chat-message-text">
      {round && '토론 ' + round + '회차 · '}경과 {Math.floor(elapsed / 60)}분 {elapsed % 60}초
      {activity.processId && ' · CLI PID ' + activity.processId}<br />
      {silent === null ? 'CLI 출력 신호 대기' : '마지막 CLI 신호 이후 ' + silent + '초 경과'}
      {live && silent !== null && silent >= 120 && ' · 출력 대기 중 (시간만으로 중단 판정하지 않습니다)'}
    </div>}
    {progress && <section className="activity-progress" aria-label="실시간 작업 현황">
      {activityProgressText(progress) && <div className="activity-progress-counts">{activityProgressText(progress)}</div>}
      {progress.lastAction && <div className="activity-progress-action">최근 확인: {progress.lastAction}
        {progress.lastActionAt && <time dateTime={progress.lastActionAt}> · {new Date(progress.lastActionAt).toLocaleTimeString('ko-KR')}</time>}
      </div>}
      {latestMessage && <div className="activity-preview">
        <div className="activity-preview-label">중간 메시지 · 최종 답변 아님</div>
        <div className="activity-preview-text">{latestMessage.text}</div>
        {progress.messages.length > 1 && <details className="activity-preview-history"><summary>이전 중간 메시지 {progress.messages.length - 1}개</summary>
          {progress.messages.slice(0, -1).map((message) => <div className="activity-preview-text" key={message.id}>{message.text}</div>)}
        </details>}
      </div>}
      <div className="activity-progress-note">실제 CLI 이벤트 기준 · 최종 답변은 응답 종료 후 저장됩니다.{progress.limited ? ' 도구 집계 상한에 도달해 일부는 생략됩니다.' : ''}</div>
    </section>}
    {activity?.error && <div className="chat-message-text">{activity.error}</div>}
    {connected && live && onStop && <button type="button" className="button danger small" disabled={activity?.state === 'cancelling'} onClick={onStop}>
      {activity?.state === 'cancelling' ? '중단 확인 중…' : activity?.taskId ? '이 업무 중단' : '이 프로젝트 토론·응답 중단'}
    </button>}
    {!connected && <div className="chat-message-text">현재 작업의 완료·중단 여부를 확인할 수 없습니다. 연결 복구 후 다시 확인합니다.</div>}
  </article>;
}
