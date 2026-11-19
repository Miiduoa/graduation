import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ORAL_EXAM_ACCOUNTS,
  ORAL_EXAM_AI_CONTEXT,
  ORAL_EXAM_ANNOUNCEMENTS,
  ORAL_EXAM_ASSIGNMENTS,
  ORAL_EXAM_ATTENDANCE,
  ORAL_EXAM_CALENDAR,
  ORAL_EXAM_COURSES,
  ORAL_EXAM_GRADEBOOK,
  ORAL_EXAM_LEAVE,
  ORAL_EXAM_MENU,
  ORAL_EXAM_OPS_SNAPSHOT,
  ORAL_EXAM_ORDERS,
  ORAL_EXAM_SCHOOL_NAME,
  ORAL_EXAM_TENANT_ID,
  emptyOralExamPlayState,
  getOralExamAccount,
  type OralExamPlayState,
  type OralExamRole,
} from '@campus/shared/src/oralExamDemo';
import { readOralExamPlayState, writeOralExamPlayState } from '../services/oralExamDemoStore';
import { theme } from '../ui/theme';
import { useThemeStyleSheet } from '../ui/useThemeStyleSheet';

export default function OralExamDemoScreen() {
  const s = useThemeStyleSheet(createStyles);
  const [role, setRole] = useState<OralExamRole>('student');
  const [play, setPlay] = useState<OralExamPlayState>(emptyOralExamPlayState);
  const account = getOralExamAccount(role);

  useEffect(() => {
    let active = true;
    void readOralExamPlayState().then((value) => {
      if (active) setPlay(value);
    });
    return () => {
      active = false;
    };
  }, []);

  const update = useCallback((patch: Partial<OralExamPlayState>) => {
    setPlay((current) => {
      const next = { ...current, ...patch };
      void writeOralExamPlayState(next);
      return next;
    });
  }, []);

  const assistant = useMemo(() => {
    const extras = [
      play.attendanceCheckedIn ? '王小明已簽到。' : null,
      play.assignmentSubmitted ? '鏈結串列作業已繳交。' : null,
      play.gradePublished ? '作業二 82 分已發布。' : null,
      play.leaveApproved ? '病假已核准。' : null,
      play.orderReady ? '示範訂單可取餐。' : null,
    ].filter(Boolean);
    return extras.length ? `${ORAL_EXAM_AI_CONTEXT[role]} ${extras.join(' ')}` : ORAL_EXAM_AI_CONTEXT[role];
  }, [play, role]);

  return (
    <SafeAreaView testID="oral-exam-demo" style={s.page}>
      <ScrollView contentContainerStyle={s.content}>
        <Text accessibilityRole="header" style={s.title}>
          口試示範工作區
        </Text>
        <Text style={s.banner}>
          {ORAL_EXAM_SCHOOL_NAME} · 租戶 {ORAL_EXAM_TENANT_ID}。本機示範資料，不登入真實校園，也不寫入正式資料庫。
        </Text>
        <View style={s.roles}>
          {ORAL_EXAM_ACCOUNTS.map((item) => (
            <Pressable
              key={item.role}
              testID={`oral-exam-role-${item.role}`}
              accessibilityRole="button"
              accessibilityState={{ selected: item.role === role }}
              onPress={() => setRole(item.role)}
              style={[s.roleChip, item.role === role && s.roleChipOn]}
            >
              <Text style={item.role === role ? s.roleChipOnText : s.roleChipText}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
        <Text accessibilityRole="header" style={s.heading}>
          {account.title}：{account.displayName}
        </Text>
        <Text style={s.muted}>
          {account.department} · {account.demoId}
        </Text>
        {role === 'student' ? <StudentBlocks play={play} update={update} styles={s} /> : null}
        {role === 'teacher' ? <TeacherBlocks play={play} update={update} styles={s} /> : null}
        {role === 'school_admin' ? <AdminBlocks play={play} update={update} styles={s} /> : null}
        {role === 'merchant' ? <MerchantBlocks play={play} update={update} styles={s} /> : null}
        {role === 'ops' ? (
          <View style={s.card}>
            <Text style={s.cardTitle}>示範租戶健康</Text>
            <Text style={s.body}>其他租戶可見：否</Text>
            <Text style={s.body}>線上點餐：關 · 學號登入：關</Text>
            <Text style={s.muted}>
              正式營運台仍要平台帳號。此處只看 {ORAL_EXAM_OPS_SNAPSHOT.tenant}。
            </Text>
          </View>
        ) : null}
        <View style={s.card}>
          <Text style={s.cardTitle}>校園助理（示範脈絡）</Text>
          <Text style={s.body}>{assistant}</Text>
        </View>
        <View style={s.card}>
          <Text style={s.cardTitle}>這角色接下來點什麼</Text>
          {account.clicks.map((step) => (
            <Text key={step} style={s.body}>
              · {step}
            </Text>
          ))}
          <Pressable
            testID="oral-exam-reset"
            accessibilityRole="button"
            onPress={() => {
              const next = emptyOralExamPlayState();
              setPlay(next);
              void writeOralExamPlayState(next);
            }}
            style={s.button}
          >
            <Text style={s.buttonText}>還原示範狀態</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

type BlockProps = {
  play: OralExamPlayState;
  update: (patch: Partial<OralExamPlayState>) => void;
  styles: ReturnType<typeof createStyles>;
};

function StudentBlocks({ play, update, styles: s }: BlockProps) {
  return (
    <>
      <View style={s.card}>
        <Text style={s.cardTitle}>課表</Text>
        {ORAL_EXAM_COURSES.map((course) => (
          <Text key={course.id} style={s.body}>
            {course.day} {course.name} · {course.room}
          </Text>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>作業</Text>
        {ORAL_EXAM_ASSIGNMENTS.map((item) => (
          <Text key={item.id} style={s.body}>
            {item.title}
            {item.id === 'oral-exam-hw-list' && play.assignmentSubmitted ? ' · 已繳交' : ''}
          </Text>
        ))}
        <Pressable
          testID="oral-exam-submit-hw"
          accessibilityRole="button"
          disabled={play.assignmentSubmitted}
          onPress={() => update({ assignmentSubmitted: true })}
          style={s.button}
        >
          <Text style={s.buttonText}>繳交鏈結串列作業</Text>
        </Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>點名與請假</Text>
        <Text style={s.body}>
          {ORAL_EXAM_ATTENDANCE.sessionTitle}：{play.attendanceCheckedIn ? '已簽到' : '尚未簽到'}
        </Text>
        <Text style={s.body}>
          {ORAL_EXAM_LEAVE.date}病假：{play.leaveApproved ? '已核准' : play.leaveRequested ? '待審' : '未送出'}
        </Text>
        <Pressable
          testID="oral-exam-check-in"
          accessibilityRole="button"
          disabled={play.attendanceCheckedIn}
          onPress={() => update({ attendanceCheckedIn: true })}
          style={s.button}
        >
          <Text style={s.buttonText}>簽到</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={play.leaveRequested || play.leaveApproved}
          onPress={() => update({ leaveRequested: true })}
          style={s.button}
        >
          <Text style={s.buttonText}>送出病假</Text>
        </Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>行事曆與餐飲</Text>
        {ORAL_EXAM_CALENDAR.map((item) => (
          <Text key={item.id} style={s.body}>
            {item.title} · {item.when}
          </Text>
        ))}
        <Text style={s.muted}>菜單 {ORAL_EXAM_MENU[0].name}；訂單{play.orderReady ? '可取餐' : '備餐中'}。線上點餐關閉。</Text>
      </View>
    </>
  );
}

function TeacherBlocks({ play, update, styles: s }: BlockProps) {
  return (
    <>
      <View style={s.card}>
        <Text style={s.cardTitle}>成績冊</Text>
        {ORAL_EXAM_GRADEBOOK.map((row) => (
          <Text key={row.demoId} style={s.body}>
            {row.studentName} 作業二 {row.hw2}
            {row.studentName === '示範學生王小明' && play.gradePublished ? ' · 已發布' : ''}
          </Text>
        ))}
        <Pressable
          testID="oral-exam-publish-grade"
          accessibilityRole="button"
          disabled={play.gradePublished}
          onPress={() => update({ gradePublished: true })}
          style={s.button}
        >
          <Text style={s.buttonText}>發布王小明作業二成績 82 分</Text>
        </Pressable>
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>請假審核</Text>
        <Text style={s.body}>{ORAL_EXAM_LEAVE.reason}</Text>
        <Pressable
          accessibilityRole="button"
          disabled={play.leaveApproved || !play.leaveRequested}
          onPress={() => update({ leaveApproved: true })}
          style={s.button}
        >
          <Text style={s.buttonText}>核准病假</Text>
        </Pressable>
      </View>
    </>
  );
}

function AdminBlocks({ play, update, styles: s }: BlockProps) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>公告與人員</Text>
      {ORAL_EXAM_ANNOUNCEMENTS.map((item) => (
        <Text key={item.id} style={s.body}>
          {item.title}
        </Text>
      ))}
      {play.announcementPosted ? <Text style={s.body}>已發布示範公告</Text> : null}
      <Text style={s.muted}>人員僅限示範租戶。</Text>
      <Pressable
        accessibilityRole="button"
        disabled={play.announcementPosted}
        onPress={() => update({ announcementPosted: true })}
        style={s.button}
      >
        <Text style={s.buttonText}>發布示範公告</Text>
      </Pressable>
    </View>
  );
}

function MerchantBlocks({ play, update, styles: s }: BlockProps) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>菜單與備餐單</Text>
      {ORAL_EXAM_MENU.map((item) => (
        <Text key={item.id} style={s.body}>
          {item.name} ${item.price}
        </Text>
      ))}
      <Text style={s.body}>
        {ORAL_EXAM_ORDERS[0].customer} · {play.orderReady ? '可取餐' : '備餐中'}
      </Text>
      <Text style={s.muted}>{ORAL_EXAM_ORDERS[0].note}</Text>
      <Pressable
        testID="oral-exam-ready-order"
        accessibilityRole="button"
        disabled={play.orderReady}
        onPress={() => update({ orderReady: true })}
        style={s.button}
      >
        <Text style={s.buttonText}>標為可取餐</Text>
      </Pressable>
    </View>
  );
}

const createStyles = () =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.colors.bg },
    content: { padding: 20, gap: 14, paddingBottom: 40 },
    title: { color: theme.colors.text, fontSize: 24, fontWeight: '700' },
    banner: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
    roles: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    roleChip: {
      minHeight: 44,
      paddingHorizontal: 14,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: theme.colors.border,
      justifyContent: 'center',
    },
    roleChipOn: { backgroundColor: theme.colors.text, borderColor: theme.colors.text },
    roleChipText: { color: theme.colors.text, fontWeight: '600' },
    roleChipOnText: { color: theme.colors.bg, fontWeight: '700' },
    heading: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
    muted: { color: theme.colors.muted, fontSize: 14, lineHeight: 20 },
    card: {
      gap: 8,
      padding: 16,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.colors.border,
      backgroundColor: theme.colors.surface ?? theme.colors.bg,
    },
    cardTitle: { color: theme.colors.text, fontSize: 17, fontWeight: '700' },
    body: { color: theme.colors.text, fontSize: 15, lineHeight: 22 },
    button: {
      minHeight: 44,
      marginTop: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: theme.colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 12,
    },
    buttonText: { color: theme.colors.text, fontWeight: '600' },
  });
