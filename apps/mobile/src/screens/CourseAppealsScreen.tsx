import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { APPEAL_STATUS_COPY, appealTopCard, type AppealStatus, type CourseAppeal } from '@campus/shared';
import { Screen, Button } from '../ui/components';
import { theme } from '../ui/theme';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { createCourseAppeal, listCourseAppeals, withdrawCourseAppeal } from '../services/personalTimetable';

export default function CourseAppealsScreen() {
  const auth = useAuth();
  const { school } = useSchool();
  const uid = auth.user?.uid;
  const schoolId = school?.id || 'pu';
  const [items, setItems] = useState<CourseAppeal[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [courseName, setCourseName] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (!uid) return;
    const rows = (await listCourseAppeals(schoolId, uid)) as CourseAppeal[];
    setItems(rows);
  }, [uid, schoolId]);

  useFocusEffect(
    useCallback(() => {
      void load().catch(() => setNotice('現在讀不到申訴。沒有案件就不會有進度。'));
    }, [load]),
  );

  const top = appealTopCard(items);

  return (
    <Screen title="課程申訴" subtitle="頂卡跟著真實狀態">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 80 }}>
        <Text style={{ fontSize: 18, fontWeight: '700', color: theme.colors.text }}>{top.title}</Text>
        <Text style={{ color: theme.colors.muted }}>{top.body}</Text>
        {notice ? <Text>{notice}</Text> : null}
        {!uid ? (
          <Text style={{ color: theme.colors.muted }}>請先登入再送出申訴。</Text>
        ) : (
          <View style={{ gap: 8 }}>
            <TextInput placeholder="課程" value={courseName} onChangeText={setCourseName} style={field} />
            <TextInput placeholder="主旨" value={title} onChangeText={setTitle} style={field} />
            <TextInput
              placeholder="說明（至少八個字）"
              value={body}
              onChangeText={setBody}
              multiline
              style={[field, { minHeight: 90 }]}
            />
            <Button
              text="送出"
              onPress={() => {
                if (title.trim().length < 4 || body.trim().length < 8 || !courseName.trim()) {
                  setNotice('請填完課程、主旨與說明。沒填完不會送出。');
                  return;
                }
                void createCourseAppeal({
                  schoolId,
                  studentUid: uid,
                  courseId: courseName.trim(),
                  courseName: courseName.trim(),
                  title: title.trim(),
                  body: body.trim(),
                })
                  .then(async () => {
                    setNotice('已記在本站，等待教師查看。');
                    setTitle('');
                    setBody('');
                    setCourseName('');
                    await load();
                  })
                  .catch(() => setNotice('這次沒有送出。'));
              }}
            />
          </View>
        )}
        {items.map((item) => {
          const copy = APPEAL_STATUS_COPY[(item.status as AppealStatus) || 'pending'];
          return (
            <View key={item.id} style={{ padding: 12, borderWidth: 1, borderColor: theme.colors.separator, borderRadius: 12 }}>
              <Text style={{ fontWeight: '700', color: theme.colors.text }}>
                {copy.label} · {item.courseName}
              </Text>
              <Text style={{ color: theme.colors.muted }}>{copy.detail}</Text>
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
