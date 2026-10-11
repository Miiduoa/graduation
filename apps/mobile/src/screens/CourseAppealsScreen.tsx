import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  APPEAL_NEED_COURSE_COPY,
  APPEAL_STATUS_COPY,
  appealTimeValue,
  appealTopCard,
  type AppealStatus,
  type CourseAppeal,
  type PersonalCourse,
} from '@campus/shared';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import {
  createCourseAppeal,
  listCourseAppeals,
  loadPersonalTimetable,
  withdrawCourseAppeal,
} from '../services/personalTimetable';

function newRequestId() {
  return `appeal-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function CourseAppealsScreen() {
  const auth = useAuth();
  const { school } = useSchool();
  const uid = auth.user?.uid;
  const schoolId = school?.id || 'pu';
  const [items, setItems] = useState<CourseAppeal[]>([]);
  const [courses, setCourses] = useState<PersonalCourse[] | null>(null);
  const [courseId, setCourseId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(newRequestId());

  const load = useCallback(async () => {
    if (!uid) return;
    const [rows, timetable] = await Promise.all([
      listCourseAppeals(schoolId, uid),
      loadPersonalTimetable(uid, schoolId),
    ]);
    const list = rows as CourseAppeal[];
    list.sort((a, b) => appealTimeValue(b.updatedAt || b.createdAt) - appealTimeValue(a.updatedAt || a.createdAt));
    setItems(list);
    setCourses(timetable.courses.filter((course) => course.name.trim()));
  }, [uid, schoolId]);

  useFocusEffect(
    useCallback(() => {
      void load().catch(() => setNotice('現在讀不到申訴，請稍後再試。'));
    }, [load]),
  );

  const top = appealTopCard(items);
  const noCourses = courses !== null && courses.length === 0;
  const picked = courses?.find((course) => course.id === courseId);

  const submit = async () => {
    if (busy || !uid) return;
    if (!picked) {
      setNotice(noCourses ? APPEAL_NEED_COURSE_COPY : '請先選要申訴的課。');
      return;
    }
    if (title.trim().length < 4 || body.trim().length < 8) {
      setNotice('主旨至少四個字、說明至少八個字。');
      return;
    }
    const duplicate = items.some(
      (item) =>
        item.courseId === picked.id &&
        item.title.trim() === title.trim() &&
        (item.status === 'pending' || item.status === 'reviewing'),
    );
    if (duplicate) {
      setNotice('這門課已經有一樣主旨的申訴在等老師看了。');
      return;
    }
    setBusy(true);
    try {
      await createCourseAppeal(
        {
          schoolId,
          studentUid: uid,
          courseId: picked.id,
          courseName: picked.name,
          title: title.trim(),
          body: body.trim(),
        },
        requestId.current,
      );
      requestId.current = newRequestId();
      setNotice('已送出，等老師看。');
      setTitle('');
      setBody('');
      setCourseId('');
      await load();
    } catch {
      setNotice('這次沒有送出，請稍後再試。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="課程申訴" subtitle="送出後可以在這裡看老師處理到哪。">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>{top.title}</Text>
        <Text style={{ color: theme.colors.muted }}>{top.body}</Text>
        {notice ? <Text>{notice}</Text> : null}
        {!uid ? (
          <Text style={{ color: theme.colors.muted }}>請先登入再送出申訴。</Text>
        ) : noCourses ? (
          <Text style={{ color: theme.colors.muted }}>{APPEAL_NEED_COURSE_COPY}</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={{ fontWeight: '700', color: theme.colors.text }}>選一門課</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(courses || []).map((course) => {
                const active = course.id === courseId;
                return (
                  <Pressable
                    key={course.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setCourseId(course.id)}
                    style={{
                      paddingHorizontal: 12,
                      minHeight: 44,
                      justifyContent: 'center',
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: active ? theme.colors.accent : theme.colors.separator,
                      backgroundColor: active ? theme.colors.accentSoft : 'transparent',
                    }}
                  >
                    <Text style={{ color: theme.colors.text }}>{course.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput placeholder="主旨" value={title} onChangeText={setTitle} style={field} />
            <TextInput
              placeholder="說明（至少八個字）"
              value={body}
              onChangeText={setBody}
              multiline
              style={[field, { minHeight: 90 }]}
            />
            <Button text={busy ? '送出中…' : '送出'} disabled={busy || !courseId} onPress={() => void submit()} />
          </View>
        )}
        {items.map((item) => {
          const copy = APPEAL_STATUS_COPY[(item.status as AppealStatus) || 'pending'];
          return (
            <View key={item.id} style={{ padding: 12, borderWidth: 1, borderColor: theme.colors.separator, borderRadius: 12 }}>
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>
                {item.courseName} · {copy.label}
              </Text>
              <Text style={{ color: theme.colors.muted }}>{copy.detail}</Text>
              {item.teacherNote ? <Text style={{ color: theme.colors.muted }}>老師說：{item.teacherNote}</Text> : null}
              {item.status === 'pending' ? (
                <Button
                  text="撤回"
                  onPress={() => void withdrawCourseAppeal(item.id).then(() => load())}
                />
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const field = {
  borderWidth: 1,
  borderColor: theme.colors.separator,
  borderRadius: 10,
  padding: 12,
  minHeight: 44,
  color: theme.colors.text,
};
