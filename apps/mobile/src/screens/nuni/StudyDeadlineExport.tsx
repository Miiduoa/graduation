import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import {
  buildStudyCalendar,
  studyCalendarCandidates,
  studyCalendarKey,
  studyCalendarNotice,
  studyCalendarPartial,
} from '@campus/shared/src/studyAgendaCalendar';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import { shareICalContent } from '../../services/ical';
import { useTheme } from '../../state/theme';

export function StudyDeadlineExport({
  tasks,
  partial,
  retry,
}: {
  tasks: NuniStudyTask[];
  partial: boolean;
  retry(): void;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const lock = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const candidates = studyCalendarCandidates(tasks);
  const chosen = candidates.filter((task) => selected.includes(studyCalendarKey(task)));
  const copy = { color: theme.colors.text, fontSize: 15 };
  const button = (label: string, action: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={action}
      style={{ minHeight: 48, paddingVertical: 12, opacity: disabled ? 0.5 : 1 }}
    >
      <Text style={{ ...copy, color: theme.colors.accent }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ gap: 10 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded(!expanded)}
        style={{ minHeight: 48, paddingVertical: 12 }}
      >
        <Text style={{ ...copy, color: theme.colors.accent }}>匯出未繳期限 ICS</Text>
      </Pressable>
      {expanded && (
        <>
          <Text style={copy}>
            從目前課程範圍勾選作業或測驗，再預覽匯出。時間皆為台灣時間，已繳、停止收件或缺少明確期限的項目已略過。
          </Text>
          <Text style={copy}>{studyCalendarNotice}</Text>
          {partial && (
            <Text accessibilityRole="alert" style={copy}>
              {studyCalendarPartial}
            </Text>
          )}
          {!candidates.length && (
            <Text style={copy}>
              目前沒有可匯出的未繳期限。請更新待辦，或進入課程確認老師是否設定時間。
            </Text>
          )}
          {candidates.map((task) => {
            const key = studyCalendarKey(task);
            const checked = selected.includes(key);
            return (
              <Pressable
                key={key}
                accessibilityRole="checkbox"
                accessibilityLabel={`${task.courseTitle} · ${task.kind === 'assignment' ? '作業' : '測驗'} · ${task.title} · ${formatTaipeiDateTime(task.dueAt!, { seconds: false })}`}
                accessibilityState={{ checked, disabled: busy }}
                disabled={busy}
                onPress={() => {
                  setSelected(
                    checked ? selected.filter((item) => item !== key) : [...selected, key],
                  );
                  setPreview(false);
                  setMessage('');
                }}
                style={{
                  minHeight: 48,
                  padding: 12,
                  borderWidth: 1,
                  borderColor: checked ? theme.colors.accent : theme.colors.border,
                  gap: 5,
                }}
              >
                <Text style={copy}>
                  {checked ? '已勾選' : '未勾選'} · {task.courseTitle} ·{' '}
                  {task.kind === 'assignment' ? '作業' : '測驗'} · {task.title}
                </Text>
                <Text style={copy}>{formatTaipeiDateTime(task.dueAt!, { seconds: false })}</Text>
              </Pressable>
            );
          })}
          {button('更新待辦資料', retry, busy)}
          {button(
            `預覽已選 ${chosen.length} 項`,
            () => {
              setPreview(true);
              setMessage('');
            },
            !chosen.length || busy,
          )}
          {preview && chosen.length > 0 && (
            <View style={{ gap: 8 }}>
              <Text style={copy}>將匯出 {chosen.length} 項參考期限（台灣時間）：</Text>
              {chosen.map((task) => (
                <Text key={studyCalendarKey(task)} style={copy}>
                  {task.courseTitle} · {task.title} ·{' '}
                  {formatTaipeiDateTime(task.dueAt!, { seconds: false })}
                </Text>
              ))}
              {button(
                busy ? '正在開啟分享…' : '分享 ICS',
                () => {
                  if (lock.current) return;
                  lock.current = true;
                  setBusy(true);
                  setMessage('');
                  void shareICalContent(
                    buildStudyCalendar(tasks, selected),
                    'nuni-study-deadlines.ics',
                    () => active.current,
                  )
                    .then(() => {
                      if (active.current)
                        setMessage('分享選單已關閉；是否儲存或匯入，請到選擇的 App 確認。');
                    })
                    .catch(() => {
                      if (active.current)
                        setMessage(
                          '分享未能完成，已保留勾選項目。請再試一次；若裝置不支援分享，可改用網頁版下載。',
                        );
                    })
                    .finally(() => {
                      lock.current = false;
                      if (active.current) setBusy(false);
                    });
                },
                busy,
              )}
            </View>
          )}
          {!!message && (
            <Text accessibilityLiveRegion="polite" style={copy}>
              {message}
            </Text>
          )}
        </>
      )}
    </View>
  );
}
