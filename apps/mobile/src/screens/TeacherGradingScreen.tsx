import React from 'react';
import { Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import type { CourseSpace } from '../data';
import { listCourseSpaces } from '../data/courseSpaceSource';
import { useAsyncList } from '../hooks/useAsyncList';
import { canManageCourse } from '../services/courseWorkspace';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import { Button, Card, ErrorState, LoadingState, Screen } from '../ui/components';
import { theme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';
import { CourseGradebookScreen } from './CourseGradebookScreen';

type Params = Record<string, unknown> & {
  groupId?: string;
  courseSpaceId?: string;
  courseId?: string;
  courseName?: string;
  assignmentId?: string;
  assignmentTitle?: string;
};
type Props = {
  navigation?: Parameters<typeof safeNavigate>[0];
  route?: { key?: string; name?: string; params?: Params };
};
const routeId = (value: unknown) => typeof value === 'string' ? value.trim() : '';

function ChooseCourse({ navigation, unavailable = false }: { navigation: Props['navigation']; unavailable?: boolean }) {
  return <Screen>
    <Card title="查看課程成績" subtitle={unavailable ? '目前無法開啟這門課的成績' : '請先選擇授課課程'}>
      <Text style={{ color: theme.colors.muted, lineHeight: 22, marginBottom: 16 }}>
        {unavailable ? '請從你的授課清單重新選擇課程，確認目前可查看的成績。' : '從授課清單開啟課程，查看學生繳交與評分紀錄。'}
      </Text>
      <Button text="選擇授課課程" kind="primary" onPress={() => { safeNavigate(navigation, 'LearnHome'); }} />
    </Card>
  </Screen>;
}

function VerifiedCourse({ navigation, route, userId, schoolId, groupId, courseId }: Props & { userId: string; schoolId: string; groupId: string; courseId: string }) {
  const { items: courses, loading, error, reload } = useAsyncList<CourseSpace>(
    () => listCourseSpaces(userId, schoolId), [userId, schoolId],
  );
  if (loading) return <LoadingState title="查看課程成績" subtitle="正在確認授課課程…" rows={3} />;
  if (error) return <ErrorState title="查看課程成績" subtitle="無法讀取授課清單，請確認連線後重試。" actionText="重新讀取" onAction={reload} />;

  const exact = courses.filter(course => course.groupId === (groupId || courseId));
  const matches = groupId || exact.length ? exact : courses.filter(course => course.courseId === courseId);
  if (matches.length !== 1 || !canManageCourse(matches[0].role)) return <ChooseCourse navigation={navigation} unavailable />;
  const selected = matches[0];

  return <CourseGradebookScreen navigation={navigation} route={{ ...route, params: {
    ...route?.params, groupId: selected.groupId, groupName: selected.name, sourceSystem: 'workspace',
  } }} />;
}

export default function TeacherGradingScreen(props: Props) {
  const fallbackNavigation = useNavigation();
  const navigation = props.navigation ?? fallbackNavigation;
  const auth = useAuth();
  const { school } = useSchool();
  const schoolId = auth.profile?.schoolId ?? school.id;
  const groupId = routeId(props.route?.params?.groupId) || routeId(props.route?.params?.courseSpaceId);
  const courseId = routeId(props.route?.params?.courseId);
  if (!auth.user?.uid || (!groupId && !courseId)) return <ChooseCourse navigation={navigation} />;

  return <VerifiedCourse key={JSON.stringify([auth.user.uid, schoolId, groupId, courseId])}
    navigation={navigation} route={props.route} userId={auth.user.uid} schoolId={schoolId} groupId={groupId} courseId={courseId} />;
}
