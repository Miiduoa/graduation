import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Text, TextInput, View } from 'react-native';
import type { PersonalImportRecord } from '@campus/shared';
import { ClassGapReplyCard } from '../../../apps/mobile/src/screens/ClassGapReplyCard';
import { savedClassGaps } from '../../../apps/mobile/src/services/nextSavedClasses';
import {
  answerSavedClassGapQuery, savedClassGapFollowUp, savedClassGapQuery, type SavedClassGapQuery,
} from '../../../apps/mobile/src/services/savedClassGapQuery';
import { AIButton, aiTokens } from '../../../apps/mobile/src/ui/aiFirst';
import { applyTheme, theme } from '../../../apps/mobile/src/ui/theme';

const mode = new URLSearchParams(location.search).get('theme') === 'dark' ? 'dark' : 'light';
applyTheme(mode);
document.body.style.backgroundColor = theme.colors.bg;

const checkedAt = '2026-11-06T11:00:00+08:00';
const savedAt = '2026-11-06T02:00:00.000Z';
function meeting(dayOfWeek: number, startTime: string, endTime: string): PersonalImportRecord {
  return {
    id: `${dayOfWeek}-${startTime}`, title: '範例課程', schoolId: 'pu', kind: 'timetable',
    academicYear: '115', semester: '1', dayOfWeek, startTime, endTime,
    source: { type: 'paste', rawText: '', line: 1 }, batchId: 'qa-fixture', importedAt: savedAt,
  };
}
const rows = [
  meeting(6, '09:00', '10:00'), meeting(6, '12:00', '13:00'), meeting(6, '17:00', '18:00'),
  meeting(7, '09:00', '10:00'), meeting(7, '12:00', '13:00'), meeting(7, '16:00', '17:00'),
];
type Reply = { question: string; query: SavedClassGapQuery; content: string };
declare global { interface Window { qaEvents: unknown[] } }
window.qaEvents = [];

function App() {
  const [draft, setDraft] = useState('明天下午有一個半小時的空堂嗎？');
  const [replies, setReplies] = useState<Reply[]>([]);
  const [error, setError] = useState('');
  const [opened, setOpened] = useState(false);
  const ask = (question: string) => {
    const previous = replies.at(-1)?.query;
    const query = (previous && savedClassGapFollowUp(question, previous)) ?? savedClassGapQuery(question);
    if (!query) {
      setError('這個測試只處理課間空堂查詢。');
      return;
    }
    const result = answerSavedClassGapQuery(query, {
      checkedAt, schoolId: 'pu', schoolName: '測試課表',
      timetable: {
        source: 'saved-device-copy', updatedAt: savedAt, courses: [],
        classGaps: savedClassGaps(rows, 'pu', new Date(checkedAt), query.day),
      },
    });
    window.qaEvents.push({ kind: 'ask', question, query });
    setReplies([...replies, { question, query, content: result.content }]);
    setDraft('');
    setError('');
  };
  return (
    <View style={{ minHeight: '100vh' as never, backgroundColor: aiTokens.bg, paddingTop: 20, paddingBottom: 20 }}>
      <Text accessibilityRole="header" style={{ color: aiTokens.text, fontSize: 22, fontWeight: '700', marginHorizontal: 20, marginBottom: 14 }}>
        查課間空堂
      </Text>
      <View style={{ marginHorizontal: 20, gap: 8, marginBottom: 14 }}>
        <TextInput accessibilityLabel="空堂問題" multiline value={draft} onChangeText={setDraft}
          placeholder="輸入空堂條件或接著追問" placeholderTextColor={aiTokens.muted}
          style={{ minHeight: 76, padding: 12, color: aiTokens.text, backgroundColor: aiTokens.surface,
            borderWidth: 1, borderColor: aiTokens.border, borderRadius: 10, fontSize: 15, lineHeight: 22 }} />
        <AIButton label="查詢空堂" size="sm" disabled={!draft.trim()} onPress={() => ask(draft)} />
        {!!error && <Text accessibilityRole="alert" style={{ color: aiTokens.danger }}>{error}</Text>}
      </View>
      {replies.map((reply, index) => (
        <View key={index} testID={`gap-reply-${index}`}>
          <Text style={{ color: aiTokens.textSecondary, fontSize: 13, lineHeight: 20, marginHorizontal: 20, marginBottom: 4 }}>
            {reply.question}
          </Text>
          <ClassGapReplyCard query={reply.query} content={reply.content} latest={index === replies.length - 1}
            busy={false} onAsk={ask} onOpenTimetable={() => {
              window.qaEvents.push({ kind: 'open-route', route: '/timetable' });
              setOpened(true);
            }} />
        </View>
      ))}
      {opened && <Text accessibilityRole="status" style={{ marginHorizontal: 20, color: aiTokens.textSecondary }}>已選取我的課表</Text>}
      <Text style={{ marginHorizontal: 20, marginTop: 12, color: aiTokens.muted, fontSize: 12, lineHeight: 20 }}>
        測試畫面：使用正式查詢、空堂計算和回覆元件；課表與時間為合成範例，未驗證登入、原生裝置或真實校務資料。
      </Text>
    </View>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
