import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NextBestAction } from '../data';
import type { DashboardTaskStatus } from '../hooks/useDashboardTasks';
import { useTheme } from '../state/theme';

type Props = {
  displayName: string;
  tasks: NextBestAction[];
  status: DashboardTaskStatus;
  onRetry(): void;
  onOpenTask(task: NextBestAction): void;
  onOpenCourses(): void;
  onOpenSchool(): void;
  onOpenCampus(): void;
};

export function DashboardTaskPanel(props: Props) {
  const theme = useTheme();
  const action = (label: string, description: string, onPress: () => void) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: pressed ? 0.65 : 1,
        gap: 5,
      })}
    >
      <Text style={{ color: theme.colors.accent, fontSize: 17, fontWeight: '600' }}>{label}</Text>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 14, lineHeight: 21 }}>
        {description}
      </Text>
    </Pressable>
  );
  return (
    <View style={{ paddingHorizontal: theme.space.lg, gap: 16 }}>
      <View style={{ gap: 5 }}>
        <Text style={{ color: theme.colors.textSecondary, fontSize: 14 }}>{props.displayName}</Text>
        <Text
          accessibilityRole="header"
          style={{ color: theme.colors.text, fontSize: 28, fontWeight: '700' }}
        >
          今天
        </Text>
      </View>
      <View>
        {action('課程與作業', '查看 Campus One 課程、繳交作業與測驗', props.onOpenCourses)}
        {action('校務服務', '查看已連結學校的課表、成績與出缺紀錄', props.onOpenSchool)}
        {action('校園服務', '查找校園地點、活動與生活服務', props.onOpenCampus)}
      </View>
      <View style={{ gap: 10, paddingVertical: 8 }}>
        <Text
          accessibilityRole="header"
          style={{ color: theme.colors.text, fontSize: 18, fontWeight: '600' }}
        >
          校務提醒
        </Text>
        {props.status === 'loading' ? (
          <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.textSecondary }}>
            正在讀取校務提醒…
          </Text>
        ) : props.status === 'error' ? (
          <>
            <Text accessibilityRole="alert" style={{ color: theme.colors.danger, lineHeight: 22 }}>
              校務提醒未能更新，請重新讀取。
            </Text>
            {action('重試校務提醒', '重新取得已連結學校的提醒', props.onRetry)}
          </>
        ) : props.tasks.length ? (
          props.tasks.map((task) => (
            <React.Fragment key={task.id}>
              {action(task.title, task.reason, () => props.onOpenTask(task))}
            </React.Fragment>
          ))
        ) : (
          <Text style={{ color: theme.colors.textSecondary, lineHeight: 22 }}>
            目前沒有校務提醒。Campus One 作業與測驗請到「課程與作業」查看。
          </Text>
        )}
      </View>
    </View>
  );
}
