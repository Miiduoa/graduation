/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

import { getAuthInstance, getDb, getFunctionsInstance, isFirebaseMockMode } from '../firebase';
import { submitCrowdReport as submitLocalCrowdReport } from '../services/campusPulseEngine';
import { listCourseSpaces, listInboxTasks } from './courseSpaceSource';
import type {
  AcademicSourceSnapshot,
  ActionQueueItem,
  CampusRoleActionGraph,
  InboxTask,
  NextBestAction,
  PulseAggregate,
  StudentRiskSnapshot,
} from './types';

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof (value as { seconds?: unknown }).seconds === 'number') {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  const date = new Date(value as string | number);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeUrgency(priority: number): NextBestAction['urgency'] {
  if (priority <= 0) return 'critical';
  if (priority <= 2) return 'high';
  if (priority <= 4) return 'medium';
  return 'low';
}

function actionTargetFromTask(task: InboxTask): NextBestAction['actionTarget'] {
  if (task.kind === 'live' && task.sessionId) {
    return {
      tab: '課程',
      screen: 'Classroom',
      params: { groupId: task.groupId, sessionId: task.sessionId },
    };
  }

  if ((task.kind === 'assignment' || task.kind === 'quiz') && task.assignmentId) {
    return {
      tab: '收件匣',
      screen: 'AssignmentDetail',
      params: { groupId: task.groupId, assignmentId: task.assignmentId },
    };
  }

  return {
    tab: '收件匣',
    screen: 'GroupDetail',
    params: { groupId: task.groupId },
  };
}

function actionFromInboxTask(task: InboxTask): NextBestAction {
  const urgency = normalizeUrgency(task.priority);
  const actionLabel =
    task.actionLabel ??
    (task.kind === 'live'
      ? '進入課堂'
      : task.kind === 'quiz'
        ? '開始處理'
        : task.kind === 'assignment'
          ? '查看作業'
          : '查看更新');

  return {
    id: `inbox:${task.id}`,
    title: task.title,
    description: task.subtitle,
    priority: task.priority,
    urgency,
    reason: task.reason ?? '這個項目會影響今天的學習節奏。',
    consequence: task.consequence,
    nextStep: task.nextStep ?? actionLabel,
    actionLabel,
    actionTarget: actionTargetFromTask(task),
    evidenceRefs: [
      {
        type: task.kind === 'quiz' ? 'assignment' : task.kind === 'live' ? 'attendance' : 'course',
        id: task.assignmentId ?? task.sessionId ?? task.groupId,
        label: task.title,
      },
    ],
    requiresConfirmation: false,
    source: 'inbox',
    dueAt: task.dueAt ?? null,
    createdAt: new Date(),
  };
}

function parseNextBestAction(row: Record<string, unknown>, id: string): NextBestAction {
  return {
    id,
    title: String(row.title ?? '下一步'),
    description: String(row.description ?? row.subtitle ?? ''),
    priority: typeof row.priority === 'number' ? row.priority : 5,
    urgency:
      (row.urgency as NextBestAction['urgency']) ?? normalizeUrgency(Number(row.priority ?? 5)),
    reason: String(row.reason ?? '系統根據你的課程、待辦與校園情境排序。'),
    consequence: typeof row.consequence === 'string' ? row.consequence : undefined,
    nextStep: String(row.nextStep ?? row.actionLabel ?? '前往處理'),
    actionLabel: String(row.actionLabel ?? '前往處理'),
    actionTarget: (row.actionTarget as NextBestAction['actionTarget']) ?? undefined,
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? (row.evidenceRefs as NextBestAction['evidenceRefs'])
      : [],
    requiresConfirmation: Boolean(row.requiresConfirmation),
    source: (row.source as NextBestAction['source']) ?? 'system',
    dueAt: toDate(row.dueAt),
    createdAt: toDate(row.createdAt),
  };
}

function parseRiskSnapshot(
  row: Record<string, unknown>,
  id: string,
  userId: string,
): StudentRiskSnapshot {
  return {
    id,
    userId: String(row.userId ?? userId),
    schoolId: typeof row.schoolId === 'string' ? row.schoolId : undefined,
    level: (row.level as StudentRiskSnapshot['level']) ?? 'safe',
    score: typeof row.score === 'number' ? row.score : 0,
    summary: String(row.summary ?? '目前沒有明顯風險。'),
    signals: Array.isArray(row.signals) ? (row.signals as StudentRiskSnapshot['signals']) : [],
    recommendedActions: Array.isArray(row.recommendedActions)
      ? (row.recommendedActions as StudentRiskSnapshot['recommendedActions'])
      : [],
    generatedAt: toDate(row.generatedAt),
  };
}

function parsePulseAggregate(
  row: Record<string, unknown>,
  id: string,
  schoolId: string,
): PulseAggregate {
  const currentLevel = Number(row.currentLevel ?? row.level ?? 2);
  return {
    id,
    schoolId: String(row.schoolId ?? schoolId),
    locationId: String(row.locationId ?? id),
    locationName: String(row.locationName ?? row.name ?? id),
    category: (row.category as PulseAggregate['category']) ?? 'other',
    currentLevel: Math.min(
      5,
      Math.max(1, Math.round(currentLevel)),
    ) as PulseAggregate['currentLevel'],
    confidence: typeof row.confidence === 'number' ? row.confidence : 0.3,
    sampleSize: typeof row.sampleSize === 'number' ? row.sampleSize : 0,
    reportCount24h: typeof row.reportCount24h === 'number' ? row.reportCount24h : 0,
    trend: (row.trend as PulseAggregate['trend']) ?? 'stable',
    bestTimeToVisit: typeof row.bestTimeToVisit === 'string' ? row.bestTimeToVisit : undefined,
    updatedAt: toDate(row.updatedAt),
  };
}

function parseAcademicSourceSnapshot(
  row: Record<string, unknown>,
  id: string,
  userId: string,
  schoolId: string,
): AcademicSourceSnapshot {
  return {
    id,
    userId: String(row.userId ?? userId),
    schoolId: String(row.schoolId ?? schoolId),
    sources: Array.isArray(row.sources) ? (row.sources as AcademicSourceSnapshot['sources']) : [],
    sourceAuthority: Array.isArray(row.sourceAuthority)
      ? (row.sourceAuthority as AcademicSourceSnapshot['sourceAuthority'])
      : ['tronclass', 'e_campus', 'firebase_projection'],
    courses: Array.isArray(row.courses)
      ? (row.courses as AcademicSourceSnapshot['courses'])
      : undefined,
    grades: Array.isArray(row.grades)
      ? (row.grades as AcademicSourceSnapshot['grades'])
      : undefined,
    attendance: Array.isArray(row.attendance)
      ? (row.attendance as AcademicSourceSnapshot['attendance'])
      : undefined,
    inboxTasks: Array.isArray(row.inboxTasks)
      ? (row.inboxTasks as AcademicSourceSnapshot['inboxTasks'])
      : undefined,
    generatedAt: toDate(row.generatedAt),
    expiresAt: toDate(row.expiresAt),
  };
}

function parseRoleActionGraph(
  row: Record<string, unknown>,
  id: string,
  userId: string,
  schoolId: string,
): CampusRoleActionGraph {
  return {
    id,
    userId: typeof row.userId === 'string' ? row.userId : userId,
    schoolId: typeof row.schoolId === 'string' ? row.schoolId : schoolId,
    activeRoles: Array.isArray(row.activeRoles)
      ? (row.activeRoles as CampusRoleActionGraph['activeRoles'])
      : ['student'],
    nodes: Array.isArray(row.nodes) ? (row.nodes as CampusRoleActionGraph['nodes']) : [],
    edges: Array.isArray(row.edges) ? (row.edges as CampusRoleActionGraph['edges']) : [],
    dataSources: Array.isArray(row.dataSources)
      ? (row.dataSources as CampusRoleActionGraph['dataSources'])
      : [],
    generatedAt: toDate(row.generatedAt) ?? new Date(),
  };
}

function buildLocalAcademicSnapshot(
  userId: string,
  schoolId: string,
  inboxTasks: InboxTask[],
): AcademicSourceSnapshot {
  const generatedAt = new Date();
  return {
    id: 'local',
    userId,
    schoolId,
    sourceAuthority: ['tronclass', 'e_campus', 'firebase_projection'],
    sources: [
      {
        key: 'tronclass',
        label: 'TronClass',
        state: inboxTasks.length > 0 ? 'real' : 'missing',
        detail:
          inboxTasks.length > 0
            ? '已由 TronClass 課務快取推導待辦。'
            : '尚未取得 TronClass 授權或課務快取。',
      },
      {
        key: 'e_campus',
        label: 'E 校園',
        state: 'authorized',
        detail: '課表、成績、缺曠、學分以 E 校園為正式來源；本機只保留可快取投影。',
      },
      {
        key: 'firebase_projection',
        label: 'Firebase projection',
        state: 'authorized',
        detail: '僅保存 App-native 資料、投影、AI 建議與待確認動作。',
      },
    ],
    inboxTasks,
    generatedAt,
    expiresAt: new Date(generatedAt.getTime() + 10 * 60 * 1000),
  };
}

function buildLocalRoleActionGraph(
  userId: string,
  schoolId: string,
  actions: NextBestAction[],
): CampusRoleActionGraph {
  const generatedAt = new Date();
  return {
    id: `local-role-graph-${userId}`,
    userId,
    schoolId,
    activeRoles: ['student'],
    dataSources: [
      {
        key: 'tronclass',
        label: 'TronClass',
        state: actions.length > 0 ? 'real' : 'missing',
        detail: '課程、作業、考試、點名與成績以 TronClass 為權威來源。',
      },
      {
        key: 'e_campus',
        label: 'E 校園',
        state: 'authorized',
        detail: '課表、正式成績、缺曠與學分由 E 校園授權同步。',
      },
      {
        key: 'firebase_projection',
        label: 'Firebase projection',
        state: 'authorized',
        detail: 'Firebase 只保存角色 membership、通知、群組與可快取投影。',
      },
    ],
    nodes: [
      {
        id: 'student-next-action',
        role: 'student',
        label: '學生',
        title: actions[0]?.title ?? '今日學業下一步',
        description: actions[0]?.reason ?? '授權後會整合 TronClass 與 E 校園資料產生下一步。',
        status: actions.length > 0 ? 'ready' : 'needs_data',
        sourceState: actions.length > 0 ? 'real' : 'missing',
        count: actions.length,
        countLabel: '項建議',
        active: true,
        actionLabel: actions[0]?.actionLabel ?? '同步學業資料',
        actionTarget: actions[0]?.actionTarget ?? { tab: 'Today' },
        evidenceRefs: actions.flatMap((action) => action.evidenceRefs).slice(0, 6),
      },
    ],
    edges: [
      {
        id: 'student-data-to-next-action',
        from: 'student',
        to: 'school',
        trigger: '授權同步',
        result: '產生學業投影、風險快照與待確認行動',
        status: actions.length > 0 ? 'ready' : 'needs_data',
        dataContract: 'TronClass/E 校園為權威來源，Firebase 保存 projection。',
        confirmationPolicy: 'user_confirm',
        evidenceRefs: [],
      },
    ],
    generatedAt,
  };
}

function parseActionQueueItem(
  row: Record<string, unknown>,
  id: string,
  userId: string,
): ActionQueueItem {
  return {
    id,
    userId: String(row.userId ?? userId),
    schoolId: typeof row.schoolId === 'string' ? row.schoolId : undefined,
    label: String(row.label ?? row.action ?? '待確認動作'),
    action: String(row.action ?? 'draft_message'),
    params:
      row.params && typeof row.params === 'object' ? (row.params as Record<string, unknown>) : {},
    requiresConfirmation: true,
    sensitivity: (row.sensitivity as ActionQueueItem['sensitivity']) ?? 'medium',
    evidenceRefs: Array.isArray(row.evidenceRefs)
      ? (row.evidenceRefs as ActionQueueItem['evidenceRefs'])
      : [],
    status: (row.status as ActionQueueItem['status']) ?? 'pending_confirmation',
    actorRole: (row.actorRole as ActionQueueItem['actorRole']) ?? 'student',
    permissionScope: (row.permissionScope as ActionQueueItem['permissionScope']) ?? 'user_private',
    createdAt: toDate(row.createdAt),
    updatedAt: toDate(row.updatedAt),
    confirmedAt: toDate(row.confirmedAt),
  };
}

async function listStoredNextBestActions(
  userId: string,
  schoolId?: string,
): Promise<NextBestAction[]> {
  if (isFirebaseMockMode()) return [];
  const db = getDb();
  const refs = [
    collection(db, 'users', userId, 'nextBestActions'),
    ...(schoolId ? [collection(db, 'users', userId, 'schools', schoolId, 'nextBestActions')] : []),
  ];

  const snaps = await Promise.all(
    refs.map((ref) => getDocs(query(ref, orderBy('priority', 'asc'), limit(8))).catch(() => null)),
  );

  return snaps
    .flatMap(
      (snap) => snap?.docs.map((docSnap) => parseNextBestAction(docSnap.data(), docSnap.id)) ?? [],
    )
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 8);
}

export async function listNextBestActions(
  userId: string,
  schoolId?: string,
): Promise<NextBestAction[]> {
  const stored = await listStoredNextBestActions(userId, schoolId);
  if (stored.length > 0) return stored;

  const [tasks, courseSpaces] = await Promise.all([
    listInboxTasks(userId, schoolId).catch(() => [] as InboxTask[]),
    listCourseSpaces(userId, schoolId).catch(() => []),
  ]);

  const derived = tasks.map(actionFromInboxTask).sort((a, b) => a.priority - b.priority);
  if (derived.length > 0) return derived.slice(0, 8);

  const firstCourse = courseSpaces[0];
  if (firstCourse) {
    return [
      {
        id: `system:course:${firstCourse.groupId}`,
        title: '先檢查今天的課程節奏',
        description: `${firstCourse.name} 已經接入課程工作流，可從教材、作業、測驗與課堂互動開始。`,
        priority: 3,
        urgency: 'medium',
        reason: '沒有高壓待辦時，維持課程節奏就是最重要的下一步。',
        nextStep: '打開課程中樞',
        actionLabel: '查看課程',
        actionTarget: {
          tab: '課程',
          screen: 'CourseHub',
          params: { groupId: firstCourse.groupId },
        },
        evidenceRefs: [{ type: 'course', id: firstCourse.groupId, label: firstCourse.name }],
        requiresConfirmation: false,
        source: 'system',
        createdAt: new Date(),
      },
    ];
  }

  return [];
}

export async function listRiskSnapshots(
  userId: string,
  schoolId?: string,
): Promise<StudentRiskSnapshot[]> {
  if (!isFirebaseMockMode()) {
    const db = getDb();
    const refs = [
      collection(db, 'users', userId, 'riskSnapshots'),
      ...(schoolId ? [collection(db, 'users', userId, 'schools', schoolId, 'riskSnapshots')] : []),
    ];
    const snaps = await Promise.all(
      refs.map((ref) =>
        getDocs(query(ref, orderBy('generatedAt', 'desc'), limit(5))).catch(() => null),
      ),
    );
    const stored = snaps.flatMap(
      (snap) =>
        snap?.docs.map((docSnap) => parseRiskSnapshot(docSnap.data(), docSnap.id, userId)) ?? [],
    );
    if (stored.length > 0)
      return stored.sort(
        (a, b) => (b.generatedAt?.getTime() ?? 0) - (a.generatedAt?.getTime() ?? 0),
      );

    try {
      const callable = httpsCallable<{ schoolId?: string }, { snapshots?: StudentRiskSnapshot[] }>(
        getFunctionsInstance(),
        'getStudentRiskSnapshots',
      );
      const result = await callable({ schoolId });
      if (Array.isArray(result.data.snapshots) && result.data.snapshots.length > 0) {
        return result.data.snapshots.map((snapshot) => ({
          ...snapshot,
          generatedAt: toDate((snapshot as any).generatedAt),
        }));
      }
    } catch {
      // Fall through to local derivation.
    }
  }

  const actions = await listNextBestActions(userId, schoolId);
  const criticalCount = actions.filter(
    (action) => action.urgency === 'critical' || action.urgency === 'high',
  ).length;
  const score = Math.min(
    95,
    criticalCount * 22 + actions.filter((action) => !!action.dueAt).length * 7,
  );
  const level: StudentRiskSnapshot['level'] =
    score >= 70 ? 'critical' : score >= 45 ? 'warning' : score >= 20 ? 'watch' : 'safe';

  return [
    {
      id: `local-risk-${Date.now()}`,
      userId,
      schoolId,
      level,
      score,
      summary:
        actions.length > 0
          ? `目前有 ${actions.length} 個可執行項目，其中 ${criticalCount} 個需要優先處理。`
          : '目前沒有高壓待辦，建議維持課程節奏。',
      signals: actions.slice(0, 3).map((action, index) => ({
        id: `signal-${action.id}`,
        userId,
        schoolId,
        type: action.urgency === 'critical' ? 'workload_spike' : 'positive_momentum',
        severity: Math.max(0.2, 1 - index * 0.2),
        title: action.title,
        description: action.reason,
        evidenceRefs: action.evidenceRefs,
        createdAt: new Date(),
      })),
      recommendedActions: actions.slice(0, 3),
      generatedAt: new Date(),
    },
  ];
}

export async function listPulseAggregates(schoolId = 'tw-pu'): Promise<PulseAggregate[]> {
  if (!isFirebaseMockMode()) {
    const db = getDb();
    const snap = await getDocs(
      query(
        collection(db, 'schools', schoolId, 'pulseAggregates'),
        orderBy('updatedAt', 'desc'),
        limit(20),
      ),
    ).catch(() => null);
    const stored =
      snap?.docs.map((docSnap) => parsePulseAggregate(docSnap.data(), docSnap.id, schoolId)) ?? [];
    if (stored.length > 0) return stored;

    try {
      const callable = httpsCallable<{ schoolId?: string }, { aggregates?: PulseAggregate[] }>(
        getFunctionsInstance(),
        'listPulseAggregates',
      );
      const result = await callable({ schoolId });
      if (Array.isArray(result.data.aggregates)) {
        return result.data.aggregates.map((aggregate) => ({
          ...aggregate,
          updatedAt: toDate((aggregate as any).updatedAt),
        }));
      }
    } catch {
      // Fall through to seeded aggregates.
    }
  }

  const now = new Date();
  return [
    {
      id: 'lib_main',
      schoolId,
      locationId: 'lib_main',
      locationName: '蓋夏圖書館',
      category: 'library',
      currentLevel: 3,
      confidence: 0.42,
      sampleSize: 0,
      reportCount24h: 0,
      trend: 'stable',
      bestTimeToVisit: '14:00-15:00',
      updatedAt: now,
    },
    {
      id: 'cafe_main',
      schoolId,
      locationId: 'cafe_main',
      locationName: '學生餐廳',
      category: 'dining',
      currentLevel: 4,
      confidence: 0.38,
      sampleSize: 0,
      reportCount24h: 0,
      trend: 'rising',
      bestTimeToVisit: '13:30 後',
      updatedAt: now,
    },
    {
      id: 'parking_main',
      schoolId,
      locationId: 'parking_main',
      locationName: '主停車場',
      category: 'parking',
      currentLevel: 3,
      confidence: 0.34,
      sampleSize: 0,
      reportCount24h: 0,
      trend: 'falling',
      bestTimeToVisit: '10:30 後',
      updatedAt: now,
    },
  ];
}

export async function submitPulseReport(input: {
  schoolId: string;
  locationId: string;
  locationName?: string;
  category?: PulseAggregate['category'];
  level: PulseAggregate['currentLevel'];
}): Promise<void> {
  if (!isFirebaseMockMode()) {
    try {
      const callable = httpsCallable<typeof input, { success: boolean }>(
        getFunctionsInstance(),
        'submitPulseReport',
      );
      await callable(input);
      return;
    } catch {
      // Use local fallback so demo flow still works when Functions are unavailable.
    }
  }

  await submitLocalCrowdReport(input.locationId, input.level);
}
