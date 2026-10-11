import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import {
  IMPORT_CONFIRM_COPY,
  IMPORT_NOT_APPLIED_COPY,
  PERIOD_TIMES,
  SchedulePlanner,
  WEEKDAY_LABELS,
  studySlots,
  applyImport,
  cleanCourse,
  meetupLabel,
  meetupStartOptions,
  meetupWindowLabel,
  meetupWindows,
  minutesLabel,
  type MeetupWindow,
  parseTimetableText,
  periodRangeLabel,
  type PersonalCourse, shareCopiedCopy } from '@campus/shared';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { TimetableOcrHost, recognizeWithOnDeviceOcr } from '../components/TimetableOcrHost';
import { readImageBase64, TimetableOcrError } from '../services/timetableOcr';
import {
  createMeetup,
  createServerShare,
  listIncomingMeetups,
  respondMeetup,
  type MeetupRow,
  loadFriendTimetable,
  loadPersonalTimetable,
  savePersonalTimetable,
  type StoredTimetable,
} from '../services/personalTimetable';
import { listAcceptedFriends, opponentUidFromFriendship } from '../services/friends';

export default function PersonalTimetableScreen() {
  const auth = useAuth();
  const { school } = useSchool();
  const uid = auth.user?.uid || null;
  const schoolId = school?.id || 'pu';
  const [timetable, setTimetable] = useState<StoredTimetable | null>(null);
  const [view, setView] = useState<'week' | 'day' | 'grid'>('week');
  const [day, setDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [editing, setEditing] = useState<PersonalCourse | null>(null);
  const [paste, setPaste] = useState('');
  const [answer, setAnswer] = useState<string[]>([]);
  const [studyDay, setStudyDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [studyHours, setStudyHours] = useState(2);
  const [notice, setNotice] = useState('');
  const [friends, setFriends] = useState<Array<{ uid: string; name: string }>>([]);
  const [friendId, setFriendId] = useState<string | null>(null);
  const [friendCourses, setFriendCourses] = useState<PersonalCourse[]>([]);
  const [invites, setInvites] = useState<MeetupRow[]>([]);
  const [meetupBusy, setMeetupBusy] = useState(false);

  const load = useCallback(async () => {
    const next = await loadPersonalTimetable(uid, schoolId);
    setTimetable(next);
    if (!uid) return;
    const list = await listAcceptedFriends(schoolId, uid).catch(() => []);
    setFriends(
      list.map((item) => ({
        uid: opponentUidFromFriendship(item, uid),
        name: (item.fromUid === uid ? item.toName : item.fromName) || '好友',
      })),
    );
    setInvites(await listIncomingMeetups(schoolId, uid).catch(() => []));
  }, [uid, schoolId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const planner = useMemo(
    () => new SchedulePlanner(timetable?.courses || [], friendId ? [{ id: friendId, name: '好友', courses: friendCourses }] : [], friendId),
    [timetable?.courses, friendId, friendCourses],
  );

  if (!timetable) {
    return (
      <Screen title="我的課表">
        <TimetableOcrHost />
        <Text style={{ color: theme.colors.muted, padding: 16 }}>正在讀取課表…</Text>
      </Screen>
    );
  }

  const persist = async (next: StoredTimetable, message: string) => {
    const saved = await savePersonalTimetable(uid, { ...next, schoolId });
    setTimetable({ ...next, schoolId });
    setNotice(saved.stored === 'cloud' ? message : `已記在本站。${message}`);
  };

  const visible = timetable.courses
    .filter((course) => (view === 'day' ? course.day === day : course.day >= 1))
    .sort((a, b) => a.day - b.day || a.start - b.start);
  const windows = friendId ? meetupWindows(timetable.courses, friendCourses) : [];
  const nameOf = (id: string) => friends.find((friend) => friend.uid === id)?.name || '同學';

  const sendMeetup = async (kind: 'meal' | 'study', dayOfWeek: number, startMinute: number) => {
    if (!uid || !friendId || meetupBusy) return;
    setMeetupBusy(true);
    const label = meetupLabel({ day: dayOfWeek, kind, startMinute });
    try {
      const result = await createMeetup({
        schoolId,
        creatorUid: uid,
        inviteeUid: friendId,
        kind,
        day: dayOfWeek,
        startMinute,
        note: kind === 'meal' ? '約吃飯' : '約讀書',
      });
      setNotice(
        result === 'already'
          ? `「${label}」之前就約過了，不會再送一次。`
          : `已送出邀請：${label}。對方會在「找人」和「我的課表」看到。`,
      );
    } catch {
      setNotice('邀請沒有送出，請稍後再試。');
    } finally {
      setMeetupBusy(false);
    }
  };

  const answerInvite = async (id: string, status: 'accepted' | 'declined') => {
    try {
      await respondMeetup(id, status);
      setNotice(status === 'accepted' ? '已答應，對方會看到。' : '已婉拒。');
    } catch {
      setNotice('這次沒有回覆成功，請稍後再試。');
    }
    setInvites(uid ? await listIncomingMeetups(schoolId, uid).catch(() => []) : []);
  };

  const ocrNotice = (error: unknown) => {
    if (error instanceof TimetableOcrError && error.kind === 'network') {
      return `${IMPORT_NOT_APPLIED_COPY}。截圖辨識需要連上網路下載字庫，這次沒連上。請對照圖片把文字貼上。`;
    }
    return `${IMPORT_NOT_APPLIED_COPY}。這台裝置還沒開通截圖辨識，請對照圖片把文字貼上。`;
  };

  const confirmParsed = (parsed: PersonalCourse[]) => {
    if (!parsed.length) {
      setNotice(`${IMPORT_NOT_APPLIED_COPY}。截圖有讀到，但沒有可靠找到課程，請改貼文字或手動新增。`);
      return;
    }
    Alert.alert('確認匯入', `將寫入 ${parsed.length} 門課，原本課表會被這份取代。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '確認',
        onPress: () =>
          void persist({ ...timetable, courses: applyImport(timetable.courses, parsed, 'replace') }, '已匯入課表。'),
      },
    ]);
  };

  return (
    <Screen title="我的課表" subtitle="確認前不會覆寫你現在的課表">
      <TimetableOcrHost />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 120 }}>
        {invites.length > 0 ? (
          <View accessibilityLabel="有人約你" style={{ gap: 8 }}>
            <Text style={{ fontWeight: '700', color: theme.colors.text }}>有人約你</Text>
            {invites.map((item) => (
              <View key={item.id} style={{ gap: 6 }}>
                <Text style={{ color: theme.colors.text }}>
                  {nameOf(item.creatorUid)} 約你：{meetupLabel(item)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button text="答應" kind="primary" onPress={() => void answerInvite(item.id, 'accepted')} />
                  <Button text="婉拒" onPress={() => void answerInvite(item.id, 'declined')} />
                </View>
              </View>
            ))}
          </View>
        ) : null}
        {notice ? <Text style={{ color: theme.colors.text }}>{notice}</Text> : null}
        {uid ? (
          <Pressable
            onPress={() =>
              void persist(
                { ...timetable, shareWithFriends: timetable.shareWithFriends === false },
                timetable.shareWithFriends === false
                  ? '好友加完後看得到這份課表。'
                  : '已關掉好友課表。對方現在看不到。',
              )
            }
          >
            <Text style={{ color: theme.colors.text }}>
              {timetable.shareWithFriends === false ? '目前好友看不到這份課表（點一下開放）' : '已接受的好友可以看到這份課表（點一下關閉）'}
            </Text>
          </Pressable>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button text="一週" onPress={() => setView('week')} />
          <Button text="單日" onPress={() => setView('day')} />
          <Button text="格子" onPress={() => setView('grid')} />
          <Button text="新增" onPress={() => setEditing(cleanCourse({ day, start: 1, end: 1 }))} />
        </View>
        {view === 'day' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {WEEKDAY_LABELS.map((label, index) => (
              <Pressable key={label} onPress={() => setDay(index + 1)}>
                <Text style={{ color: day === index + 1 ? theme.colors.accent : theme.colors.muted }}>{label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {view === 'grid' ? (
          <View>
            <View style={{ flexDirection: 'row' }}>
              <Text style={{ width: 44, color: theme.colors.muted, fontSize: 11 }}>節</Text>
              {WEEKDAYS_SHORT.map((label) => (
                <Text key={label} style={{ flex: 1, color: theme.colors.muted, fontSize: 11, textAlign: 'center' }}>
                  {label}
                </Text>
              ))}
            </View>
            {PERIOD_TIMES.map((time, index) => {
              const period = index + 1;
              return (
                <View key={period} style={{ flexDirection: 'row', minHeight: 36, alignItems: 'stretch' }}>
                  <Text style={{ width: 44, color: theme.colors.muted, fontSize: 10 }}>
                    {period}
                    {'\n'}
                    {time[0]}
                  </Text>
                  {WEEKDAY_LABELS.map((_, dayIndex) => {
                    const hit = timetable.courses.find(
                      (course) => course.day === dayIndex + 1 && period >= course.start && period <= course.end,
                    );
                    return (
                      <Pressable
                        key={`${period}-${dayIndex}`}
                        onPress={() => hit && setEditing(hit)}
                        style={{
                          flex: 1,
                          borderWidth: 0.5,
                          borderColor: theme.colors.separator,
                          backgroundColor: hit ? theme.colors.card : 'transparent',
                          padding: 2,
                        }}
                      >
                        {hit && period === hit.start ? (
                          <Text numberOfLines={2} style={{ color: theme.colors.text, fontSize: 10, fontWeight: '700' }}>
                            {hit.name}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </View>
        ) : visible.length === 0 ? (
          <Text style={{ color: theme.colors.muted }}>這段時間沒有課。可以用下面的匯入或新增。</Text>
        ) : (
          visible.map((course) => (
            <Pressable
              key={course.id}
              onPress={() => setEditing(course)}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.separator,
                borderRadius: 12,
                padding: 12,
                backgroundColor: theme.colors.card,
              }}
            >
              <Text style={{ color: theme.colors.muted }}>
                {WEEKDAY_LABELS[course.day - 1] || '未排定'} · {periodRangeLabel(course.start, course.end)}
              </Text>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>{course.name}</Text>
              <Text style={{ color: theme.colors.muted }}>
                {course.teacher || '教師未填'} · {course.room || '教室未填'}
              </Text>
            </Pressable>
          ))
        )}

        {editing ? (
          <View style={{ gap: 8 }}>
            <Text style={{ fontWeight: '700', color: theme.colors.text }}>編輯課程</Text>
            <TextInput
              value={editing.name}
              onChangeText={(name) => setEditing({ ...editing, name })}
              placeholder="課名"
              style={inputStyle}
            />
            <TextInput
              value={String(editing.day)}
              onChangeText={(value) => setEditing({ ...editing, day: Number(value) || 0 })}
              placeholder="星期 1-5，0 代表未排定"
              keyboardType="number-pad"
              style={inputStyle}
            />
            <TextInput
              value={String(editing.start)}
              onChangeText={(value) => setEditing({ ...editing, start: Number(value) || 1 })}
              placeholder="開始節次"
              keyboardType="number-pad"
              style={inputStyle}
            />
            <TextInput
              value={String(editing.end)}
              onChangeText={(value) => setEditing({ ...editing, end: Number(value) || 1 })}
              placeholder="結束節次"
              keyboardType="number-pad"
              style={inputStyle}
            />
            <TextInput
              value={editing.room}
              onChangeText={(room) => setEditing({ ...editing, room })}
              placeholder="教室"
              style={inputStyle}
            />
            <Button
              text="儲存"
              onPress={() => {
                const cleaned = cleanCourse(editing);
                const next = timetable.courses.some((item) => item.id === cleaned.id)
                  ? timetable.courses.map((item) => (item.id === cleaned.id ? cleaned : item))
                  : [...timetable.courses, cleaned];
                void persist({ ...timetable, courses: next }, '課程已更新。');
                setEditing(null);
              }}
            />
            <Button text="取消" onPress={() => setEditing(null)} />
          </View>
        ) : null}

        <Text style={{ fontWeight: '700', color: theme.colors.text }}>匯入</Text>
        <Text style={{ color: theme.colors.muted }}>{IMPORT_CONFIRM_COPY}</Text>
        <TextInput
          value={paste}
          onChangeText={setPaste}
          placeholder={'星期一 第3-4節 資料庫 / 王老師 / 主顧303'}
          multiline
          style={[inputStyle, { minHeight: 90 }]}
        />
        <Button
          text="辨識文字"
          onPress={() => {
            const parsed = parseTimetableText(paste);
            if (!parsed.length) {
              setNotice(`${IMPORT_NOT_APPLIED_COPY}。沒有認出課程。`);
              return;
            }
            confirmParsed(parsed);
          }}
        />
        <Button
          text="選截圖"
          onPress={async () => {
            const picked = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              base64: true,
            });
            if (picked.canceled) return;
            const asset = picked.assets[0];
            if (!asset) {
              setNotice(`${IMPORT_NOT_APPLIED_COPY}。讀不到這張圖，請對照圖片把文字貼上。`);
              return;
            }
            setNotice('已收到圖片。辨識完成前不會改你的課表。');
            try {
              const base64 = asset.base64 || (asset.uri ? await readImageBase64(asset.uri) : '');
              if (!base64) {
                setNotice(`${IMPORT_NOT_APPLIED_COPY}。讀不到這張圖，請對照圖片把文字貼上。`);
                return;
              }
              const text = await recognizeWithOnDeviceOcr(base64);
              confirmParsed(parseTimetableText(text));
            } catch (error) {
              setNotice(ocrNotice(error));
            }
          }}
        />

        <Text style={{ fontWeight: '700', color: theme.colors.text }}>幫我安排</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button text="下一堂" onPress={() => setAnswer([planner.ask('下一堂') || '課表上還沒有排課。'])} />
          <Button
            text="今天空堂"
            onPress={() => {
              const today = new Date().getDay();
              setAnswer(
                today >= 1 && today <= 5
                  ? [planner.ask('今天空堂') || '今天沒有空堂。']
                  : ['今天是週末，課表上沒有排課。'],
              );
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {WEEKDAY_LABELS.map((label, index) => (
            <Button
              key={label}
              text={label.replace('星期', '週')}
              kind={studyDay === index + 1 ? 'primary' : 'outline'}
              onPress={() => setStudyDay(index + 1)}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[1, 2, 3].map((hours) => (
            <Button
              key={hours}
              text={`${hours} 小時`}
              kind={studyHours === hours ? 'primary' : 'outline'}
              onPress={() => setStudyHours(hours)}
            />
          ))}
          <Button
            text="排讀書時間"
            onPress={() => {
              const slots = studySlots(timetable.courses, studyDay, studyHours);
              setAnswer(slots.length ? slots : ['這天的空堂都不夠長，換一天或少排一點。']);
            }}
          />
        </View>
        {answer.map((line) => (
          <Text key={line} style={{ color: theme.colors.text }}>
            {line}
          </Text>
        ))}

        <Text style={{ fontWeight: '700', color: theme.colors.text }}>分享</Text>
        <Button
          text="分享課表"
          onPress={async () => {
            let path = '';
            let expiresAt = '';
            try {
              const share = await createServerShare(schoolId, '我的課表');
              path = share.path;
              expiresAt = share.expiresAt;
            } catch {
              setNotice('現在產生不了分享連結，登入並連上網路後再試。');
              return;
            }
            const url = `https://nuni.tw${path}`;
            await Clipboard.setStringAsync(url).catch(() => undefined);
            if (expiresAt) setNotice(shareCopiedCopy(expiresAt));
            try {
              await Share.share({ message: url });
            } catch {
              // 使用者關掉分享面板或系統拒絕，不用另外提示
            }
          }}
        />

        <Text style={{ fontWeight: '700', color: theme.colors.text }}>共同空堂</Text>
        {!uid ? (
          <Text style={{ color: theme.colors.muted }}>登入並加好友後才能看對方課表。</Text>
        ) : friends.length === 0 ? (
          <Text style={{ color: theme.colors.muted }}>目前沒有已接受的好友。請先到找人送出邀請。</Text>
        ) : (
          friends.map((friend) => (
            <Button
              key={friend.uid}
              text={`看 ${friend.name || friend.uid.slice(0, 6)} 的課表`}
              onPress={async () => {
                const theirs = await loadFriendTimetable(friend.uid).catch(() => null);
                if (!theirs) {
                  setNotice('還看不到這份課表。要先成為好友，且對方有開放。');
                  return;
                }
                setFriendId(friend.uid);
                setFriendCourses(theirs.courses);
                setNotice(`已載入對方 ${theirs.courses.length} 門課。共同空堂會列在下面。`);
              }}
            />
          ))
        )}
        {friendId && friendCourses.length > 0 && windows.length === 0 ? (
          <Text style={{ color: theme.colors.muted }}>這週找不到兩個人都沒課、有一小時的時段。</Text>
        ) : null}
        {windows.slice(0, 8).map((window) => (
          <MeetupWindowRow
            key={`${window.day}-${window.start}`}
            window={window}
            busy={meetupBusy}
            onSend={(kind, startMinute) => void sendMeetup(kind, window.day, startMinute)}
          />
        ))}
        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
          靜宜第 1 節 {PERIOD_TIMES[0][0]}，第 13 節 {PERIOD_TIMES[12][1]}。
        </Text>
      </ScrollView>
    </Screen>
  );
}

function MeetupWindowRow({
  window,
  busy,
  onSend,
}: {
  window: MeetupWindow;
  busy: boolean;
  onSend: (kind: 'meal' | 'study', startMinute: number) => void;
}) {
  const options = meetupStartOptions(window);
  const [start, setStart] = useState(options[0] ?? window.start);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: theme.colors.text }}>{meetupWindowLabel(window)}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {options.slice(0, 8).map((at) => (
          <Pressable
            key={at}
            accessibilityRole="button"
            accessibilityState={{ selected: at === start }}
            onPress={() => setStart(at)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: at === start ? theme.colors.accent : theme.colors.border,
            }}
          >
            <Text style={{ color: at === start ? theme.colors.accent : theme.colors.text }}>{minutesLabel(at)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>從 {minutesLabel(start)} 開始，1 小時</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button text="約吃飯" disabled={busy} onPress={() => onSend('meal', start)} />
        <Button text="約讀書" disabled={busy} onPress={() => onSend('study', start)} />
      </View>
    </View>
  );
}

const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五'];

const inputStyle = {
  borderWidth: 1,
  borderColor: theme.colors.separator,
  borderRadius: 10,
  padding: 12,
  minHeight: 44,
  color: theme.colors.text,
};
