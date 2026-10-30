import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Alert, Linking, Text, View } from 'react-native';
import {
  resolveSchoolPublicServices,
  type SchoolPublicServiceLink,
  type SchoolPublicServiceKind,
} from '@campus/shared/src/schoolPublicServices';
import { AIDetailScreen, AICard, AIButton, aiTokens } from '../ui/aiFirst';
import { getThemeVersion, subscribeToTheme } from '../ui/theme';
import { safeNavigate } from '../utils/safeNavigate';
import { useSchool } from '../state/school';

export type ServiceScreenProps = {
  navigation?: Parameters<typeof safeNavigate>[0] & { goBack?: () => void };
  route?: { name?: string; params?: Record<string, unknown> };
};
type Action = { label: string; route: string; params?: Record<string, unknown> };
const publicActions: Action[] = [
  { label: '查看校方公告', route: '公告總覽' },
  { label: '查看校園活動', route: '活動總覽' },
];
const courseActions: Action[] = [
  { label: '查看我的課程', route: 'LearnHome' },
  { label: '查詢課程', route: 'AICourseAdvisor' },
];
const features: Record<string, { title: string; description: string; actions?: Action[] }> = {
  Clubs: {
    title: '社團服務',
    description: '社團申請與名單管理尚未開放。你可以先查看校方發布的社團活動。',
    actions: [{ label: '查看校園活動', route: '活動總覽' }],
  },
  Dormitory: {
    title: '宿舍服務',
    description: '宿舍包裹查詢與線上報修尚未開放。請透過住宿服務組現有管道辦理。',
  },
  AssignmentDetail: {
    title: '作業',
    description: '此作業入口尚未提供線上繳交。請從課程確認教師公告的繳交方式。',
    actions: [
      { label: '查看我的課程', route: 'LearnHome' },
      { label: '查看群組作業', route: 'Groups' },
    ],
  },
  HomeworkSubmit: {
    title: '繳交作業',
    description: '此入口尚未提供線上繳交。請依教師在課程中公告的方式繳交作業。',
    actions: courseActions,
  },
  GradeWhatIf: {
    title: '成績試算',
    description: '成績試算尚未開放。你可以查看已發布的成績，或向課程顧問詢問學習安排。',
    actions: [
      { label: '查看我的成績', route: 'Grades' },
      { label: '開啟課程顧問', route: 'AICourseAdvisor' },
    ],
  },
  MonthlySummary: {
    title: '學習回顧',
    description: '每月學習回顧尚未開放。先從課程與已發布成績查看目前的學習進度。',
    actions: [
      { label: '查看學業總覽', route: 'AcademicOverview' },
      { label: '查看我的成績', route: 'Grades' },
    ],
  },
  DemoStory: { title: '校園動態', description: '目前可查看學校正式發布的公告與活動。' },
  MistakeRepertoire: {
    title: '錯題整理',
    description: '錯題整理尚未開放。你仍可從課程查看作業與測驗。',
    actions: courseActions,
  },
  StudentInbox: {
    title: '待辦通知',
    description: '待辦彙整尚未開放。你可以先查看課程、作業與校方公告。',
    actions: courseActions,
  },
  Notifications: {
    title: '通知中心',
    description: '通知彙整尚未開放。你可以查看校方公告，或調整這台裝置的推播設定。',
    actions: [
      { label: '查看校方公告', route: '公告總覽' },
      { label: '調整通知設定', route: 'NotificationSettings' },
    ],
  },
  VendorRevenueReport: { title: '營運報表', description: '營運報表尚未開放。' },
  VendorLoyaltyPush: {
    title: '顧客通知',
    description: '顧客通知尚未開放，目前無法在這裡發送推播。',
  },
  VendorMenuManage: {
    title: '菜單管理',
    description: '菜單管理尚未開放，目前無法在這裡修改商品或價格。',
  },
  MerchantHub: { title: '商家接單', description: '商家工作台尚未開放。' },
  StudentRisk: { title: '學習關懷', description: '學習關懷分析尚未開放。', actions: courseActions },
  TeachingEvaluation: {
    title: '教學評量',
    description: '教學評量分析尚未開放。',
    actions: courseActions,
  },
  AITrustCard: {
    title: '助理使用紀錄',
    description: '使用紀錄彙整尚未開放。你仍可使用校園助理查詢資料。',
    actions: [{ label: '開啟校園助理', route: 'AIChat' }],
  },
  AIStudyBuddy: {
    title: '學習夥伴',
    description: '學習夥伴配對尚未開放。',
    actions: courseActions,
  },
  LifeRequests: {
    title: '請假與報修',
    description: '線上申請尚未開放。請透過校方現有管道辦理；這裡不會代送申請。',
  },
  Career: {
    title: '職涯',
    description: '職涯資料尚未連結到校方系統。請透過下方校方入口查看公開資訊。',
    actions: publicActions,
  },
  StaffHub: { title: '校務服務', description: '校務服務工作台尚未開放。' },
  DepartmentHub: { title: '系所工作台', description: '系所工作台尚未開放。' },
  AdminDashboard: { title: '管理工作台', description: '管理工作台尚未開放。' },
};

const OFFICIAL_ROUTE_SERVICE: Partial<Record<string, SchoolPublicServiceKind>> = {
  Dormitory: 'dormitory',
  Career: 'career',
};

function serviceBody(serviceKind: SchoolPublicServiceKind, link: SchoolPublicServiceLink): string {
  if (link.entryKind === 'student-portal-fallback') {
    return serviceKind === 'dormitory'
      ? '請在臺大學生專區查找住宿相關資訊。'
      : '請在臺大學生專區查找職涯與實習資訊。';
  }
  if (serviceKind === 'dormitory') {
    return '抽籤、入住與換房請依校方公告辦理。這裡不會查詢個人包裹或代送報修。';
  }
  return '職缺、實習與諮詢資訊請到校方網站查看。履歷與個人申請紀錄尚未連結。';
}

function OfficialPublicServiceCard({
  schoolId,
  serviceKind,
  link,
}: {
  schoolId: string;
  serviceKind: SchoolPublicServiceKind;
  link: SchoolPublicServiceLink;
}) {
  const [opening, setOpening] = useState(false);
  const active = useRef(true);
  const pending = useRef(false);
  const schoolRef = useRef(schoolId);
  schoolRef.current = schoolId;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  const title =
    serviceKind === 'dormitory'
      ? link.entryKind === 'student-portal-fallback'
        ? '校方住宿資訊入口'
        : '住宿服務單位'
      : link.entryKind === 'student-portal-fallback'
        ? '校方職涯資訊入口'
        : '職涯服務單位';

  const buttonLabel =
    schoolId === 'pu' && serviceKind === 'dormitory'
      ? opening
        ? '正在開啟…'
        : '前往靜宜住宿服務組官網'
      : opening
        ? '正在開啟…'
        : `前往${link.label}`;

  const open = async () => {
    const expectedSchool = schoolId;
    const targetUrl = link.url;
    if (!active.current || pending.current || schoolRef.current !== expectedSchool) return;
    pending.current = true;
    setOpening(true);
    try {
      // Dispatch immediately after sync guards — no async canOpenURL preflight.
      if (!active.current || schoolRef.current !== expectedSchool) return;
      await Linking.openURL(targetUrl);
    } catch {
      if (active.current && schoolRef.current === expectedSchool) {
        Alert.alert('無法開啟官網', '請確認網路連線後再試一次。');
      }
    } finally {
      pending.current = false;
      if (active.current && schoolRef.current === expectedSchool) setOpening(false);
    }
  };

  return (
    <AICard title={title}>
      <Text style={{ color: aiTokens.text, lineHeight: 24 }}>{serviceBody(serviceKind, link)}</Text>
      <AIButton
        label={buttonLabel}
        variant="ghost"
        disabled={opening}
        onPress={() => void open()}
      />
      <Text style={{ color: aiTokens.muted, lineHeight: 22, marginTop: 8 }}>
        來源：{link.sourceLabel}
      </Text>
    </AICard>
  );
}

export function UnavailableFeatureScreen({
  navigation,
  route,
  title,
  description,
  actions,
}: ServiceScreenProps & { title?: string; description?: string; actions?: Action[] }) {
  useSyncExternalStore(subscribeToTheme, getThemeVersion, getThemeVersion);
  const { school } = useSchool();
  const feature = features[route?.name ?? ''] ?? {
    title: '校園服務',
    description: '此功能尚未開放。你可以先使用下方的校園服務。',
  };
  const serviceKind = OFFICIAL_ROUTE_SERVICE[route?.name ?? ''];
  const profile = serviceKind ? resolveSchoolPublicServices(school?.id) : null;
  const officialLink = serviceKind && profile ? profile.services[serviceKind] : null;

  return (
    <AIDetailScreen title={title ?? feature.title} onBack={() => navigation?.goBack?.()}>
      <AICard>
        <Text style={{ color: aiTokens.text, lineHeight: 24 }}>
          {description ?? feature.description}
        </Text>
      </AICard>
      {officialLink && serviceKind && school?.id ? (
        <OfficialPublicServiceCard
          key={`${profile!.schoolId}:${serviceKind}`}
          schoolId={profile!.schoolId}
          serviceKind={serviceKind}
          link={officialLink}
        />
      ) : null}
      <AICard title="目前可以使用">
        <View style={{ gap: 12 }}>
          {(actions ?? feature.actions ?? publicActions).map((action) => (
            <AIButton
              key={action.route}
              label={action.label}
              variant="ghost"
              onPress={() => action.params
                ? safeNavigate(navigation, action.route, action.params)
                : safeNavigate(navigation, action.route)}
            />
          ))}
        </View>
      </AICard>
    </AIDetailScreen>
  );
}
