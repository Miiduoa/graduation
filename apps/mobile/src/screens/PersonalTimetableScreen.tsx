import { ClassReminderToggle } from '../components/ClassReminderToggle';
import { ClassExceptions } from '../components/ClassExceptions';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  buildPersonalToday,
  validClassDate,
  periodProfileForSchool,
  periodTimes,
  periodSlots,
  periodCount,
  personalTimetableTerms,
  SchedulePlanner,
  WEEKDAY_LABELS,
  studySlots,
  cleanCourse,
  meetupLabel,
  meetupStartOptions,
  meetupWindowLabel,
  meetupWindows,
  minutesLabel,
  type MeetupWindow,
  periodRangeLabel,
  type PersonalCourse, shareCopiedCopy } from '@campus/shared';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { usePersonalImportScope } from '../state/personalImportScope';
import { loadPersonalImports, personalImportCourses, selectPersonalTimetableCourses } from '../services/personalImports';
import { PersonalImportSummary } from '../components/PersonalImportSummary';
import { safeNavigate } from '../utils/safeNavigate';
import type { PersonalImportRecord } from '@campus/shared';
import {
  createMeetup,
  createServerShare,
  listIncomingMeetups,
  respondMeetup,
  type MeetupRow,
  loadFriendTimetable,
  loadPersonalTimetable,
  savePersonalTimetable,
  loadPersonalTimetableDraft,
  personalTimetableRecords,
  type StoredTimetable,
} from '../services/personalTimetable';
import { listAcceptedFriends, opponentUidFromFriendship } from '../services/friends';

export default function PersonalTimetableScreen() {
  const auth = useAuth();
  const { school } = useSchool();
  const scope = usePersonalImportScope();
  const route = useRoute();
  const params = route.params as { term?: string; courseId?: string; schoolId?: string; date?: string } | undefined;
  const term = params?.schoolId && params.schoolId !== (school?.id || 'pu') ? undefined : params?.term;
  const courseId = params?.schoolId === (school?.id || 'pu') ? params.courseId : undefined;
  const date = params?.schoolId === (school?.id || 'pu') && params.date && validClassDate(params.date) ? params.date : undefined;
  return <PersonalTimetableWorkspace initialDate={date} initialCourseId={courseId} initialTerm={term} key={`${auth.user?.uid || 'guest'}:${school?.id || 'pu'}:${scope?.owner || 'pending'}:${term || ''}:${courseId || ''}:${date || ''}`} />;
}

function PersonalTimetableWorkspace({ initialTerm, initialCourseId, initialDate }: { initialTerm?: string; initialCourseId?: string; initialDate?: string }) {
  const navigation = useNavigation();
  const auth = useAuth();
  const { school } = useSchool();
  const schoolId = school?.id || 'pu';
  const profile = periodProfileForSchool(schoolId);
  const periods = profile ? periodSlots(profile) : [];
  const times = profile ? periodTimes(profile) : [];
  const [timetable, setTimetable] = useState<StoredTimetable | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [view, setView] = useState<'week' | 'day' | 'grid'>('week');
  const [day, setDay] = useState(() => {
    const today = new Date().getDay();
    return today >= 1 && today <= 5 ? today : 1;
  });
  const [editing, setEditing] = useState<PersonalCourse | null>(null);
  const importScope = usePersonalImportScope();
  const localOwner = importScope?.owner.startsWith('nuni:') ? importScope.owner : undefined;
  const uid = localOwner ? null : auth.user?.uid || null;
  const importScopeKey = importScope ? JSON.stringify(importScope) : '';
  const loadGeneration = useRef(0);
  const scopeRef = useRef(importScopeKey);
  scopeRef.current = importScopeKey;
  const [importState, setImportState] = useState<{ scope: string; records: PersonalImportRecord[] } | null>(null);
  const [importStatus, setImportStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [importTerm, setImportTerm] = useState(initialTerm || '');
  const importedRecords = useMemo(() => importState?.scope === importScopeKey ? importState.records : [], [importState, importScopeKey]);
  const allTerms = personalTimetableTerms([
    ...(timetable ? personalTimetableRecords(timetable) : []), ...importedRecords,
  ], schoolId);
  const importTerms = allTerms.map((term) => term.key);
  const activeTerm = importTerms.includes(importTerm) ? importTerm : importTerms[0];
  const manualTerm = timetable ? `${timetable.meta.year || '未填'}|${timetable.meta.semester || '未填'}` : '';
  const selectedView = importTerm === 'legacy' || activeTerm === manualTerm
    ? 'legacy' : activeTerm?.replace('|', '／');
  const displayCourses = useMemo(() => selectPersonalTimetableCourses(timetable, importedRecords, schoolId, selectedView), [timetable, importedRecords, schoolId, selectedView]);
  const datedCourse = initialDate && timetable ? buildPersonalToday(personalTimetableRecords(timetable, importedRecords), { schoolId, termKey: activeTerm, now: new Date(`${initialDate}T12:00:00+08:00`) }).today.find((entry) => entry.row.id === initialCourseId) : undefined;
  const selectedCourse = displayCourses.find((course) => course.id === initialCourseId ||
    `manual:${course.id}` === initialCourseId || course.id === `import:${initialCourseId}`);
  useEffect(() => {
    if (selectedCourse?.day) setDay(selectedCourse.day);
  }, [selectedCourse?.day]);
  const placedImportIds = useMemo(() => new Set(
    personalImportCourses(importedRecords, schoolId).map((course) => course.id),
  ), [importedRecords, schoolId]);
  const openCourse = (course: PersonalCourse) => course.id.startsWith('import:')
    || !profile ? safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' }) : setEditing(course);
  const listedImports = importedRecords.filter((row) => row.kind === 'timetable' && row.schoolId === schoolId &&
    `${row.academicYear}|${row.semester}` === (selectedView === 'legacy' ? manualTerm : activeTerm) &&
    !placedImportIds.has(`import:${row.id}`));
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
    const requestScope = importScopeKey;
    const run = ++loadGeneration.current;
    const active = () => scopeRef.current === requestScope && loadGeneration.current === run;
    setFriends([]); setFriendId(null); setFriendCourses([]); setInvites([]);
    setLoadError(false);
    setImportStatus('loading');
    if (!importScope) return;
    if (importScope) {
      try {
        const imported = await loadPersonalImports(importScope);
        if (active()) {
          setImportState({ scope: requestScope, records: imported.records });
          setImportStatus('ready');
        }
      } catch {
        if (active()) setImportStatus('error');
      }
    }
    let next: StoredTimetable;
    try { next = await loadPersonalTimetable(uid, schoolId, localOwner); }
    catch { if (active()) setLoadError(true); return; }
    if (!active()) return;
    setTimetable(next);
    if (!uid) return;
    const list = await listAcceptedFriends(schoolId, uid).catch(() => []);
    if (!active()) return;
    setFriends(
      list.map((item) => ({
        uid: opponentUidFromFriendship(item, uid),
        name: (item.fromUid === uid ? item.toName : item.fromName) || '好友',
      })),
    );
    const incoming = await listIncomingMeetups(schoolId, uid).catch(() => []);
    if (active()) setInvites(incoming);
  }, [uid, schoolId, importScopeKey, importScope, localOwner]);

  useFocusEffect(
    useCallback(() => {
      void load();
      return () => { loadGeneration.current += 1; };
    }, [load]),
  );

  const planner = useMemo(
    () => profile && !loadError && importStatus === 'ready' && !listedImports.length ? new SchedulePlanner(displayCourses, friendId ? [{ id: friendId, name: '好友', courses: friendCourses }] : [], friendId, profile) : null,
    [displayCourses, friendId, friendCourses, profile, listedImports.length, importStatus, loadError],
  );

  if (!timetable) {
    return (
      <Screen title="我的課表">
        <Text style={{ color: theme.colors.muted, padding: 16 }}>{loadError ? '課表暫時讀不到，請重新讀取。' : !importScope ? '正在確認帳號，暫時不顯示個人課表。' : '正在讀取課表…'}</Text>
        {loadError ? <Button text="重試課表" onPress={() => void load()} /> : null}
      </Screen>
    );
  }

  const persist = async (next: StoredTimetable, message: string, editExceptions = false) => {
    try {
      const saved = await savePersonalTimetable(uid, { ...next, schoolId }, localOwner, editExceptions);
      setTimetable(saved.stored === 'cloud' ? saved.timetable : { ...next, schoolId });
      setNotice(saved.stored === 'cloud' ? message : `${'cloudPending' in saved ? '已記在這台裝置；雲端暫時未同步。' : '已記在這台裝置。'}${message}`);
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '未完成儲存，請稍後重試。');
      return false;
    }
  };

  const visible = displayCourses
    .filter((course) => (view === 'day' ? course.day === day : course.day >= 1))
    .sort((a, b) => a.day - b.day || a.start - b.start);
  const windows = friendId && profile && !loadError && importStatus === 'ready' && !listedImports.length ? meetupWindows(displayCourses, friendCourses, profile) : [];
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


  return (
    <Screen title="我的課表" subtitle="查看上課時間與空堂">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 120 }}>
        {initialCourseId ? <View style={{ padding: 16, gap: 6 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700' }}>{selectedCourse?.name || '這堂課已變更，請核對目前課表'}</Text>
          {initialDate ? <Text style={{ color: theme.colors.muted }}>{datedCourse ? `${initialDate} · ${datedCourse.startTime}–${datedCourse.endTime} · ${datedCourse.row.location || '教室未填'}` : '這堂課在指定日期沒有排課，請查看調整紀錄。'}</Text> : selectedCourse ? <Text style={{ color: theme.colors.muted }}>{selectedCourse.room || '教室未填'}</Text> : null}
        </View> : null}
        {importScopeKey && <ClassReminderToggle key={`reminders:${importScopeKey}`} scope={importScopeKey} />}
        <ClassExceptions key={`exceptions:${importScopeKey}`} records={personalTimetableRecords(timetable, importedRecords)}
          exceptions={timetable.classExceptions} schoolId={schoolId} initialDate={initialDate}
          termKey={selectedView === 'legacy' ? manualTerm : activeTerm}
          disabled={loadError || importStatus !== 'ready'}
          onSave={(classExceptions) => persist({ ...timetable, classExceptions }, '這次安排已儲存。', true)} />
        {uid && !localOwner ? <Button text="重新讀取雲端課表" onPress={() => void load()} /> : null}
        {uid && !localOwner ? <Button text="檢視這台裝置未同步草稿" onPress={() => {
          const requestScope = importScopeKey;
          const run = loadGeneration.current;
          void loadPersonalTimetableDraft(uid, schoolId).then((draft) => {
            if (scopeRef.current !== requestScope || loadGeneration.current !== run) return;
            if (!draft) { setNotice('這台裝置沒有未同步草稿。'); return; }
            setTimetable({ ...timetable, classExceptions: draft.classExceptions });
            setNotice('目前預覽未同步的單次安排；請核對後在上方儲存。重新讀取可回到雲端版本。');
          }).catch(() => setNotice('草稿暫時讀不到，原始資料仍保留。'));
        }} /> : null}
        <Text style={{ color: theme.colors.muted }}>每週基準課表；指定日期的安排請查看上方。</Text>
        <PersonalImportSummary kind="timetable" />
        {importStatus === 'error' ? (
          <View>
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
              匯入課表暫時讀不到，目前不能確認空堂，請重新讀取。
            </Text>
            <Button text="重試匯入課表" onPress={() => void load()} />
          </View>
        ) : null}
        {loadError ? (
          <View>
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>
              手動課表暫時讀不到，先保留上次讀取的內容；目前不能確認空堂。
            </Text>
            <Button text="重試課表" onPress={() => void load()} />
          </View>
        ) : null}
        {importTerms.length ? <View style={{ gap: 8 }}>
          <Text style={{ color: theme.colors.muted }}>正在查看：{selectedView === 'legacy' ? `原有課表（${timetable.meta.year && timetable.meta.semester ? `${timetable.meta.year}／${timetable.meta.semester}` : '學期未填'}）` : selectedView}。匯入課程只存在這台裝置，不會透過好友課表分享。</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}><Button text="自行編輯的課表" kind={selectedView === 'legacy' ? 'primary' : 'outline'} onPress={() => setImportTerm('legacy')} />{allTerms.map((term) => <Button key={term.key} text={`${term.academicYear}／${term.semester}`} kind={term.key === activeTerm && importTerm !== 'legacy' ? 'primary' : 'outline'} onPress={() => setImportTerm(term.key)} />)}</View>
        </View> : null}
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
          <Button text="格子" disabled={!profile} onPress={() => setView('grid')} />
          <Button text="新增" disabled={!profile} onPress={() => { setImportTerm('legacy'); setEditing(cleanCourse({ day, start: 1, end: 1 }, { periodCount: periods.length })); }} />
        </View>
        {!profile ? <Text style={{ color: theme.colors.muted }}>這所學校尚未提供節次時間表。可在匯入紀錄填寫實際時間；不套用其他學校的節次。</Text> : null}
        {listedImports.map((row) => <Pressable key={row.id} onPress={() => safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' })} style={{ gap: 6, paddingVertical: 12 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{row.title}</Text>
          <Text style={{ color: theme.colors.muted }}>週{['', '一', '二', '三', '四', '五', '六', '日'][row.dayOfWeek || 0] || '未填'} · {row.startTime && row.endTime ? `${row.startTime}–${row.endTime}` : '時間未確認'} · {row.location || '教室未填'} · 個人匯入</Text>
        </Pressable>)}
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
            {times.map((time, index) => {
              const period = index + 1;
              return (
                <View key={period} style={{ flexDirection: 'row', minHeight: 36, alignItems: 'stretch' }}>
                  <Text style={{ width: 44, color: theme.colors.muted, fontSize: 10 }}>
                    {periods[index].label}
                    {'\n'}
                    {time[0]}
                  </Text>
                  {WEEKDAY_LABELS.map((_, dayIndex) => {
                    const hit = displayCourses.find(
                      (course) => course.day === dayIndex + 1 && period >= course.start && period <= course.end,
                    );
                    return (
                      <Pressable
                        key={`${period}-${dayIndex}`}
                        onPress={() => hit && openCourse(hit)}
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
          <Text style={{ color: theme.colors.muted }}>{listedImports.length ? '以上課程保留原始時間，未放入節次格子。' : '這份課表目前沒有可列出的課程。可匯入或新增自己的資料。'}</Text>
        ) : (
          visible.map((course) => (
            <Pressable
              key={course.id}
              onPress={() => openCourse(course)}
              style={{
                borderWidth: 1,
                borderColor: theme.colors.separator,
                borderRadius: 12,
                padding: 12,
                backgroundColor: theme.colors.card,
              }}
            >
              <Text style={{ color: theme.colors.muted }}>
                {WEEKDAY_LABELS[course.day - 1] || '未排定'} · {profile ? periodRangeLabel(course.start, course.end, profile) : '節次時間未確認'}
              </Text>
              <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>{course.name}</Text>
              <Text style={{ color: theme.colors.muted }}>
                {course.teacher || '教師未填'} · {course.room || '教室未填'}{course.id.startsWith('import:') ? ' · 個人匯入' : ''}
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
            <Text style={{ color: theme.colors.text }}>開始節次</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {periods.map((slot) => <Button key={slot.index} text={`開始 ${slot.label}`} kind={editing.start === slot.index ? 'primary' : 'outline'} onPress={() => setEditing({ ...editing, start: slot.index, end: Math.max(slot.index, editing.end) })} />)}
            </View>
            <Text style={{ color: theme.colors.text }}>結束節次</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {periods.map((slot) => <Button key={slot.index} text={`結束 ${slot.label}`} disabled={slot.index < editing.start} kind={editing.end === slot.index ? 'primary' : 'outline'} onPress={() => setEditing({ ...editing, end: slot.index })} />)}
            </View>
            <Text style={{ color: theme.colors.muted }}>{profile ? periodRangeLabel(editing.start, editing.end, profile) : '節次時間未確認'}</Text>
            <TextInput
              value={editing.room}
              onChangeText={(room) => setEditing({ ...editing, room })}
              placeholder="教室"
              style={inputStyle}
            />
            <Button
              text="儲存"
              onPress={async () => {
                if (!profile) return;
                const cleaned = cleanCourse(editing, { periodCount: periodCount(profile) });
                const next = timetable.courses.some((item) => item.id === cleaned.id)
                  ? timetable.courses.map((item) => (item.id === cleaned.id ? cleaned : item))
                  : [...timetable.courses, cleaned];
                if (await persist({ ...timetable, courses: next }, '課程已更新。')) setEditing(null);
              }}
            />
            <Button text="取消" onPress={() => setEditing(null)} />
          </View>
        ) : null}

        <Text style={{ fontWeight: '700', color: theme.colors.text }}>幫我安排</Text>
        {!planner ? <Text style={{ color: theme.colors.muted }}>{loadError || importStatus !== 'ready' ? '課表尚未完整讀取，暫不推算空堂。' : '部分課程無法對應節次，暫不推算空堂。請先核對上課時間。'}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button text="下一堂" disabled={!planner} onPress={() => setAnswer([planner?.ask('下一堂') || '課表上還沒有排課。'])} />
          <Button
            text="今天空堂"
            disabled={!planner}
            onPress={() => {
              const today = new Date().getDay();
              setAnswer(
                today >= 1 && today <= 5
                  ? [planner?.ask('今天空堂') || '今天沒有空堂。']
                  : ['空堂試算僅支援週一至週五，週末課程請查看匯入紀錄。'],
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
            disabled={!planner}
            onPress={() => {
              if (!profile || !planner) return;
              const slots = studySlots(displayCourses, studyDay, studyHours, profile);
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
                const theirs = await loadFriendTimetable(friend.uid, schoolId).catch(() => null);
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
          {times.length ? `${school.name}節次時間：${times[0][0]}–${times[times.length - 1][1]}。` : '未取得這所學校的節次時間表。'}
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
