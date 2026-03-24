import React from 'react';
import { collection, getDocs, limit, orderBy, query } from 'firebase/firestore';

import { getRuntimeDataSourcePolicy } from '../../config/runtime';
import { getDataSource } from '../../data/source';
import type {
  AmbientCue,
  AmbientCueRole,
  AmbientCueSurface,
  ClubEvent,
  CourseSpace,
  MenuItem,
  Poi,
} from '../../data/types';
import { useAsyncList } from '../../hooks/useAsyncList';
import { analytics } from '../../services/analytics';
import { loadPersistedValue, savePersistedValue } from '../../services/persistedStorage';
import { getReleaseConfig } from '../../services/release';
import { getScopedStorageKey } from '../../services/scopedStorage';

const AMBIENT_CUE_MIN_DISTINCT_USERS = 3;
const AMBIENT_CUE_DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const impressionKeys = new Set<string>();

type NavigationLike = {
  navigate?: (...args: unknown[]) => void;
} | null | undefined;

function getTodayIsoDate(): string {
  return new Date().toISOString().split('T')[0] ?? '';
}

function getAmbientDismissStorageKey(dismissKey: string, uid: string, schoolId: string): string {
  return getScopedStorageKey(`ambientCueDismiss.${dismissKey}.${getTodayIsoDate()}`, { uid, schoolId });
}

async function isAmbientCueDismissed(dismissKey: string, uid: string, schoolId: string): Promise<boolean> {
  return loadPersistedValue<boolean>({
    storageKey: getAmbientDismissStorageKey(dismissKey, uid, schoolId),
    fallback: false,
    deserialize: (raw) => raw === '1',
  });
}

export async function dismissAmbientCue(params: {
  dismissKey: string;
  uid: string;
  schoolId: string;
}): Promise<void> {
  await savePersistedValue(getAmbientDismissStorageKey(params.dismissKey, params.uid, params.schoolId), '1', (value) => value);
}

export function isAmbientCueFresh(cue: AmbientCue, now = Date.now()): boolean {
  if (!cue.updatedAt) return false;
  return now - cue.updatedAt.getTime() <= AMBIENT_CUE_DEFAULT_STALE_MS;
}

export function hasAmbientCueSample(cue: AmbientCue): boolean {
  return cue.distinctUserCount >= AMBIENT_CUE_MIN_DISTINCT_USERS;
}

function getAmbientCuePriority(cue: AmbientCue): number {
  switch (cue.signalType) {
    case 'attendance_momentum':
      return 0;
    case 'teaching_review':
    case 'approval_backlog':
      return 1;
    case 'course_completion':
    case 'campus_popularity':
      return 2;
    case 'leaderboard_momentum':
    case 'admin_activity':
    default:
      return 3;
  }
}

export function applyAmbientCueVisibilityRules(
  cues: AmbientCue[],
  now = Date.now()
): { visible: AmbientCue[]; hiddenLowSample: AmbientCue[] } {
  const hiddenLowSample: AmbientCue[] = [];
  const visible = cues
    .filter((cue) => {
      if (!hasAmbientCueSample(cue)) {
        hiddenLowSample.push(cue);
        return false;
      }
      return isAmbientCueFresh(cue, now);
    })
    .sort((left, right) => {
      const priorityDiff = getAmbientCuePriority(left) - getAmbientCuePriority(right);
      if (priorityDiff !== 0) return priorityDiff;
      const sampleDiff = (right.distinctUserCount ?? 0) - (left.distinctUserCount ?? 0);
      if (sampleDiff !== 0) return sampleDiff;
      return (right.updatedAt?.getTime() ?? 0) - (left.updatedAt?.getTime() ?? 0);
    });

  return { visible, hiddenLowSample };
}

function getAllowDemoSignals(): boolean {
  const runtimePolicy = getRuntimeDataSourcePolicy();
  return runtimePolicy.requestedMode === 'mock' || getReleaseConfig().appEnv !== 'production';
}

function createCourseCue(params: {
  surface: AmbientCueSurface;
  role: AmbientCueRole;
  courseSpace: CourseSpace;
  headline: string;
  body: string;
  ctaLabel: string;
  target?: AmbientCue['target'];
}): AmbientCue {
  const distinctUserCount = Math.max(
    params.courseSpace.activeLearnerCount ?? 0,
    params.courseSpace.completedAssignmentCount ?? 0,
  );

  return {
    id: `${params.surface}:${params.courseSpace.groupId}`,
    surface: params.surface,
    role: params.role,
    signalType:
      (params.courseSpace.activeLearnerCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS
        ? 'attendance_momentum'
        : 'course_completion',
    headline: params.headline,
    body: params.body,
    ctaLabel: params.ctaLabel,
    target: params.target,
    metric:
      params.courseSpace.completionRate && params.courseSpace.completionRate > 0
        ? `${params.courseSpace.completionRate}% 跟上進度`
        : params.courseSpace.activeLearnerCount && params.courseSpace.activeLearnerCount > 0
          ? `${params.courseSpace.activeLearnerCount} 人已跟上`
          : undefined,
    distinctUserCount,
    updatedAt: params.courseSpace.socialProofUpdatedAt ?? params.courseSpace.latestDueAt ?? null,
    dismissKey: `${params.surface}.${params.courseSpace.groupId}`,
  };
}

function buildStudentLearningCues(surface: AmbientCueSurface, courseSpaces: CourseSpace[]): AmbientCue[] {
  const liveSpace = courseSpaces.find(
    (space) => !!space.activeSessionId && (space.activeLearnerCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS,
  );
  const completionSpace = courseSpaces.find(
    (space) => (space.completedAssignmentCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS,
  );

  const cues: AmbientCue[] = [];

  if (liveSpace?.activeSessionId) {
    cues.push(
      createCourseCue({
        surface,
        role: 'student',
        courseSpace: liveSpace,
        headline: `${liveSpace.activeLearnerCount} 位同學已進入 ${liveSpace.name}`,
        body: '同學多半會先處理正在進行的課堂，再回頭看其他更新。你現在進去最不容易掉隊。',
        ctaLabel: '進入課堂',
        target: {
          tab: '課程',
          screen: 'Classroom',
          params: { groupId: liveSpace.groupId, sessionId: liveSpace.activeSessionId, isTeacher: false },
        },
      }),
    );
  }

  if (completionSpace) {
    cues.push(
      createCourseCue({
        surface,
        role: 'student',
        courseSpace: completionSpace,
        headline: `已有 ${completionSpace.completedAssignmentCount} 位同學先完成 ${completionSpace.name}`,
        body: '這和你現在最可能被延後的課務一致。先完成這一步，後面的壓力會明顯小很多。',
        ctaLabel: '前往處理',
        target: {
          tab: surface === 'inbox' ? '收件匣' : '課程',
          screen: surface === 'inbox' ? 'GroupAssignments' : 'CourseHub',
          params: { groupId: completionSpace.groupId },
        },
      }),
    );
  }

  return cues;
}

function buildTeacherLearningCues(surface: AmbientCueSurface, courseSpaces: CourseSpace[]): AmbientCue[] {
  const liveSpace = courseSpaces.find(
    (space) => !!space.activeSessionId && (space.activeLearnerCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS,
  );
  const completionSpace = courseSpaces.find(
    (space) => (space.completedAssignmentCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS,
  );

  const cues: AmbientCue[] = [];

  if (liveSpace?.activeSessionId) {
    cues.push(
      createCourseCue({
        surface,
        role: 'teacher',
        courseSpace: liveSpace,
        headline: `${liveSpace.activeLearnerCount} 位學生已進入 ${liveSpace.name}`,
        body: '這門課的當前節奏已經形成。先進課堂看簽到與互動，比先做其他管理更貼近現場。',
        ctaLabel: '查看課堂',
        target: {
          tab: '教學',
          screen: 'Classroom',
          params: { groupId: liveSpace.groupId, sessionId: liveSpace.activeSessionId, isTeacher: true },
        },
      }),
    );
  }

  if (completionSpace) {
    cues.push(
      createCourseCue({
        surface,
        role: 'teacher',
        courseSpace: completionSpace,
        headline: `${completionSpace.completedAssignmentCount} 位學生已提交 ${completionSpace.name} 近期作業`,
        body: '現在批改或發布回饋，最能回應學生已經開始的節奏，也能讓下一步更清楚。',
        ctaLabel: '查看批改',
        target: {
          tab: '教學',
          screen: 'CourseGradebook',
          params: { groupId: completionSpace.groupId, groupName: completionSpace.name },
        },
      }),
    );
  }

  return cues;
}

function buildAchievementCue(params: {
  courseSpaces: CourseSpace[];
  totalPoints: number;
  leaderboardSize: number;
  allowDemoSignals: boolean;
}): AmbientCue[] {
  const completionSpace = params.courseSpaces.find(
    (space) => (space.completedAssignmentCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS,
  );

  if (!completionSpace && !params.allowDemoSignals) {
    return [];
  }

  const distinctUserCount = completionSpace?.completedAssignmentCount ?? Math.max(params.leaderboardSize, 3);
  const updatedAt = completionSpace?.socialProofUpdatedAt ?? new Date();

  return [
    {
      id: `achievements:${completionSpace?.groupId ?? 'bridge'}`,
      surface: 'achievements',
      role: 'student',
      signalType: 'leaderboard_momentum',
      headline:
        completionSpace != null
          ? `像你這樣的活躍同學，最近多半先完成 ${completionSpace.name} 的課務`
          : '積分波動通常不是靠一次衝刺，而是靠把課務與互動穩定完成',
      body:
        params.totalPoints > 0
          ? '成就頁不是另外一條路，它反映的是你平常怎麼跟上節奏。回到主流程，分數通常會更自然地累積。'
          : '先讓今天的主流程跑起來，成就與積分會比單純刷頁面更容易往上走。',
      ctaLabel: completionSpace ? '回到課程' : '回到 Today',
      target: completionSpace
        ? { tab: '課程', screen: 'CourseHub', params: { groupId: completionSpace.groupId } }
        : { tab: 'Today', screen: 'TodayHome' },
      metric: `${distinctUserCount} 人近期先完成主流程`,
      distinctUserCount,
      updatedAt,
      dismissKey: `achievements.${completionSpace?.groupId ?? 'bridge'}`,
    },
  ];
}

function buildDemoAmbientCues(params: {
  surface: AmbientCueSurface;
  role: AmbientCueRole;
  uid: string;
  schoolId: string;
}): AmbientCue[] {
  if (params.role === 'guest') return [];

  if (params.surface === 'achievements') {
    return [
      {
        id: 'demo-achievements',
        surface: 'achievements',
        role: params.role,
        signalType: 'leaderboard_momentum',
        headline: '示意模式下，活躍使用者通常先把今天最接近截止的一步做完',
        body: '這裡保留了 demo 線索，方便你驗證版位與節奏；正式環境會只顯示真實匿名資料。',
        ctaLabel: '回到 Today',
        target: { tab: 'Today', screen: 'TodayHome' },
        metric: 'Demo cue',
        distinctUserCount: 8,
        updatedAt: new Date(),
        dismissKey: 'demo.achievements',
      },
    ];
  }

  return [];
}

async function buildAdminCue(schoolId: string): Promise<AmbientCue[]> {
  const { getDb } = await import('../../firebase');
  const db = getDb();
  const [announcementsSnap, eventsSnap] = await Promise.all([
    getDocs(query(collection(db, 'schools', schoolId, 'announcements'), orderBy('publishedAt', 'desc'), limit(5))).catch(
      () => null,
    ),
    getDocs(query(collection(db, 'schools', schoolId, 'events'), orderBy('startsAt', 'desc'), limit(5))).catch(
      () => null,
    ),
  ]);
  const distinctUserCount = (announcementsSnap?.size ?? 0) + (eventsSnap?.size ?? 0);
  const latestAnnouncement = announcementsSnap?.docs[0]?.data() as Record<string, unknown> | undefined;
  const latestEvent = eventsSnap?.docs[0]?.data() as Record<string, unknown> | undefined;
  const updatedAt = new Date();
  const headline =
    distinctUserCount >= AMBIENT_CUE_MIN_DISTINCT_USERS
      ? `最近有 ${distinctUserCount} 筆校務內容正在更新`
      : '近期校務更新量不高';

  return [
    {
      id: 'admin:overview',
      surface: 'admin',
      role: 'admin',
      signalType: 'admin_activity',
      headline,
      body: '當公告、活動與成員狀態一起變動時，管理者通常先回到總覽確認哪個模組最需要你介入。',
      ctaLabel: '查看總覽',
      target: { tab: '管理', screen: 'AdminDashboard' },
      metric:
        typeof latestAnnouncement?.title === 'string'
          ? `最新公告：${latestAnnouncement.title}`
          : typeof latestEvent?.title === 'string'
            ? `最新活動：${latestEvent.title}`
            : undefined,
      distinctUserCount: Math.max(distinctUserCount, 1),
      updatedAt,
      dismissKey: 'admin.overview',
    },
  ];
}

async function buildDepartmentCue(schoolId: string): Promise<AmbientCue[]> {
  const { getDb } = await import('../../firebase');
  const db = getDb();
  const approvalsSnap = await getDocs(collection(db, 'schools', schoolId, 'approvals')).catch(() => null);
  const pendingCount = approvalsSnap?.size ?? 0;

  return [
    {
      id: 'department:overview',
      surface: 'department',
      role: 'department',
      signalType: 'approval_backlog',
      headline:
        pendingCount >= AMBIENT_CUE_MIN_DISTINCT_USERS
          ? `${pendingCount} 件審核項目正在等待決策`
          : '目前待審核量偏低',
      body: '同類角色通常會先把堆積中的審核清掉，再回頭看統計與長期報表，避免節奏被未決事項拖住。',
      ctaLabel: '查看審核',
      target: { tab: '審核', screen: 'DepartmentHub' },
      metric: pendingCount > 0 ? `${pendingCount} 件待審核` : undefined,
      distinctUserCount: Math.max(pendingCount, 1),
      updatedAt: new Date(),
      dismissKey: 'department.overview',
    },
  ];
}

async function buildCampusCue(schoolId: string): Promise<AmbientCue[]> {
  const ds = getDataSource();
  const [events, menus, pois] = await Promise.all([
    ds.listEvents(schoolId).catch(() => [] as ClubEvent[]),
    ds.listMenus(schoolId).catch(() => [] as MenuItem[]),
    ds.listPois(schoolId).catch(() => [] as Poi[]),
  ]);

  const popularEvent = events
    .filter((event) => (event.registeredCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS)
    .sort((left, right) => (right.registeredCount ?? 0) - (left.registeredCount ?? 0))[0];
  if (popularEvent) {
    return [
      {
        id: `campus:event:${popularEvent.id}`,
        surface: 'campus',
        role: 'student',
        signalType: 'campus_popularity',
        headline: `${popularEvent.registeredCount} 人正關注 ${popularEvent.title}`,
        body: '這代表現在不少人正把注意力放在同一件事上。若你也有興趣，現在跟上最容易接到後續節奏。',
        ctaLabel: '查看活動',
        target: { tab: 'Today', screen: '活動詳情', params: { id: popularEvent.id } },
        metric:
          popularEvent.capacity && popularEvent.capacity > 0
            ? `${popularEvent.registeredCount}/${popularEvent.capacity} 人報名`
            : `${popularEvent.registeredCount} 人報名`,
        distinctUserCount: popularEvent.registeredCount ?? 0,
        updatedAt: popularEvent.startsAt ? new Date(popularEvent.startsAt) : new Date(),
        dismissKey: `campus.event.${popularEvent.id}`,
      },
    ];
  }

  const popularMenu = menus.find((menu) => menu.popular && (menu.ratingCount ?? 0) >= AMBIENT_CUE_MIN_DISTINCT_USERS);
  if (popularMenu) {
    return [
      {
        id: `campus:menu:${popularMenu.id}`,
        surface: 'campus',
        role: 'student',
        signalType: 'campus_popularity',
        headline: `${popularMenu.name} 正在被很多人選`,
        body: '餐點的人氣通常會比單一評價更能反映現在的現場節奏。你如果正要找下一步，這是低成本的選擇。',
        ctaLabel: '查看餐廳',
        target: { tab: '校園', screen: '餐廳總覽' },
        metric:
          popularMenu.waitTime && popularMenu.waitTime > 0
            ? `約 ${popularMenu.waitTime} 分鐘`
            : popularMenu.ratingCount
              ? `${popularMenu.ratingCount} 則評分`
              : undefined,
        distinctUserCount: popularMenu.ratingCount ?? AMBIENT_CUE_MIN_DISTINCT_USERS,
        updatedAt: popularMenu.availableOn ? new Date(popularMenu.availableOn) : new Date(),
        dismissKey: `campus.menu.${popularMenu.id}`,
      },
    ];
  }

  const livelyPoi = pois.find((poi) => poi.crowdLevel === 'high');
  if (livelyPoi) {
    return [
      {
        id: `campus:poi:${livelyPoi.id}`,
        surface: 'campus',
        role: 'student',
        signalType: 'campus_popularity',
        headline: `${livelyPoi.name} 現在比較熱鬧`,
        body: '當很多人同時往同一個地點移動時，提早知道現場狀態，通常能少掉來回切換的成本。',
        ctaLabel: '查看地圖',
        target: { tab: '校園', screen: 'Map' },
        metric: '現場人潮偏高',
        distinctUserCount: AMBIENT_CUE_MIN_DISTINCT_USERS,
        updatedAt: new Date(),
        dismissKey: `campus.poi.${livelyPoi.id}`,
      },
    ];
  }

  return [];
}

export async function listAmbientCues(params: {
  schoolId: string;
  uid: string;
  role?: AmbientCueRole | null;
  surface: AmbientCueSurface;
  totalPoints?: number;
}): Promise<AmbientCue[]> {
  const allowDemoSignals = getAllowDemoSignals();
  const role = params.role ?? 'student';

  let cues: AmbientCue[] = [];

  if (params.surface === 'admin') {
    cues = await buildAdminCue(params.schoolId);
  } else if (params.surface === 'department') {
    cues = await buildDepartmentCue(params.schoolId);
  } else if (params.surface === 'campus') {
    cues = await buildCampusCue(params.schoolId);
  } else {
    const ds = getDataSource();
    const courseSpaces = await ds.listCourseSpaces(params.uid, params.schoolId).catch(() => [] as CourseSpace[]);

    if (params.surface === 'achievements') {
      const leaderboardRows = await getDataSource()
        .listAchievements?.()
        .then((rows: unknown) => (Array.isArray(rows) ? rows.length : 0))
        .catch(() => 0);
      cues = buildAchievementCue({
        courseSpaces,
        totalPoints: params.totalPoints ?? 0,
        leaderboardSize: leaderboardRows,
        allowDemoSignals,
      });
    } else if (role === 'teacher' || role === 'admin' || role === 'staff') {
      cues = buildTeacherLearningCues(params.surface, courseSpaces);
    } else {
      cues = buildStudentLearningCues(params.surface, courseSpaces);
    }
  }

  if (cues.length === 0 && allowDemoSignals) {
    cues = buildDemoAmbientCues({
      surface: params.surface,
      role,
      uid: params.uid,
      schoolId: params.schoolId,
    });
  }

  const { visible, hiddenLowSample } = applyAmbientCueVisibilityRules(cues);
  hiddenLowSample.forEach((cue) => {
    analytics.logEvent('ambient_cue_hidden_low_sample', {
      surface: cue.surface,
      distinct_count: cue.distinctUserCount,
    });
  });

  const dismissed = await Promise.all(
    visible.map(async (cue) => ({
      cue,
      isDismissed: await isAmbientCueDismissed(cue.dismissKey, params.uid, params.schoolId),
    })),
  );

  return dismissed.filter((entry) => !entry.isDismissed).map((entry) => entry.cue);
}

export function openAmbientCueTarget(navigation: NavigationLike, cue: AmbientCue): void {
  const target = cue.target;
  if (!target) return;

  if (target.tab) {
    if (target.screen) {
      navigation?.navigate?.(target.tab, { screen: target.screen, params: target.params });
      return;
    }
    navigation?.navigate?.(target.tab, target.params);
    return;
  }

  if (target.screen) {
    navigation?.navigate?.(target.screen, target.params);
  }
}

export function useAmbientCues(params: {
  schoolId: string | null | undefined;
  uid: string | null | undefined;
  role?: AmbientCueRole | null;
  surface: AmbientCueSurface;
  totalPoints?: number;
  limit?: number;
}) {
  const [dismissedKeys, setDismissedKeys] = React.useState<string[]>([]);
  const { items, loading, refreshing, refresh } = useAsyncList<AmbientCue>(
    async () => {
      if (!params.schoolId || !params.uid) return [];
      return listAmbientCues({
        schoolId: params.schoolId,
        uid: params.uid,
        role: params.role ?? 'student',
        surface: params.surface,
        totalPoints: params.totalPoints,
      });
    },
    [params.schoolId, params.uid, params.role, params.surface, params.totalPoints],
    { keepPreviousData: true },
  );

  const cues = React.useMemo(
    () =>
      items
        .filter((cue) => !dismissedKeys.includes(cue.dismissKey))
        .slice(0, params.limit ?? 2),
    [dismissedKeys, items, params.limit],
  );

  React.useEffect(() => {
    cues.forEach((cue) => {
      const key = `${cue.surface}:${cue.id}`;
      if (impressionKeys.has(key)) return;
      impressionKeys.add(key);
      analytics.logEvent('ambient_cue_impression', {
        surface: cue.surface,
        distinct_count: cue.distinctUserCount,
      });
    });
  }, [cues]);

  const dismissCue = React.useCallback(
    async (cue: AmbientCue) => {
      setDismissedKeys((prev) => [...prev, cue.dismissKey]);
      analytics.logEvent('ambient_cue_dismiss', {
        surface: cue.surface,
        distinct_count: cue.distinctUserCount,
      });

      if (params.uid && params.schoolId) {
        await dismissAmbientCue({
          dismissKey: cue.dismissKey,
          uid: params.uid,
          schoolId: params.schoolId,
        }).catch(() => void 0);
      }
    },
    [params.schoolId, params.uid],
  );

  const openCue = React.useCallback((cue: AmbientCue, navigation: NavigationLike) => {
    analytics.logEvent('ambient_cue_open', {
      surface: cue.surface,
      distinct_count: cue.distinctUserCount,
    });
    openAmbientCueTarget(navigation, cue);
  }, []);

  return {
    cues,
    cue: cues[0] ?? null,
    loading,
    refreshing,
    refresh,
    dismissCue,
    openCue,
  };
}
