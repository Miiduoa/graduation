import { PersonalCalendarExport } from '../components/PersonalCalendarExport';
import { ClassReminderToggle } from '../components/ClassReminderToggle';
import { ClassExceptions } from '../components/ClassExceptions';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import {
  validClassDate,
  isPersonalImportTime,
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
import { useTabBarContentBottomPadding } from '../ui/navigationTheme';
import { useThemeVersion } from '../ui/useThemeStyleSheet';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { toPublicSchoolId } from '../data/schoolIds';
import { usePersonalImportScope } from '../state/personalImportScope';
import { findSavedClassOccurrences } from '../services/nextSavedClasses';
import type { PreAuthStackParamList } from './preAuthTypes';
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
  restorePersonalTimetableDraft,
  personalTimetableRecords,
  type StoredTimetable,
} from '../services/personalTimetable';
import { listAcceptedFriends, opponentUidFromFriendship } from '../services/friends';
import { resolveTimetableClassroomNav } from '../hooks/timetableClassroomNav';

/** The guest and account stacks already provide the title, back button and top inset. */
export function StackTitledPersonalTimetable() {
  return <PersonalTimetableScreen stackTitled />;
}

export function PublicPersonalTimetable() {
  return <PersonalTimetableScreen stackTitled publicEntry />;
}

export default function PersonalTimetableScreen({ stackTitled = false, publicEntry = false }: {
  stackTitled?: boolean;
  publicEntry?: boolean;
} = {}) {
  const auth = useAuth();
  const { school } = useSchool();
  const scope = usePersonalImportScope();
  const route = useRoute();
  const params = route.params as PreAuthStackParamList['PersonalTimetable'];
  const schoolId = school?.id || 'pu';
  const scopeMatches = params?.reminderScope === undefined ||
    (scope && params.reminderScope === JSON.stringify(scope));
  const sameSchool = scopeMatches && params?.schoolId === schoolId;
  const term = scopeMatches && (!params?.schoolId || sameSchool) ? params?.term : undefined;
  const courseId = sameSchool ? params.courseId : undefined;
  const date = sameSchool && params.date && validClassDate(params.date) ? params.date : undefined;
  const startAt = date ? params?.startAt : undefined;
  return <PersonalTimetableWorkspace
    key={JSON.stringify([auth.user?.uid, schoolId, scope?.owner, term, courseId, date, startAt])}
    title={stackTitled ? undefined : '我的課表'}
    courseworkAvailable={!publicEntry}
    initialDate={date} initialCourseId={courseId} initialTerm={term} initialStartAt={startAt}
  />;
}

function PersonalTimetableWorkspace({ title, courseworkAvailable, initialTerm, initialCourseId, initialDate, initialStartAt }: {
  title?: string; courseworkAvailable: boolean; initialTerm?: string; initialCourseId?: string; initialDate?: string; initialStartAt?: number;
}) {
  useThemeVersion();
  const bottomPadding = useTabBarContentBottomPadding();
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
    // Calendar dates are Sunday=0; timetable days use Monday=1…Sunday=7.
    // Weekend classes are now visible, so open the actual current day.
    return today === 0 ? 7 : today;
  });
  const [editing, setEditing] = useState<PersonalCourse | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const editorOffset = useRef(0);
  const revealEditor = useRef(false);
  const editorHeading = useRef<View>(null);
  const showEditor = () => {
    scrollRef.current?.scrollTo({ y: editorOffset.current, animated: false });
    const heading = editorHeading.current;
    if (!heading) return;
    if (Platform.OS === 'web') heading.focus();
    else AccessibilityInfo.sendAccessibilityEvent(heading, 'focus');
  };
  const startEditing = (course: PersonalCourse) => {
    if (editing) showEditor();
    revealEditor.current = !editing;
    setEditing(course);
  };
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
  const records = useMemo(() => {
    const rows = timetable ? personalTimetableRecords(timetable, importedRecords) : importedRecords;
    return rows.map((row) => row.schoolId !== schoolId && toPublicSchoolId(row.schoolId) === toPublicSchoolId(schoolId)
      ? { ...row, schoolId } : row);
  }, [timetable, importedRecords, schoolId]);
  const allTerms = personalTimetableTerms(records, schoolId);
  const importTerms = allTerms.map((term) => term.key);
  const selectedTerm = allTerms.find((term) => term.key === importTerm) ?? allTerms[0];
  const activeTerm = selectedTerm?.key;
  const manualTerm = timetable ? `${timetable.meta.year || '未填'}|${timetable.meta.semester || '未填'}` : '';
  const selectedView = importTerm === 'legacy' || activeTerm === manualTerm
    ? 'legacy' : selectedTerm && `${selectedTerm.academicYear}／${selectedTerm.semester}`;
  const displayCourses = useMemo(() => selectPersonalTimetableCourses(timetable, importedRecords, schoolId, selectedView), [timetable, importedRecords, schoolId, selectedView]);
  const viewTerm = selectedView === 'legacy' ? manualTerm : activeTerm;
  const matchesTerm = initialTerm === undefined || viewTerm === initialTerm;
  const occurrences = useMemo(() => {
    if (!initialDate || !initialCourseId || !timetable || !matchesTerm || loadError || importStatus !== 'ready') return [];
    return findSavedClassOccurrences(records, {
      schoolId, term: viewTerm, courseId: initialCourseId, date: initialDate, startAt: initialStartAt,
    });
  }, [initialDate, initialCourseId, timetable, matchesTerm, records, viewTerm, schoolId, initialStartAt, loadError, importStatus]);
  const datedCourse = occurrences.length === 1 ? occurrences[0] : undefined;
  const selectedCourse = matchesTerm && (!initialDate || datedCourse) ? displayCourses.find((course) =>
    course.id === initialCourseId || `manual:${course.id}` === initialCourseId || course.id === `import:${initialCourseId}`) : undefined;
  useEffect(() => {
    if (selectedCourse?.day) setDay(selectedCourse.day);
  }, [selectedCourse?.day]);
  const placedImportIds = useMemo(() => new Set(
    personalImportCourses(importedRecords, schoolId).map((course) => course.id),
  ), [importedRecords, schoolId]);
  const openCourseWork = (course: PersonalCourse) => {
    const importId = course.id.startsWith('import:') ? course.id.slice('import:'.length) : '';
    const importedRow = importId
      ? importedRecords.find((row) => row.id === importId)
      : undefined;
    const destination = resolveTimetableClassroomNav({
      linkedCourseId: importedRow?.linkedCourseId,
      courseName: course.name,
      courseCode: importedRow?.courseCode,
    });
    safeNavigate(navigation, destination.screen, destination.params);
  };
  const openCourse = (course: PersonalCourse) => course.id.startsWith('import:')
    || !profile ? safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' }) : startEditing(course);
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

  // Weekend classes appear on the timetable; the existing free-time planner
  // and meetup calculations still operate on Monday through Friday only.
  const weekdayCourses = useMemo(
    () => displayCourses.filter((course) => course.day >= 1 && course.day <= 5),
    [displayCourses],
  );
  const planner = useMemo(
    () => profile && !loadError && importStatus === 'ready' && !listedImports.length ? new SchedulePlanner(weekdayCourses, friendId ? [{ id: friendId, name: '好友', courses: friendCourses }] : [], friendId, profile) : null,
    [weekdayCourses, friendId, friendCourses, profile, listedImports.length, importStatus, loadError],
  );

  if (!timetable) {
    return (
      <Screen title={title}>
        <Text
          accessibilityRole={loadError ? 'alert' : undefined}
          style={{ color: theme.colors.muted, fontSize: 15, lineHeight: 22, paddingVertical: 16 }}
        >{loadError ? '課表暫時讀不到，請重新讀取。' : !importScope ? '正在確認帳號，暫時不顯示個人課表。' : '正在讀取課表…'}</Text>
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

  const windows = friendId && profile && !loadError && importStatus === 'ready' && !listedImports.length ? meetupWindows(weekdayCourses, friendCourses, profile) : [];
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

  let occurrenceSummary: string | undefined;
  if (initialDate) {
    if (loadError || importStatus === 'error') occurrenceSummary = '課表暫時讀不到，請重新讀取後核對上課時間。';
    else if (importStatus === 'loading') occurrenceSummary = '正在核對上課時間…';
    else if (!matchesTerm) occurrenceSummary = '目前課表的學期與原先選取的課程不同，請核對學期。';
    else if (occurrences.length > 1) occurrenceSummary = '這一天有多筆符合的上課紀錄，請核對課表時段。';
    else if (datedCourse) occurrenceSummary = `${initialDate} · ${datedCourse.startTime}–${datedCourse.endTime} · ${datedCourse.row.location || '教室未填'}`;
    else occurrenceSummary = '這個時段目前沒有排這堂課，請查看調整紀錄。';
  }

  const entries = buildTimetableEntries({
    courses: displayCourses,
    originals: listedImports,
    profile,
    times,
    selectedCourseId: selectedCourse?.id,
  });
  const shownEntries = view === 'day' ? entries.filter((entry) => entry.day === day) : entries;
  const groups = view === 'day'
    ? [{ day, entries: shownEntries }]
    : TIMETABLE_GROUP_ORDER
      .map((groupDay) => ({ day: groupDay, entries: entries.filter((entry) => entry.day === groupDay) }))
      .filter((group) => group.entries.length > 0);
  const gridOriginals = groups
    .map((group) => ({ ...group, entries: group.entries.filter((entry) => entry.original) }))
    .filter((group) => group.entries.length > 0);
  const termKey = selectedView === 'legacy' ? manualTerm : activeTerm;
  const exportRecords = personalTimetableRecords(timetable, importedRecords);
  const colors = theme.colors;

  const exceptionsPanel = (
    <ClassExceptions key={`exceptions:${importScopeKey}`} records={exportRecords}
      exceptions={timetable.classExceptions} schoolId={schoolId} initialDate={matchesTerm ? initialDate : undefined}
      termKey={termKey}
      disabled={loadError || importStatus !== 'ready'}
      onSave={(classExceptions) => persist({ ...timetable, classExceptions }, '這次安排已儲存。', true)} />
  );

  const renderEntry = (entry: TimetableEntry) => {
    const verified = entry.sort !== undefined;
    const dayLabel = TIMETABLE_DAY_LABELS[entry.day - 1] || '未排定星期';
    const course = entry.course;
    const original = entry.original;
    const openEntry = () => {
      if (course) openCourse(course);
      else safeNavigate(navigation, 'PersonalImport', { kind: 'timetable' });
    };
    return (
      <View
        key={entry.key}
        testID="timetable-row"
        style={{
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.separator,
          ...(entry.selected && { borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 8 }),
          paddingVertical: 6,
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 8,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: entry.selected }}
          accessibilityLabel={`${entry.title}，${dayLabel}，${entry.time}，${entry.detail}${original ? '，原始匯入，未放入節次' : ''}`}
          accessibilityHint={original || !profile || course?.id.startsWith('import:') ? '開啟匯入紀錄' : '查看或編輯課程'}
          onPress={openEntry}
          style={({ pressed }) => ({ minHeight: 44, flexBasis: 172, flexGrow: 1, flexShrink: 1, justifyContent: 'center', paddingVertical: 5, gap: 2, opacity: pressed ? 0.65 : 1 })}
        >
          <Text
            style={verified
              ? { color: colors.textSecondary, fontSize: 14, lineHeight: 21, fontWeight: '500', fontVariant: ['tabular-nums'] }
              : { color: colors.muted, fontSize: 14, lineHeight: 21 }}
          >
            {entry.time}
          </Text>
          <Text style={{ color: colors.text, fontSize: 18, lineHeight: 25, fontWeight: '600' }}>{entry.title}</Text>
          <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{entry.detail}</Text>
          {original ? (
            <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>原始匯入，未放入節次</Text>
          ) : null}
        </Pressable>
        {course && courseworkAvailable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`作業與教材：${entry.title}`}
            onPress={() => openCourseWork(course)}
            style={({ pressed }) => ({ minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 4, opacity: pressed ? 0.65 : 1 })}
          >
            <Text style={{ color: colors.accent, fontSize: 14, fontWeight: '500' }}>作業與教材</Text>
          </Pressable>
        ) : null}
      </View>
    );
  };

  const renderGroup = (group: { day: number; entries: TimetableEntry[] }, emptyText?: string) => (
    <View key={group.day} style={{ gap: 0 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, lineHeight: 26, fontWeight: '700', paddingBottom: 6 }}>
        {TIMETABLE_DAY_LABELS[group.day - 1] || '未排定星期'}
      </Text>
      {group.entries.length
        ? group.entries.map(renderEntry)
        : <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22, paddingVertical: 8 }}>{emptyText}</Text>}
    </View>
  );

  const emptyMessage = importStatus === 'loading' ? '正在讀取匯入課表…'
    : importStatus === 'error' || loadError ? '課表尚未完整讀取。'
    : view !== 'day' ? '這份課表目前沒有可列出的課程。可匯入或新增自己的資料。'
    : entries.some((entry) => !entry.day) ? '這天沒有已排定的課程，另有課程的星期待確認。'
    : '這天沒有排課。';
  const sectionTitle = {
    color: colors.text,
    fontSize: theme.typography.h3.fontSize,
    lineHeight: theme.typography.h3.lineHeight,
    fontWeight: '700' as const,
  };

  return (
    <Screen title={title} noPadding>
      {notice ? (
        <View
          accessibilityLiveRegion="polite"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingVertical: 4,
            paddingHorizontal: theme.layout.screenHorizontalPadding,
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.separator,
          }}
        >
          <Text style={{ flex: 1, color: colors.text, fontSize: 15, lineHeight: 22 }}>{notice}</Text>
          <Button text="關閉" kind="ghost" size="small" accessibilityLabel="關閉提示" onPress={() => setNotice('')} />
        </View>
      ) : null}
      <ScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16, paddingTop: 8, paddingHorizontal: theme.layout.screenHorizontalPadding, paddingBottom: bottomPadding }}>
        {initialCourseId ? <View
          style={{ borderLeftWidth: 3, borderLeftColor: colors.accent, paddingLeft: 10, paddingVertical: 4, gap: 4 }}
        >
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 17, lineHeight: 24, fontWeight: '700' }}>{datedCourse?.row.title || selectedCourse?.name || (initialDate ? '上課時間' : '這堂課已變更，請核對目前課表')}</Text>
          {occurrenceSummary ? <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>{occurrenceSummary}</Text> : selectedCourse ? <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>{selectedCourse.room || '教室未填'}</Text> : null}
          {initialDate && (loadError || importStatus === 'error') && <Button text="重新核對這堂課" onPress={() => void load()} />}
        </View> : null}
        {initialDate ? exceptionsPanel : null}
        {importStatus === 'error' ? (
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15, lineHeight: 22 }}>
              匯入課表暫時讀不到，目前不能確認空堂，請重新讀取。
            </Text>
            <Button text="重試匯入課表" onPress={() => void load()} />
          </View>
        ) : null}
        {loadError ? (
          <View style={{ gap: 6 }}>
            <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15, lineHeight: 22 }}>
              手動課表暫時讀不到，先保留上次讀取的內容；目前不能確認空堂。
            </Text>
            <Button text="重試課表" onPress={() => void load()} />
          </View>
        ) : null}
        {invites.length > 0 ? (
          <View accessibilityLabel="有人約你" style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={sectionTitle}>有人約你</Text>
            {invites.map((item) => (
              <View key={item.id} style={{ gap: 6 }}>
                <Text style={{ color: colors.text }}>
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

        {importTerms.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 4 }}>
            <Text style={{ color: colors.muted, fontSize: 13, marginRight: 4 }}>學期</Text>
            <Choice label="自行編輯的課表" selected={importTerm === 'legacy'} onPress={() => setImportTerm('legacy')} />
            {allTerms.map((term) => <Choice key={term.key} label={`${term.academicYear}／${term.semester}`} selected={term.key === activeTerm && importTerm !== 'legacy'} onPress={() => setImportTerm(term.key)} />)}
          </View>
        )}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 3, gap: 2, borderRadius: 12, backgroundColor: colors.surface2, maxWidth: '100%' }}>
              <Choice segment label="一週" selected={view === 'week'} onPress={() => setView('week')} />
              <Choice segment label="單日" selected={view === 'day'} onPress={() => setView('day')} />
              <Choice segment label="格子" selected={view === 'grid'} disabled={!profile} onPress={() => setView('grid')} />
            </View>
            <Button text="新增" kind="ghost" icon="add" disabled={!profile} onPress={() => {
              setImportTerm('legacy');
              startEditing(cleanCourse({ day, start: 1, end: 1 }, { periodCount: periods.length }));
            }} />
          </View>
          {view === 'day' && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 }}>
              {TIMETABLE_DAY_LABELS.map((label, index) => (
                <Choice key={label} label={WEEKDAYS_SHORT[index]} accessibilityLabel={label} selected={day === index + 1} onPress={() => setDay(index + 1)} />
              ))}
            </View>
          )}
        </View>
        {!profile ? <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>這所學校尚未提供節次時間表。可在匯入紀錄填寫實際時間；不套用其他學校的節次。</Text> : null}

        {editing ? (
          <View style={{ gap: 8 }} onLayout={({ nativeEvent }) => {
            editorOffset.current = nativeEvent.layout.y;
            if (revealEditor.current) {
              revealEditor.current = false;
              showEditor();
            }
          }}>
            <View ref={editorHeading} accessible accessibilityRole="header" accessibilityLabel="編輯課程" tabIndex={-1}>
              <Text style={sectionTitle}>編輯課程</Text>
            </View>
            <TextInput
              value={editing.name}
              onChangeText={(name) => setEditing({ ...editing, name })}
              placeholder="課名"
              accessibilityLabel="課名"
              placeholderTextColor={colors.muted}
              style={inputStyle()}
            />
            <TextInput
              value={String(editing.day)}
              onChangeText={(value) => setEditing({ ...editing, day: Number(value) || 0 })}
              placeholder="星期 1-5，0 代表未排定"
              accessibilityLabel="星期"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              style={inputStyle()}
            />
            <Text style={{ color: colors.text }}>開始節次</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {periods.map((slot) => <Button key={slot.index} text={`開始 ${slot.label}`} kind={editing.start === slot.index ? 'primary' : 'outline'} onPress={() => setEditing({ ...editing, start: slot.index, end: Math.max(slot.index, editing.end) })} />)}
            </View>
            <Text style={{ color: colors.text }}>結束節次</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {periods.map((slot) => <Button key={slot.index} text={`結束 ${slot.label}`} disabled={slot.index < editing.start} kind={editing.end === slot.index ? 'primary' : 'outline'} onPress={() => setEditing({ ...editing, end: slot.index })} />)}
            </View>
            <Text style={{ color: colors.muted }}>{profile ? periodRangeLabel(editing.start, editing.end, profile) : '節次時間未確認'}</Text>
            <TextInput
              value={editing.room}
              onChangeText={(room) => setEditing({ ...editing, room })}
              placeholder="教室"
              accessibilityLabel="教室"
              placeholderTextColor={colors.muted}
              style={inputStyle()}
            />
            {editing.name.trim() && courseworkAvailable ? (
              <Button text="作業與教材" kind="outline" onPress={() => openCourseWork(editing)} />
            ) : null}
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

        <View testID="timetable-body">
        {view === 'grid' ? (
          <View style={{ gap: 16 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator accessibilityLabel="一週課表，可橫向捲動查看週末">
              <View style={{ minWidth: 52 + 7 * 64 }}>
                <View style={{ flexDirection: 'row' }}>
                  <Text style={{ width: 52, color: colors.muted, fontSize: 12 }}>節</Text>
                  {WEEKDAYS_SHORT.map((label) => (
                    <Text key={label} style={{ flex: 1, minWidth: 64, color: colors.muted, fontSize: 13, textAlign: 'center' }}>
                      {label}
                    </Text>
                  ))}
                </View>
                {times.map((time, index) => {
                  const period = index + 1;
                  return (
                    <View key={period} style={{ flexDirection: 'row', minHeight: 48, alignItems: 'stretch' }}>
                      <Text style={{ width: 52, color: colors.muted, fontSize: 12 }}>
                        {periods[index].label}
                        {'\n'}
                        {time[0]}
                      </Text>
                      {TIMETABLE_DAY_LABELS.map((dayLabel, dayIndex) => {
                        const hit = displayCourses.find(
                          (course) => course.day === dayIndex + 1 && period >= course.start && period <= course.end,
                        );
                        return (
                          <Pressable
                            key={`${period}-${dayIndex}`}
                            disabled={!hit}
                            accessible={!!hit}
                            accessibilityRole={hit ? 'button' : undefined}
                            accessibilityLabel={hit ? `${hit.name}，${dayLabel}，${profile ? periodRangeLabel(hit.start, hit.end, profile) : '節次時間未確認'}` : undefined}
                            onPress={() => hit && openCourse(hit)}
                            style={{
                              flex: 1,
                              minWidth: 64,
                              borderWidth: StyleSheet.hairlineWidth,
                              borderColor: colors.separator,
                              backgroundColor: hit ? colors.card : 'transparent',
                              padding: 3,
                            }}
                          >
                            {hit && period === hit.start ? (
                              <Text numberOfLines={3} style={{ color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '700' }}>
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
            </ScrollView>
            {gridOriginals.length ? (
              <View style={{ gap: 12 }}>
                <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>以下原始匯入保留原始時間，未放入節次格子。</Text>
                {gridOriginals.map((group) => renderGroup(group))}
              </View>
            ) : null}
          </View>
        ) : view === 'day' ? (
          <View>
            {renderGroup(groups[0], emptyMessage)}
          </View>
        ) : groups.length === 0 ? (
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>{emptyMessage}</Text>
        ) : (
          <View style={{ gap: 16 }}>{groups.map((group) => renderGroup(group))}</View>
        )}
        </View>

        {importScope && importScope.owner !== 'guest:device' && <ClassReminderToggle key={importScopeKey} scope={importScopeKey} />}
        <PersonalCalendarExport key={`calendar:${importScopeKey}:${termKey}`} records={exportRecords} schoolId={schoolId}
          termKey={termKey}
          disabled={loadError || importStatus !== 'ready'} />
        {initialDate ? null : exceptionsPanel}
        <PersonalImportSummary kind="timetable" />
        <Button text="儲存每週基準課表" disabled={loadError} onPress={() => void persist(timetable, '每週基準課表已儲存。')} />
        {importTerms.length > 0 && <Text style={{ color: colors.muted }}>匯入課程只存在這台裝置，不會透過好友課表分享。</Text>}
        {uid && !localOwner ? <Button text="重新讀取雲端課表" onPress={() => void load()} /> : null}
        {uid && !localOwner ? <Button text="檢視這台裝置未同步草稿" onPress={() => {
          const requestScope = importScopeKey;
          const run = loadGeneration.current;
          void loadPersonalTimetableDraft(uid, schoolId).then((draft) => {
            if (scopeRef.current !== requestScope || loadGeneration.current !== run) return;
            if (!draft) { setNotice('這台裝置沒有未同步草稿。'); return; }
            setTimetable(restorePersonalTimetableDraft(timetable, draft));
            if (draft.pendingBase !== false) setImportTerm('legacy');
            setNotice('目前預覽未同步課表；請核對每週基準與單次安排，分別儲存。重新讀取可回到雲端版本。');
          }).catch(() => setNotice('草稿暫時讀不到，原始資料仍保留。'));
        }} /> : null}
        {uid ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: timetable.shareWithFriends !== false }}
            onPress={() =>
              void persist(
                { ...timetable, shareWithFriends: timetable.shareWithFriends === false },
                timetable.shareWithFriends === false
                  ? '好友加完後看得到這份課表。'
                  : '已關掉好友課表。對方現在看不到。',
              )
            }
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
              {timetable.shareWithFriends === false ? '目前好友看不到這份課表（點一下開放）' : '已接受的好友可以看到這份課表（點一下關閉）'}
            </Text>
          </Pressable>
        ) : null}

        <Text accessibilityRole="header" style={sectionTitle}>幫我安排</Text>
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
              const slots = studySlots(weekdayCourses, studyDay, studyHours, profile);
              setAnswer(slots.length ? slots : ['這天的空堂都不夠長，換一天或少排一點。']);
            }}
          />
        </View>
        {answer.map((line) => (
          <Text key={line} style={{ color: theme.colors.text }}>
            {line}
          </Text>
        ))}

        <Text accessibilityRole="header" style={sectionTitle}>分享</Text>
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

        <Text accessibilityRole="header" style={sectionTitle}>共同空堂</Text>
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

const TIMETABLE_DAY_LABELS = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];
const WEEKDAYS_SHORT = ['一', '二', '三', '四', '五', '六', '日'];
/** Weekdays first; day 0 holds courses and imports that have no usable weekday. */
const TIMETABLE_GROUP_ORDER = [1, 2, 3, 4, 5, 6, 7, 0];

type TimetableEntry = {
  key: string;
  day: number;
  /** Valid 24-hour clock values sort chronologically as HH:mm strings. */
  sort?: string;
  order: number;
  time: string;
  title: string;
  detail: string;
  selected: boolean;
  course?: PersonalCourse;
  original?: PersonalImportRecord;
};

function weekdayGroup(day?: number) {
  return Number.isInteger(day) && day! >= 1 && day! <= 7 ? day! : 0;
}

function buildTimetableEntries({ courses, originals, profile, times, selectedCourseId }: {
  courses: PersonalCourse[];
  originals: PersonalImportRecord[];
  profile: ReturnType<typeof periodProfileForSchool>;
  times: ReadonlyArray<readonly [string, string]>;
  selectedCourseId?: string;
}): TimetableEntry[] {
  const placed = courses.map((course): TimetableEntry => ({
    key: `course:${course.id}`,
    day: weekdayGroup(course.day),
    sort: profile && times[course.end - 1] ? times[course.start - 1]?.[0] : undefined,
    order: course.start,
    time: profile ? periodRangeLabel(course.start, course.end, profile) : '節次時間未確認',
    title: course.name,
    detail: [course.room || '教室未填', course.teacher, course.id.startsWith('import:') ? '個人匯入' : '']
      .filter(Boolean).join(' · '),
    selected: course.id === selectedCourseId,
    course,
  }));
  const unresolved = originals.map((row): TimetableEntry => ({
    key: `original:${row.id}`,
    day: weekdayGroup(row.dayOfWeek),
    sort: row.startTime && row.endTime && isPersonalImportTime(row.startTime) && isPersonalImportTime(row.endTime) ? row.startTime : undefined,
    order: Number.MAX_SAFE_INTEGER,
    time: row.startTime && row.endTime
      ? `${row.startTime}–${row.endTime}`
      : row.periodLabel?.trim() ? `校方節次 ${row.periodLabel}` : '時間未確認',
    title: row.title,
    detail: [row.location || '教室未填', row.teacher].filter(Boolean).join(' · '),
    selected: false,
    original: row,
  }));
  return [...placed, ...unresolved].sort((a, b) =>
    (a.sort ?? '99:99').localeCompare(b.sort ?? '99:99') || a.order - b.order || a.title.localeCompare(b.title));
}

/** Local choice control: selected state and a 44pt target without changing shared buttons. */
function Choice({ label, selected, disabled, accessibilityLabel, onPress, segment = false }: {
  segment?: boolean;
  label: string;
  selected: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44, minWidth: 44, maxWidth: '100%', justifyContent: 'center', alignItems: 'center',
        paddingHorizontal: segment ? 14 : 8, paddingVertical: 5, borderRadius: segment ? 9 : 0,
        backgroundColor: segment && selected ? theme.colors.surface : 'transparent',
        borderBottomWidth: !segment && selected ? 2 : 0,
        borderColor: theme.colors.accent, opacity: pressed ? 0.65 : 1,
      })}
    >
      <Text
        style={{
          color: disabled ? theme.colors.disabledText : selected ? theme.colors.text : theme.colors.textSecondary,
          fontSize: 15, lineHeight: 21, fontWeight: selected ? '700' : '500', textAlign: 'center',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const inputStyle = () => ({
  borderWidth: 1,
  borderColor: theme.colors.separator,
  borderRadius: 10,
  padding: 12,
  minHeight: 44,
  color: theme.colors.text,
});
