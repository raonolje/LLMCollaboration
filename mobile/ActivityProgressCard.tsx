import { Text, View, StyleSheet } from 'react-native';
import { activityIsLive, activityLabel, activityProgressText, type ModelActivity } from '../src/shared/model-activity';

export function ActivityProgressCard({ activity, connected }: { activity?: ModelActivity; connected: boolean }) {
  if (!connected || !activity || !activityIsLive(activity) || !activity.progress) return null;
  const progress = activity.progress, message = progress.messages.at(-1);
  return <View style={s.card} accessibilityLabel="실시간 작업 현황">
    <Text style={s.title}>{activity.provider === 'codex' ? 'Codex' : 'Claude'} · {activityLabel(activity)}</Text>
    {!!activityProgressText(progress) && <Text style={s.counts}>{activityProgressText(progress)}</Text>}
    {!!progress.lastAction && <Text style={s.note}>최근 확인: {progress.lastAction}{progress.lastActionAt ? ' · ' + new Date(progress.lastActionAt).toLocaleTimeString('ko-KR') : ''}</Text>}
    {message && <View style={s.preview}><Text style={s.note}>중간 메시지 · 최종 답변 아님</Text><Text selectable numberOfLines={8} style={s.message}>{message.text}</Text></View>}
    <Text style={s.note}>실제 CLI 이벤트 기준 · 최종 답변은 응답 종료 후 저장됩니다.{progress.limited ? ' 도구 집계 일부 생략.' : ''}</Text>
  </View>;
}
const s = StyleSheet.create({
  card: { padding: 12, borderRadius: 12, backgroundColor: '#f3f6ff', borderWidth: 1, borderColor: '#dbe2f3', gap: 6 },
  title: { color: '#304487', fontWeight: '700', fontSize: 13 },
  counts: { color: '#304487', fontSize: 12, lineHeight: 19 },
  note: { color: '#69768b', fontSize: 11, lineHeight: 17 },
  preview: { backgroundColor: '#fff', padding: 10, borderRadius: 8, gap: 4 },
  message: { color: '#29374f', fontSize: 13, lineHeight: 21 },
});
