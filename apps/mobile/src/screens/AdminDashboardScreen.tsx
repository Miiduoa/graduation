/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View, Pressable, TextInput, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

import {
  Screen,
  Button,
  Pill,
  LoadingState,
  SectionTitle,
  SegmentedControl,
} from '../ui/components';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { getDb } from '../firebase';
import { useAdminEvents } from '../hooks/useAdminEvents';
import { useAsyncList } from '../hooks/useAsyncList';
import {
  bulkDeleteSchoolEvents,
  bulkUpdateSchoolAnnouncements,
  deleteSchoolAnnouncement,
  deleteSchoolEvent,
  upsertCafeteriaOperatorAssignment,
  upsertSchoolCafeteriaConfig,
  updateSchoolMemberRole as updateSchoolMemberRoleCall,
  upsertSchoolAnnouncement,
  upsertSchoolEvent,
} from '../services/admin';
import { fetchSchoolDirectoryProfiles } from '../services/memberDirectory';
import {
  DEMO_ADMIN_ANNOUNCEMENTS,
  DEMO_ADMIN_EVENTS,
  DEMO_ADMIN_MEMBERS,
  DEMO_ADMIN_LOGS,
  DEMO_ADMIN_CAFETERIAS,
} from '../services/demoAdminMock';
import { formatDateTime } from '../utils/format';
import { isDevelopmentDemoSession } from '../services/release';
import { eventRegistrationCount } from '../services/eventRegistrationCount';
import {
  EventRegistrationPolicyFields,
  registrationPolicyDraft,
  registrationPolicyInput,
} from '../components/EventRegistrationPolicyFields';
import { AdminWorkbenchHeader } from './admin/AdminWorkbenchHeader';
import { ADMIN_TABS, AdminTabBar, type AdminTabKey } from './admin/AdminTabBar';
import { AdminDataStatusRow, AdminListFeedback, AdminSurface } from './admin/AdminSurface';
import {
  ADMIN_PAGE_SIZES,
  adminWorkbenchStyles as adminStyles,
  formatDataStatus,
  memberRoleLabel,
  type MemberRole,
} from './admin/adminWorkbenchStyles';
import { useAdminCollectionPage } from './admin/useAdminCollectionPage';
import { shareScopedAdminCsv, type AdminExportScopeToken } from './admin/adminScopedExport';

type AdminTab = AdminTabKey;
type SortMode = 'latest' | 'oldest' | 'pinned';
type LogFilterMode = 'all' | 'write' | 'delete' | 'batch' | 'export';
type WorkbenchScope = AdminExportScopeToken & { schoolId: string };
type AdminForm = 'announcement' | 'event' | 'cafeteria' | 'operator';

type Announcement = {
  id: string;
  title: string;
  body: string;
  source?: string;
  publishedAt?: any;
  pinned?: boolean;
};

type ClubEvent = {
  id: string;
  title: string;
  description?: string;
  location?: string;
  startsAt?: any;
  endsAt?: any;
  capacity?: number;
  registeredCount?: number;
  appRegistrationCount?: number;
  registrationPolicy?: Record<string, unknown>;
};

type SchoolMember = {
  id: string;
  role: 'admin' | 'editor' | 'member';
  displayName?: string;
  email?: string | null;
  department?: string | null;
  avatarUrl?: string | null;
  joinedAt?: any;
};

type AdminLog = {
  id: string;
  action: string;
  actorUid?: string;
  actorEmail?: string;
  details?: string;
  createdAt?: any;
};

type SchoolCafeteria = {
  id: string;
  name: string;
  merchantId?: string;
  brandKey?: string | null;
  location?: string | null;
  openingHours?: string | null;
  pilotStatus: 'inactive' | 'pilot' | 'live';
  orderingEnabled: boolean;
  activeOperatorCount: number;
  updatedAt?: any;
};

type CafeteriaOperator = {
  id: string;
  status: 'active' | 'inactive';
  role: 'owner' | 'manager' | 'staff';
  displayName?: string | null;
  email?: string | null;
  updatedAt?: any;
};

function toDateFromUnknown(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000);
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDateTimeInput(value: any): string {
  const dt = toDateFromUnknown(value);
  if (!dt) return '';
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())} ${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`;
}

function parseDateTimeInput(input: string): Date | null {
  const t = input.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const dt = new Date(year, month, day, hour, minute, 0, 0);
  if (Number.isNaN(dt.getTime())) return null;
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month ||
    dt.getDate() !== day ||
    dt.getHours() !== hour ||
    dt.getMinutes() !== minute
  ) {
    return null;
  }
  return dt;
}

function escapeCsvValue(value: unknown): string {
  const raw = value == null ? '' : String(value);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const headerLine = headers.map(escapeCsvValue).join(',');
  const bodyLines = rows.map((row) => row.map(escapeCsvValue).join(','));
  return [headerLine, ...bodyLines].join('\n');
}

function FormInput(props: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={adminStyles.formField}>
      <Text style={adminStyles.formLabel}>{props.label}</Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={theme.colors.muted}
        multiline={props.multiline}
        style={[
          adminStyles.formInput,
          {
            minHeight: props.multiline ? 100 : undefined,
            textAlignVertical: props.multiline ? 'top' : 'center',
          },
        ]}
      />
    </View>
  );
}

export function AdminDashboardScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();
  const db = getDb();
  const eventScope = JSON.stringify([auth.user?.uid, school.id]);
  const currentEventScope = useRef(eventScope);
  currentEventScope.current = eventScope;
  const eventFormGeneration = useRef(0);
  const eventSaving = useRef(false);
  const eventMounted = useRef(true);
  const workbenchMountedRef = useRef(true);
  const workbenchIdentityKey = JSON.stringify([
    auth.user?.uid ?? '',
    school.id,
    Boolean(auth.isAdmin),
    Boolean(auth.isEditor),
  ]);
  const workbenchIdentityRef = useRef(workbenchIdentityKey);
  const workbenchGenerationRef = useRef(0);
  if (workbenchIdentityRef.current !== workbenchIdentityKey) {
    workbenchIdentityRef.current = workbenchIdentityKey;
    workbenchGenerationRef.current += 1;
  }
  const workbenchGeneration = workbenchGenerationRef.current;
  const workbenchContextRef = useRef({
    identityKey: workbenchIdentityKey,
    generation: workbenchGeneration,
  });
  workbenchContextRef.current = {
    identityKey: workbenchIdentityKey,
    generation: workbenchGeneration,
  };
  const roleConfirmLockRef = useRef(false);
  const formContextsRef = useRef<Partial<Record<AdminForm, WorkbenchScope>>>({});
  const formSavingRef = useRef<Partial<Record<AdminForm, WorkbenchScope>>>({});
  useEffect(() => {
    eventMounted.current = true;
    workbenchMountedRef.current = true;
    return () => {
      eventMounted.current = false;
      workbenchMountedRef.current = false;
    };
  }, []);

  const isCurrentWorkbenchContext = (token: AdminExportScopeToken) =>
    workbenchMountedRef.current &&
    workbenchContextRef.current.generation === token.generation &&
    workbenchContextRef.current.identityKey === token.identityKey;
  const actionScope: WorkbenchScope = { ...workbenchContextRef.current, schoolId: school.id };
  const isCurrentForm = (kind: AdminForm, context: WorkbenchScope | undefined) =>
    Boolean(
      context && formContextsRef.current[kind] === context && isCurrentWorkbenchContext(context),
    );

  const [tab, setTab] = useState<AdminTab>('overview');
  const activeTab = !auth.isAdmin && (tab === 'members' || tab === 'settings') ? 'overview' : tab;
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [eventFormScope, setEventFormScope] = useState(eventScope);
  const [showCafeteriaModal, setShowCafeteriaModal] = useState(false);
  const [showOperatorModal, setShowOperatorModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const [editingCafeteria, setEditingCafeteria] = useState<SchoolCafeteria | null>(null);
  const [selectedOperatorCafeteria, setSelectedOperatorCafeteria] =
    useState<SchoolCafeteria | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingCafeteria, setSavingCafeteria] = useState(false);
  const [savingOperator, setSavingOperator] = useState(false);
  const [roleOpGeneration, setRoleOpGeneration] = useState(workbenchGeneration);
  const [pendingRoleUpdateId, setPendingRoleUpdateId] = useState<string | null>(null);
  const [roleUpdateError, setRoleUpdateError] = useState<string | null>(null);
  // Drop stale pending/error as soon as account/school/role scope changes (incl. A→B→A).
  if (roleOpGeneration !== workbenchGeneration) {
    setRoleOpGeneration(workbenchGeneration);
    setPendingRoleUpdateId(null);
    setRoleUpdateError(null);
    roleConfirmLockRef.current = false;
  }
  const [reloadingAll, setReloadingAll] = useState(false);
  const [memberKeyword, setMemberKeyword] = useState('');
  const [announcementKeyword, setAnnouncementKeyword] = useState('');
  const [eventKeyword, setEventKeyword] = useState('');
  const [announcementSort, setAnnouncementSort] = useState<SortMode>('latest');
  const [eventSort, setEventSort] = useState<Exclude<SortMode, 'pinned'>>('latest');
  const [batchDeletingAnnouncements, setBatchDeletingAnnouncements] = useState(false);
  const [batchDeletingEvents, setBatchDeletingEvents] = useState(false);
  const [batchPinningAnnouncements, setBatchPinningAnnouncements] = useState(false);
  const [batchUnpinningAnnouncements, setBatchUnpinningAnnouncements] = useState(false);
  const [exportingAnnouncements, setExportingAnnouncements] = useState(false);
  const [exportingEvents, setExportingEvents] = useState(false);
  const [logKeyword, setLogKeyword] = useState('');
  const [logFilter, setLogFilter] = useState<LogFilterMode>('all');
  const [exportingLogs, setExportingLogs] = useState(false);
  const [exportProgressGeneration, setExportProgressGeneration] = useState(workbenchGeneration);
  if (exportProgressGeneration !== workbenchGeneration) {
    setExportProgressGeneration(workbenchGeneration);
    setExportingAnnouncements(false);
    setExportingEvents(false);
    setExportingLogs(false);
  }
  const [mutationGeneration, setMutationGeneration] = useState(workbenchGeneration);
  if (mutationGeneration !== workbenchGeneration) {
    setMutationGeneration(workbenchGeneration);
    formContextsRef.current = {};
    formSavingRef.current = {};
    eventFormGeneration.current += 1;
    eventSaving.current = false;
    setShowAnnouncementModal(false);
    setShowEventModal(false);
    setShowCafeteriaModal(false);
    setShowOperatorModal(false);
    setSelectedOperatorCafeteria(null);
    setSaving(false);
    setSavingCafeteria(false);
    setSavingOperator(false);
    setBatchDeletingAnnouncements(false);
    setBatchDeletingEvents(false);
    setBatchPinningAnnouncements(false);
    setBatchUnpinningAnnouncements(false);
    setReloadingAll(false);
  }
  const announcementFormContext = formContextsRef.current.announcement;
  const eventFormContext = formContextsRef.current.event;
  const cafeteriaFormContext = formContextsRef.current.cafeteria;
  const operatorFormContext = formContextsRef.current.operator;

  const [annTitle, setAnnTitle] = useState('');
  const [annBody, setAnnBody] = useState('');
  const [annSource, setAnnSource] = useState('');
  const [annPinned, setAnnPinned] = useState(false);

  const [evtTitle, setEvtTitle] = useState('');
  const [evtDescription, setEvtDescription] = useState('');
  const [evtLocation, setEvtLocation] = useState('');
  const [evtCapacity, setEvtCapacity] = useState('');
  const [evtRegistrationPolicy, setEvtRegistrationPolicy] = useState(() =>
    registrationPolicyDraft(),
  );
  const [evtStartsAt, setEvtStartsAt] = useState('');
  const [evtEndsAt, setEvtEndsAt] = useState('');
  const [cafeteriaName, setCafeteriaName] = useState('');
  const [cafeteriaLocation, setCafeteriaLocation] = useState('');
  const [cafeteriaOpeningHours, setCafeteriaOpeningHours] = useState('');
  const [cafeteriaBrandKey, setCafeteriaBrandKey] = useState('');
  const [cafeteriaPilotStatus, setCafeteriaPilotStatus] = useState<'inactive' | 'pilot' | 'live'>(
    'inactive',
  );
  const [cafeteriaOrderingEnabled, setCafeteriaOrderingEnabled] = useState(false);
  const [operatorUid, setOperatorUid] = useState('');
  const [operatorDisplayName, setOperatorDisplayName] = useState('');
  const [operatorEmail, setOperatorEmail] = useState('');
  const [operatorRole, setOperatorRole] = useState<'owner' | 'manager' | 'staff'>('staff');
  const [operatorStatus, setOperatorStatus] = useState<'active' | 'inactive'>('active');

  const demoMode = isDevelopmentDemoSession(auth.user?.uid);

  const sessionUid = auth.user?.uid ?? '';
  const canAccessAdminCollections = Boolean(auth.isAdmin || auth.isEditor);
  const adminAccessFence = auth.isAdmin ? 'admin' : auth.isEditor ? 'editor' : 'none';

  const {
    items: announcements,
    loading: annLoading,
    busy: annBusy,
    error: annFailed,
    errorMessage: annErrorMessage,
    hasMore: moreAnnouncements,
    loadMore: loadMoreAnnouncements,
    reload: reloadAnn,
  } = useAdminCollectionPage<Announcement>({
    schoolId: school.id,
    uid: sessionUid,
    canAccess: canAccessAdminCollections,
    fenceKey: `${adminAccessFence}:${demoMode ? 'demo' : 'live'}`,
    demoItems: demoMode ? (DEMO_ADMIN_ANNOUNCEMENTS as Announcement[]) : undefined,
    pageSize: ADMIN_PAGE_SIZES.announcements,
    getCollection: () => collection(db, 'schools', school.id, 'announcements'),
    buildConstraints: () => [orderBy('publishedAt', 'desc')],
    mapDocs: (docs) => docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
  });
  const annError = annFailed ? annErrorMessage : null;
  const annRefreshing = annBusy && announcements.length > 0;

  const {
    items: events,
    loading: evtLoading,
    busy: evtBusy,
    error: evtError,
    hasMore: moreEvents,
    loadMore: loadMoreEvents,
    reload: reloadEvt,
  } = useAdminEvents<ClubEvent>(
    school.id,
    canAccessAdminCollections ? sessionUid : '',
    demoMode ? (DEMO_ADMIN_EVENTS as ClubEvent[]) : undefined,
  );

  const {
    items: members,
    loading: memLoading,
    busy: memBusy,
    error: memFailed,
    errorMessage: memErrorMessage,
    hasMore: moreMembers,
    loadMore: loadMoreMembers,
    reload: reloadMem,
  } = useAdminCollectionPage<SchoolMember>({
    schoolId: school.id,
    uid: sessionUid,
    canAccess: Boolean(auth.isAdmin),
    fenceKey: `${adminAccessFence}:${demoMode ? 'demo' : 'live'}`,
    demoItems: demoMode ? (DEMO_ADMIN_MEMBERS as SchoolMember[]) : undefined,
    pageSize: ADMIN_PAGE_SIZES.members,
    getCollection: () => collection(db, 'schools', school.id, 'members'),
    // Default document-ID order — no explicit orderBy / composite index.
    buildConstraints: () => [],
    mapDocs: async (docs) => {
      const directoryProfiles = await fetchSchoolDirectoryProfiles(
        school.id,
        docs.map((docSnap) => docSnap.id),
        db,
      );
      const profilesById = Object.fromEntries(
        directoryProfiles.map((profile) => [profile.uid, profile]),
      );
      return docs.map((d) => {
        const data = d.data() as any;
        const profile = profilesById[d.id];
        return {
          id: d.id,
          role: data.role ?? 'member',
          displayName: profile?.displayName ?? d.id.slice(0, 8),
          department: profile?.department ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          joinedAt: data.joinedAt,
        } satisfies SchoolMember;
      });
    },
  });
  const memError = memFailed ? memErrorMessage : null;
  const memRefreshing = memBusy && members.length > 0;

  const {
    items: adminLogs,
    loading: logsLoading,
    busy: logsBusy,
    error: logsFailed,
    errorMessage: logsErrorMessage,
    hasMore: moreLogs,
    loadMore: loadMoreLogs,
    reload: reloadLogs,
  } = useAdminCollectionPage<AdminLog>({
    schoolId: school.id,
    uid: sessionUid,
    canAccess: Boolean(auth.isAdmin),
    fenceKey: `${adminAccessFence}:${demoMode ? 'demo' : 'live'}`,
    demoItems: demoMode ? (DEMO_ADMIN_LOGS as AdminLog[]) : undefined,
    pageSize: ADMIN_PAGE_SIZES.logs,
    getCollection: () => collection(db, 'schools', school.id, 'adminLogs'),
    buildConstraints: () => [orderBy('createdAt', 'desc')],
    mapDocs: (docs) => docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
  });
  const logsError = logsFailed ? logsErrorMessage : null;
  const logsRefreshing = logsBusy && adminLogs.length > 0;

  const {
    items: cafeterias,
    loading: cafeteriaLoading,
    refreshing: cafeteriaRefreshing,
    error: cafeteriaError,
    lastRefreshError: cafeteriaLastRefreshError,
    reload: reloadCafeterias,
    refresh: refreshCafeterias,
  } = useAsyncList<SchoolCafeteria>(async () => {
    if (!auth.isAdmin || !sessionUid) return [];
    if (demoMode) return DEMO_ADMIN_CAFETERIAS as SchoolCafeteria[];
    const qy = query(
      collection(db, 'schools', school.id, 'cafeterias'),
      orderBy('name', 'asc'),
      limit(ADMIN_PAGE_SIZES.cafeterias),
    );
    const snap = await getDocs(qy);
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as any;
      return {
        id: docSnap.id,
        name: data.name ?? docSnap.id,
        merchantId: data.merchantId ?? docSnap.id,
        brandKey: data.brandKey ?? null,
        location: data.location ?? null,
        openingHours: data.openingHours ?? null,
        pilotStatus:
          data.pilotStatus === 'pilot' || data.pilotStatus === 'live'
            ? data.pilotStatus
            : 'inactive',
        orderingEnabled: data.orderingEnabled === true,
        activeOperatorCount:
          typeof data.activeOperatorCount === 'number' ? data.activeOperatorCount : 0,
        updatedAt: data.updatedAt,
      } satisfies SchoolCafeteria;
    });
  }, [db, school.id, demoMode, sessionUid, auth.isAdmin]);
  const cafeteriaDisplayError = cafeteriaError ?? cafeteriaLastRefreshError;

  const {
    items: cafeteriaOperators,
    loading: operatorsLoading,
    error: operatorsError,
    lastRefreshError: operatorsLastRefreshError,
    reload: reloadOperators,
  } = useAsyncList<CafeteriaOperator>(async () => {
    if (!auth.isAdmin || !sessionUid || !selectedOperatorCafeteria) {
      return [];
    }

    const snap = await getDocs(
      query(
        collection(
          db,
          'schools',
          school.id,
          'cafeterias',
          selectedOperatorCafeteria.id,
          'operators',
        ),
        limit(100),
      ),
    );

    return snap.docs
      .map((docSnap) => {
        const data = docSnap.data() as any;
        return {
          id: docSnap.id,
          status: data.status === 'inactive' ? 'inactive' : 'active',
          role: data.role === 'owner' || data.role === 'manager' ? data.role : 'staff',
          displayName: data.displayName ?? null,
          email: data.email ?? null,
          updatedAt: data.updatedAt,
        } satisfies CafeteriaOperator;
      })
      .sort((a, b) => a.id.localeCompare(b.id, 'zh-TW'));
  }, [db, school.id, selectedOperatorCafeteria?.id, sessionUid, auth.isAdmin]);

  const loadedCounts = useMemo(() => {
    return {
      announcements: announcements.length,
      events: events.length,
      members: members.length,
      admins: members.filter((m) => m.role === 'admin').length,
      editors: members.filter((m) => m.role === 'editor').length,
      regular: members.filter((m) => m.role === 'member').length,
    };
  }, [announcements, events, members]);

  const filteredMembers = useMemo(() => {
    const kw = memberKeyword.trim().toLowerCase();
    if (!kw) return members;
    return members.filter((member) => {
      const fields = [member.displayName ?? '', member.department ?? '', member.id, member.role];
      return fields.some((f) => f.toLowerCase().includes(kw));
    });
  }, [members, memberKeyword]);

  const filteredAnnouncements = useMemo(() => {
    const kw = announcementKeyword.trim().toLowerCase();
    if (!kw) return announcements;
    return announcements.filter((ann) => {
      const fields = [ann.title, ann.body, ann.source ?? ''];
      return fields.some((f) => f.toLowerCase().includes(kw));
    });
  }, [announcements, announcementKeyword]);

  const filteredEvents = useMemo(() => {
    const kw = eventKeyword.trim().toLowerCase();
    if (!kw) return events;
    return events.filter((evt) => {
      const fields = [evt.title, evt.description ?? '', evt.location ?? ''];
      return fields.some((f) => f.toLowerCase().includes(kw));
    });
  }, [events, eventKeyword]);

  const sortedAnnouncements = useMemo(() => {
    const items = [...filteredAnnouncements];
    const getTime = (ann: Announcement) => toDateFromUnknown(ann.publishedAt)?.getTime() ?? 0;
    if (announcementSort === 'oldest') {
      return items.sort((a, b) => getTime(a) - getTime(b));
    }
    if (announcementSort === 'pinned') {
      return items.sort((a, b) => {
        const pinDiff = Number(!!b.pinned) - Number(!!a.pinned);
        if (pinDiff !== 0) return pinDiff;
        return getTime(b) - getTime(a);
      });
    }
    return items.sort((a, b) => getTime(b) - getTime(a));
  }, [announcementSort, filteredAnnouncements]);

  const sortedEvents = useMemo(() => {
    const items = [...filteredEvents];
    const getTime = (evt: ClubEvent) => toDateFromUnknown(evt.startsAt)?.getTime() ?? 0;
    if (eventSort === 'oldest') {
      return items.sort((a, b) => getTime(a) - getTime(b));
    }
    return items.sort((a, b) => getTime(b) - getTime(a));
  }, [eventSort, filteredEvents]);

  const filteredAdminLogs = useMemo(() => {
    const kw = logKeyword.trim().toLowerCase();
    return adminLogs.filter((log) => {
      const action = (log.action ?? '').toLowerCase();
      const details = (log.details ?? '').toLowerCase();
      const actor = (log.actorEmail ?? log.actorUid ?? '').toLowerCase();

      const matchKeyword = !kw || action.includes(kw) || details.includes(kw) || actor.includes(kw);
      if (!matchKeyword) return false;

      if (logFilter === 'all') return true;
      if (logFilter === 'write') return action.includes('create_') || action.includes('update_');
      if (logFilter === 'delete') return action.includes('delete_');
      if (logFilter === 'batch') return action.includes('batch_');
      if (logFilter === 'export') return action.includes('export_');
      return true;
    });
  }, [adminLogs, logFilter, logKeyword]);

  const openAnnouncementModal = (ann?: Announcement) => {
    if (!isCurrentWorkbenchContext(actionScope) || (!auth.isAdmin && !auth.isEditor)) return;
    formContextsRef.current.announcement = { ...actionScope };
    formSavingRef.current.announcement = undefined;
    setSaving(false);
    if (ann) {
      setEditingAnnouncement(ann);
      setAnnTitle(ann.title);
      setAnnBody(ann.body);
      setAnnSource(ann.source ?? '');
      setAnnPinned(ann.pinned ?? false);
    } else {
      setEditingAnnouncement(null);
      setAnnTitle('');
      setAnnBody('');
      setAnnSource(school.name);
      setAnnPinned(false);
    }
    setShowAnnouncementModal(true);
  };

  const closeAnnouncementModal = () => {
    formContextsRef.current.announcement = undefined;
    formSavingRef.current.announcement = undefined;
    setShowAnnouncementModal(false);
    setSaving(false);
  };

  const saveAnnouncement = async () => {
    const context = announcementFormContext;
    const current = () => isCurrentForm('announcement', context);
    if (!context || !current() || formSavingRef.current.announcement === context) return;
    if (!annTitle.trim()) {
      Alert.alert('錯誤', '請輸入標題');
      return;
    }
    formSavingRef.current.announcement = context;
    setSaving(true);
    try {
      await upsertSchoolAnnouncement({
        schoolId: context.schoolId,
        announcementId: editingAnnouncement?.id ?? null,
        title: annTitle.trim(),
        body: annBody.trim(),
        source: annSource.trim() || school.name,
        pinned: annPinned,
      });
      if (!current()) return;
      reloadAnn();
      reloadLogs();
      Alert.alert('成功', editingAnnouncement ? '公告已更新' : '公告已發布');
      closeAnnouncementModal();
    } catch (e: any) {
      if (current()) Alert.alert('錯誤', e?.message ?? '儲存失敗');
    } finally {
      if (current()) {
        formSavingRef.current.announcement = undefined;
        setSaving(false);
      }
    }
  };

  const deleteAnnouncement = async (ann: Announcement) => {
    const scope = actionScope;
    if (!isCurrentWorkbenchContext(scope)) return;
    Alert.alert('確認刪除', `確定要刪除「${ann.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          if (!isCurrentWorkbenchContext(scope)) return;
          try {
            await deleteSchoolAnnouncement({
              schoolId: scope.schoolId,
              announcementId: ann.id,
            });
            if (!isCurrentWorkbenchContext(scope)) return;
            reloadAnn();
            reloadLogs();
          } catch (e: any) {
            if (isCurrentWorkbenchContext(scope)) Alert.alert('錯誤', e?.message ?? '刪除失敗');
          }
        },
      },
    ]);
  };

  const closeEventModal = () => {
    formContextsRef.current.event = undefined;
    eventSaving.current = false;
    eventFormGeneration.current += 1;
    setShowEventModal(false);
    setSaving(false);
  };
  const openEventModal = (evt?: ClubEvent) => {
    if (!isCurrentWorkbenchContext(actionScope) || (!auth.isAdmin && !auth.isEditor)) return;
    formContextsRef.current.event = { ...actionScope };
    eventSaving.current = false;
    eventFormGeneration.current += 1;
    setEventFormScope(eventScope);
    setSaving(false);
    setEvtRegistrationPolicy(registrationPolicyDraft(evt?.registrationPolicy));
    if (evt) {
      setEditingEvent(evt);
      setEvtTitle(evt.title);
      setEvtDescription(evt.description ?? '');
      setEvtLocation(evt.location ?? '');
      setEvtCapacity(evt.capacity?.toString() ?? '');
      setEvtStartsAt(formatDateTimeInput(evt.startsAt));
      setEvtEndsAt(formatDateTimeInput(evt.endsAt));
    } else {
      setEditingEvent(null);
      setEvtTitle('');
      setEvtDescription('');
      setEvtLocation('');
      setEvtCapacity('');
      setEvtStartsAt('');
      setEvtEndsAt('');
    }
    setShowEventModal(true);
  };

  const openCafeteriaModal = (cafeteria?: SchoolCafeteria) => {
    if (!auth.isAdmin || !isCurrentWorkbenchContext(actionScope)) return;
    formContextsRef.current.cafeteria = { ...actionScope };
    formSavingRef.current.cafeteria = undefined;
    setSavingCafeteria(false);
    if (cafeteria) {
      setEditingCafeteria(cafeteria);
      setCafeteriaName(cafeteria.name);
      setCafeteriaLocation(cafeteria.location ?? '');
      setCafeteriaOpeningHours(cafeteria.openingHours ?? '');
      setCafeteriaBrandKey(cafeteria.brandKey ?? '');
      setCafeteriaPilotStatus(cafeteria.pilotStatus);
      setCafeteriaOrderingEnabled(cafeteria.orderingEnabled);
    } else {
      setEditingCafeteria(null);
      setCafeteriaName('');
      setCafeteriaLocation('');
      setCafeteriaOpeningHours('');
      setCafeteriaBrandKey('');
      setCafeteriaPilotStatus('inactive');
      setCafeteriaOrderingEnabled(false);
    }
    setShowCafeteriaModal(true);
  };

  const closeCafeteriaModal = () => {
    formContextsRef.current.cafeteria = undefined;
    formSavingRef.current.cafeteria = undefined;
    setShowCafeteriaModal(false);
    setSavingCafeteria(false);
  };

  const buildCafeteriaId = (name: string) => {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return normalized || `cafeteria-${Date.now()}`;
  };

  const saveCafeteria = async () => {
    const context = cafeteriaFormContext;
    const current = () => isCurrentForm('cafeteria', context);
    if (!context || !auth.isAdmin || !current() || formSavingRef.current.cafeteria === context)
      return;
    if (!cafeteriaName.trim()) {
      Alert.alert('錯誤', '請輸入餐廳名稱');
      return;
    }

    formSavingRef.current.cafeteria = context;
    setSavingCafeteria(true);
    try {
      await upsertSchoolCafeteriaConfig({
        schoolId: context.schoolId,
        cafeteriaId: editingCafeteria?.id ?? buildCafeteriaId(cafeteriaName),
        name: cafeteriaName.trim(),
        location: cafeteriaLocation.trim() || null,
        openingHours: cafeteriaOpeningHours.trim() || null,
        brandKey: cafeteriaBrandKey.trim() || null,
        pilotStatus: cafeteriaPilotStatus,
        orderingEnabled: cafeteriaOrderingEnabled,
      });
      if (!current()) return;
      reloadCafeterias();
      reloadLogs();
      Alert.alert('成功', editingCafeteria ? '餐廳設定已更新' : '餐廳已建立');
      closeCafeteriaModal();
    } catch (e: any) {
      if (current()) Alert.alert('錯誤', e?.message ?? '儲存餐廳設定失敗');
    } finally {
      if (current()) {
        formSavingRef.current.cafeteria = undefined;
        setSavingCafeteria(false);
      }
    }
  };

  const openOperatorModal = (cafeteria: SchoolCafeteria, operator?: CafeteriaOperator) => {
    if (!auth.isAdmin || !isCurrentWorkbenchContext(actionScope)) return;
    formContextsRef.current.operator = { ...actionScope };
    formSavingRef.current.operator = undefined;
    setSavingOperator(false);
    setSelectedOperatorCafeteria(cafeteria);
    setOperatorUid(operator?.id ?? '');
    setOperatorDisplayName(operator?.displayName ?? '');
    setOperatorEmail(operator?.email ?? '');
    setOperatorRole(operator?.role ?? 'staff');
    setOperatorStatus(operator?.status ?? 'active');
    setShowOperatorModal(true);
  };

  const closeOperatorModal = () => {
    formContextsRef.current.operator = undefined;
    formSavingRef.current.operator = undefined;
    setShowOperatorModal(false);
    setSavingOperator(false);
  };

  const saveOperatorAssignment = async () => {
    const context = operatorFormContext;
    const current = () => isCurrentForm('operator', context);
    if (!context || !auth.isAdmin || !current() || formSavingRef.current.operator === context)
      return;
    if (!selectedOperatorCafeteria) {
      Alert.alert('錯誤', '請先選擇餐廳');
      return;
    }
    if (!operatorUid.trim()) {
      Alert.alert('錯誤', '請輸入店員 UID');
      return;
    }

    formSavingRef.current.operator = context;
    setSavingOperator(true);
    try {
      await upsertCafeteriaOperatorAssignment({
        schoolId: context.schoolId,
        cafeteriaId: selectedOperatorCafeteria.id,
        targetUid: operatorUid.trim(),
        displayName: operatorDisplayName.trim() || null,
        email: operatorEmail.trim() || null,
        role: operatorRole,
        status: operatorStatus,
      });
      if (!current()) return;
      reloadOperators();
      reloadCafeterias();
      reloadLogs();
      Alert.alert('成功', '店員指派已更新');
    } catch (e: any) {
      if (current()) Alert.alert('錯誤', e?.message ?? '店員指派失敗');
    } finally {
      if (current()) {
        formSavingRef.current.operator = undefined;
        setSavingOperator(false);
      }
    }
  };

  const saveEvent = async () => {
    const generation = eventFormGeneration.current;
    const current = () =>
      eventMounted.current &&
      isCurrentForm('event', eventFormContext) &&
      currentEventScope.current === eventScope &&
      eventFormGeneration.current === generation;
    if (!eventFormContext || !current() || eventSaving.current) return;
    if (!evtTitle.trim()) {
      Alert.alert('錯誤', '請輸入活動名稱');
      return;
    }
    const normalizedCapacity = evtCapacity.trim();
    if (normalizedCapacity) {
      const n = Number(normalizedCapacity);
      if (!Number.isInteger(n) || n <= 0) {
        Alert.alert('錯誤', '人數上限需為正整數，或留空表示不限');
        return;
      }
    }
    const startDate = evtStartsAt.trim() ? parseDateTimeInput(evtStartsAt) : null;
    const endDate = evtEndsAt.trim() ? parseDateTimeInput(evtEndsAt) : null;
    if (evtStartsAt.trim() && !startDate) {
      Alert.alert('錯誤', '開始時間格式錯誤，請使用 YYYY-MM-DD HH:mm');
      return;
    }
    if (evtEndsAt.trim() && !endDate) {
      Alert.alert('錯誤', '結束時間格式錯誤，請使用 YYYY-MM-DD HH:mm');
      return;
    }
    if (startDate && endDate && endDate <= startDate) {
      Alert.alert('錯誤', '結束時間需晚於開始時間');
      return;
    }

    eventSaving.current = true;
    setSaving(true);
    try {
      await upsertSchoolEvent({
        schoolId: eventFormContext.schoolId,
        eventId: editingEvent?.id ?? null,
        registrationPolicy: registrationPolicyInput(evtRegistrationPolicy),
        title: evtTitle.trim(),
        description: evtDescription.trim(),
        location: evtLocation.trim(),
        capacity: normalizedCapacity ? Number(normalizedCapacity) : null,
        startsAt: startDate ? startDate.toISOString() : null,
        endsAt: endDate ? endDate.toISOString() : null,
      });
      if (!current()) return;
      setShowEventModal(false);
      reloadEvt();
      reloadLogs();
      Alert.alert('成功', editingEvent ? '活動已更新' : '活動已建立');
    } catch (e: any) {
      if (current()) Alert.alert('錯誤', e?.message ?? '儲存失敗');
    } finally {
      if (current()) {
        eventSaving.current = false;
        setSaving(false);
      }
    }
  };

  const deleteEvent = async (evt: ClubEvent) => {
    const scope = actionScope;
    if (!isCurrentWorkbenchContext(scope)) return;
    Alert.alert('確認刪除', `確定要刪除「${evt.title}」？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '刪除',
        style: 'destructive',
        onPress: async () => {
          if (!isCurrentWorkbenchContext(scope)) return;
          try {
            await deleteSchoolEvent({
              schoolId: scope.schoolId,
              eventId: evt.id,
            });
            if (!isCurrentWorkbenchContext(scope)) return;
            reloadEvt();
            reloadLogs();
          } catch (e: any) {
            if (isCurrentWorkbenchContext(scope)) Alert.alert('錯誤', e?.message ?? '刪除失敗');
          }
        },
      },
    ]);
  };

  const applyMemberRoleChange = async (captured: {
    generation: number;
    identityKey: string;
    schoolId: string;
    targetUid: string;
    oldRole: MemberRole;
    newRole: MemberRole;
    displayName: string;
  }) => {
    roleConfirmLockRef.current = false;
    if (!isCurrentWorkbenchContext(captured)) return;
    if (!auth.isAdmin) return;
    setRoleUpdateError(null);
    setPendingRoleUpdateId(captured.targetUid);
    try {
      await updateSchoolMemberRoleCall({
        schoolId: captured.schoolId,
        targetUid: captured.targetUid,
        role: captured.newRole,
      });
      if (!isCurrentWorkbenchContext(captured)) return;
      reloadMem();
      reloadLogs();
      Alert.alert('成功', '權限已更新');
    } catch (e: any) {
      if (!isCurrentWorkbenchContext(captured)) return;
      const message = e?.message ?? '更新失敗';
      setRoleUpdateError(message);
      Alert.alert('錯誤', message);
    } finally {
      // Never clear a newer operation from an old completion.
      if (isCurrentWorkbenchContext(captured)) {
        setPendingRoleUpdateId(null);
      }
    }
  };

  const requestMemberRoleChange = (member: SchoolMember, newRole: MemberRole) => {
    if (!auth.isAdmin || !workbenchMountedRef.current) return;
    if (member.role === newRole) return;
    if (pendingRoleUpdateId || roleConfirmLockRef.current) return;

    const captured = {
      generation: workbenchGeneration,
      identityKey: workbenchIdentityKey,
      schoolId: school.id,
      targetUid: member.id,
      oldRole: member.role,
      newRole,
      displayName: member.displayName?.trim() || member.id,
    };
    roleConfirmLockRef.current = true;
    Alert.alert(
      '確認變更權限',
      `確定將「${captured.displayName}」的角色由「${memberRoleLabel(captured.oldRole)}」改為「${memberRoleLabel(captured.newRole)}」？`,
      [
        {
          text: '取消',
          style: 'cancel',
          onPress: () => {
            roleConfirmLockRef.current = false;
          },
        },
        {
          text: '確認變更',
          onPress: () => {
            void applyMemberRoleChange(captured);
          },
        },
      ],
    );
  };

  const isExportEligible = (scope: AdminExportScopeToken) => isCurrentWorkbenchContext(scope);

  const runScopedCsvExport = async (args: {
    kind: 'announcements' | 'events' | 'admin-logs';
    schoolCode: string;
    csv: string;
    rowCount: number;
    setBusy: (busy: boolean) => void;
    successLog: string;
    failureMessage: string;
  }) => {
    const scope: AdminExportScopeToken = {
      generation: workbenchGeneration,
      identityKey: workbenchIdentityKey,
    };
    args.setBusy(true);
    try {
      const result = await shareScopedAdminCsv({
        kind: args.kind,
        schoolCode: args.schoolCode,
        csv: args.csv,
        scope,
        isEligible: isExportEligible,
      });
      if (!isExportEligible(scope)) return;
      if (result === 'unavailable') {
        Alert.alert('提示', '此裝置目前無法分享檔案。');
        return;
      }
      if (result === 'shared') {
        logAdminAction(args.successLog, `count=${args.rowCount}`);
      }
    } catch (e: any) {
      if (!isExportEligible(scope)) return;
      Alert.alert('錯誤', e?.message ?? args.failureMessage);
    } finally {
      if (isExportEligible(scope)) {
        args.setBusy(false);
      }
    }
  };

  const reloadAllWorkbenchData = async () => {
    const scope = actionScope;
    if (!isCurrentWorkbenchContext(scope)) return;
    setReloadingAll(true);
    try {
      await Promise.all([
        Promise.resolve(reloadAnn()),
        Promise.resolve(reloadMem()),
        Promise.resolve(reloadLogs()),
        refreshCafeterias(),
        Promise.resolve(reloadEvt()),
      ]);
    } finally {
      if (isCurrentWorkbenchContext(scope)) setReloadingAll(false);
    }
  };

  const batchDeleteFilteredAnnouncements = async () => {
    const scope = actionScope;
    if (!isCurrentWorkbenchContext(scope)) return;
    if (sortedAnnouncements.length === 0) {
      Alert.alert('提示', '目前沒有可刪除的公告。');
      return;
    }
    setBatchDeletingAnnouncements(true);
    try {
      await bulkUpdateSchoolAnnouncements({
        schoolId: scope.schoolId,
        announcementIds: sortedAnnouncements.map((ann) => ann.id),
        action: 'delete',
      });
      if (!isCurrentWorkbenchContext(scope)) return;
      reloadAnn();
      reloadLogs();
      Alert.alert('成功', `已刪除 ${sortedAnnouncements.length} 則公告`);
    } catch (e: any) {
      if (isCurrentWorkbenchContext(scope)) Alert.alert('錯誤', e?.message ?? '批次刪除公告失敗');
    } finally {
      if (isCurrentWorkbenchContext(scope)) setBatchDeletingAnnouncements(false);
    }
  };

  const batchDeleteFilteredEvents = async () => {
    const scope = actionScope;
    if (!isCurrentWorkbenchContext(scope)) return;
    if (sortedEvents.length === 0) {
      Alert.alert('提示', '目前沒有可刪除的活動。');
      return;
    }
    setBatchDeletingEvents(true);
    try {
      await bulkDeleteSchoolEvents({
        schoolId: scope.schoolId,
        eventIds: sortedEvents.map((evt) => evt.id),
      });
      if (!isCurrentWorkbenchContext(scope)) return;
      reloadEvt();
      reloadLogs();
      Alert.alert('成功', `已刪除 ${sortedEvents.length} 個活動`);
    } catch (e: any) {
      if (isCurrentWorkbenchContext(scope)) Alert.alert('錯誤', e?.message ?? '批次刪除活動失敗');
    } finally {
      if (isCurrentWorkbenchContext(scope)) setBatchDeletingEvents(false);
    }
  };

  const batchSetPinForFilteredAnnouncements = async (pinned: boolean) => {
    const scope = actionScope;
    if (!isCurrentWorkbenchContext(scope)) return;
    if (sortedAnnouncements.length === 0) {
      Alert.alert('提示', '目前沒有可更新的公告。');
      return;
    }
    if (pinned) {
      setBatchPinningAnnouncements(true);
    } else {
      setBatchUnpinningAnnouncements(true);
    }
    try {
      await bulkUpdateSchoolAnnouncements({
        schoolId: scope.schoolId,
        announcementIds: sortedAnnouncements.map((ann) => ann.id),
        action: pinned ? 'pin' : 'unpin',
      });
      if (!isCurrentWorkbenchContext(scope)) return;
      reloadAnn();
      reloadLogs();
      Alert.alert(
        '成功',
        `已將 ${sortedAnnouncements.length} 則公告設為${pinned ? '置頂' : '非置頂'}`,
      );
    } catch (e: any) {
      if (isCurrentWorkbenchContext(scope)) Alert.alert('錯誤', e?.message ?? '批次更新公告失敗');
    } finally {
      if (isCurrentWorkbenchContext(scope)) {
        setBatchPinningAnnouncements(false);
        setBatchUnpinningAnnouncements(false);
      }
    }
  };

  const exportAnnouncementsCsv = async () => {
    const rows = sortedAnnouncements.map((ann) => [
      ann.id,
      ann.title,
      ann.body,
      ann.source ?? '',
      ann.pinned ? '1' : '0',
      formatDateTime(ann.publishedAt),
    ]);
    if (rows.length === 0) {
      Alert.alert('提示', '目前沒有可匯出的公告。');
      return;
    }
    const csv = buildCsv(['id', 'title', 'body', 'source', 'pinned', 'publishedAt'], rows);
    await runScopedCsvExport({
      kind: 'announcements',
      schoolCode: school.code,
      csv,
      rowCount: rows.length,
      setBusy: setExportingAnnouncements,
      successLog: 'export_announcements_csv',
      failureMessage: '匯出公告失敗',
    });
  };

  const exportEventsCsv = async () => {
    const rows = sortedEvents.map((evt) => [
      evt.id,
      evt.title,
      evt.description ?? '',
      evt.location ?? '',
      formatDateTime(evt.startsAt),
      formatDateTime(evt.endsAt),
      evt.capacity ?? '',
      eventRegistrationCount(evt) ?? '待確認',
    ]);
    if (rows.length === 0) {
      Alert.alert('提示', '目前沒有可匯出的活動。');
      return;
    }
    const csv = buildCsv(
      [
        'id',
        'title',
        'description',
        'location',
        'startsAt',
        'endsAt',
        'capacity',
        'registeredCount',
      ],
      rows,
    );
    await runScopedCsvExport({
      kind: 'events',
      schoolCode: school.code,
      csv,
      rowCount: rows.length,
      setBusy: setExportingEvents,
      successLog: 'export_events_csv',
      failureMessage: '匯出活動失敗',
    });
  };

  const exportAdminLogsCsv = async () => {
    const rows = filteredAdminLogs.map((log) => [
      log.id,
      log.action,
      log.details ?? '',
      log.actorEmail || log.actorUid || '',
      formatDateTime(log.createdAt),
    ]);
    if (rows.length === 0) {
      Alert.alert('提示', '目前沒有可匯出的操作紀錄。');
      return;
    }
    const csv = buildCsv(['id', 'action', 'details', 'actor', 'createdAt'], rows);
    await runScopedCsvExport({
      kind: 'admin-logs',
      schoolCode: school.code,
      csv,
      rowCount: rows.length,
      setBusy: setExportingLogs,
      successLog: 'export_admin_logs_csv',
      failureMessage: '匯出操作紀錄失敗',
    });
  };

  const logAdminAction = async (action: string, details?: string) => {
    console.info('[AdminDashboard] Local-only admin action:', { action, details });
  };

  if (!auth.isAdmin && !auth.isEditor) {
    return (
      <Screen>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        >
          <AdminSurface title="管理後台" description="此功能僅限管理員或編輯者使用。">
            <Pill text="權限不足" />
            <Text style={adminStyles.mutedNote}>若你是管理員，請用具有管理員權限的帳號登入。</Text>
          </AdminSurface>
        </ScrollView>
      </Screen>
    );
  }

  const roleLabel = auth.isAdmin ? '學校管理員' : '校園內容編輯';
  const listsRefreshing =
    reloadingAll || annBusy || memBusy || logsBusy || cafeteriaRefreshing || evtBusy;

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 14, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
      >
        <AdminWorkbenchHeader
          schoolName={school.name}
          schoolCode={school.code}
          roleLabel={roleLabel}
          accountText={auth.user?.email ?? auth.user?.uid ?? null}
        />
        <AdminTabBar
          active={activeTab}
          onChange={setTab}
          items={
            auth.isAdmin
              ? ADMIN_TABS
              : ADMIN_TABS.filter((item) => item.key !== 'members' && item.key !== 'settings')
          }
        />

        {activeTab === 'overview' && (
          <>
            <AdminSurface title="今日工作" description="發布校內消息、安排活動，並追蹤最近更新。">
              <View style={adminStyles.actionStack}>
                <Button text="發布公告" kind="primary" onPress={() => openAnnouncementModal()} />
                <Button text="建立新活動" onPress={() => openEventModal()} />
              </View>
              {auth.isAdmin ? (
                <View style={adminStyles.secondaryActions}>
                  <Button text="前往成員" kind="outline" onPress={() => setTab('members')} />
                  <Button text="前往設定" kind="outline" onPress={() => setTab('settings')} />
                  <Button
                    text="課程認證"
                    kind="outline"
                    onPress={() => nav?.navigate?.('AdminCourseVerify')}
                  />
                </View>
              ) : null}
            </AdminSurface>

            <AdminSurface
              title="資料狀態"
              description="資料分批載入；搜尋與匯出以已載入的內容為準。"
            >
              <AdminDataStatusRow
                label="公告"
                value={formatDataStatus({
                  loading: annLoading,
                  refreshing: annRefreshing || reloadingAll,
                  error: annError,
                  count: loadedCounts.announcements,
                  hasMore: moreAnnouncements,
                })}
                isError={Boolean(annError)}
                onRetry={() => void reloadAnn()}
              />
              <AdminDataStatusRow
                label="活動"
                value={
                  evtLoading && events.length === 0
                    ? '載入中…'
                    : evtBusy
                      ? `更新中…（目前已載入 ${loadedCounts.events}）`
                      : evtError
                        ? events.length > 0
                          ? '載入失敗（已載入內容仍保留）'
                          : '活動載入失敗，請重試'
                        : moreEvents
                          ? `目前已載入 ${loadedCounts.events}（尚可載入更多）`
                          : `目前已載入 ${loadedCounts.events}`
                }
                isError={Boolean(evtError)}
                onRetry={() => void reloadEvt()}
                isLast={!auth.isAdmin}
              />
              {auth.isAdmin ? (
                <AdminDataStatusRow
                  label="成員"
                  value={formatDataStatus({
                    loading: memLoading,
                    refreshing: memRefreshing || reloadingAll,
                    error: memError,
                    count: loadedCounts.members,
                    hasMore: moreMembers,
                  })}
                  isError={Boolean(memError)}
                  onRetry={() => void reloadMem()}
                  isLast
                />
              ) : null}
            </AdminSurface>

            <AdminSurface
              title="最近公告"
              description={
                annError
                  ? '公告清單載入失敗'
                  : annLoading
                    ? '載入中…'
                    : `顯示最近 ${Math.min(3, announcements.length)} 則（已載入範圍內）`
              }
            >
              <AdminListFeedback
                loading={annLoading}
                error={annError}
                empty={announcements.length === 0}
                emptyText="尚無公告"
                onRetry={reloadAnn}
              >
                <View style={{ gap: 8 }}>
                  {announcements.slice(0, 3).map((ann) => (
                    <Pressable
                      key={ann.id}
                      onPress={() => openAnnouncementModal(ann)}
                      style={adminStyles.listItem}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                        {ann.pinned ? (
                          <Ionicons name="pin" size={14} color={theme.colors.accent} />
                        ) : null}
                        <Text style={[adminStyles.listItemTitle, { flex: 1 }]}>{ann.title}</Text>
                      </View>
                      <Text style={adminStyles.listItemMeta}>
                        {formatDateTime(ann.publishedAt)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </AdminListFeedback>
            </AdminSurface>

            <AdminSurface
              title="最近活動"
              description={
                evtError
                  ? events.length > 0
                    ? '活動清單載入失敗；已載入內容仍保留'
                    : '活動清單載入失敗，請重新讀取'
                  : evtLoading && events.length === 0
                    ? '載入中…'
                    : `顯示最近 ${Math.min(3, events.length)} 個（已載入範圍內）`
              }
            >
              <AdminListFeedback
                loading={evtLoading && events.length === 0}
                error={evtError ? '無法更新活動列表' : null}
                empty={events.length === 0}
                emptyText="尚無活動"
                onRetry={() => void reloadEvt()}
              >
                <View style={{ gap: 8 }}>
                  {events.slice(0, 3).map((evt) => (
                    <Pressable
                      key={evt.id}
                      onPress={() => openEventModal(evt)}
                      style={adminStyles.listItem}
                    >
                      <Text style={adminStyles.listItemTitle}>{evt.title}</Text>
                      <Text style={adminStyles.listItemMeta}>
                        {formatDateTime(evt.startsAt) || '時間尚未公布'}
                        {evt.location ? ` · ${evt.location}` : ''}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </AdminListFeedback>
            </AdminSurface>
          </>
        )}

        {activeTab === 'announcements' && (
          <AdminSurface
            title="公告管理"
            description={`${formatDataStatus({
              loading: annLoading,
              refreshing: annRefreshing,
              error: annError,
              count: announcements.length,
              hasMore: moreAnnouncements,
            })}。搜尋與匯出目前已載入的資料。`}
          >
            <TextInput
              value={announcementKeyword}
              onChangeText={setAnnouncementKeyword}
              placeholder="搜尋目前已載入的標題、內容、來源"
              placeholderTextColor={theme.colors.muted}
              style={adminStyles.searchField}
            />
            <SegmentedControl
              options={[
                { key: 'latest', label: '最新' },
                { key: 'oldest', label: '最舊' },
                { key: 'pinned', label: '置頂優先' },
              ]}
              selected={announcementSort}
              onChange={setAnnouncementSort}
            />
            <View style={adminStyles.actionStack}>
              <Button text="發布公告" kind="primary" onPress={() => openAnnouncementModal()} />
            </View>
            <View style={adminStyles.secondaryActions}>
              <Button
                text={batchPinningAnnouncements ? '套用中...' : '批次置頂（目前篩選）'}
                disabled={
                  batchPinningAnnouncements ||
                  batchUnpinningAnnouncements ||
                  sortedAnnouncements.length === 0
                }
                onPress={() =>
                  Alert.alert(
                    '確認批次置頂',
                    `將目前已載入且篩選出的 ${sortedAnnouncements.length} 則公告設為置頂，確定繼續？`,
                    [
                      { text: '取消', style: 'cancel' },
                      { text: '確認', onPress: () => batchSetPinForFilteredAnnouncements(true) },
                    ],
                  )
                }
              />
              <Button
                text={batchUnpinningAnnouncements ? '套用中...' : '批次取消置頂（目前篩選）'}
                disabled={
                  batchPinningAnnouncements ||
                  batchUnpinningAnnouncements ||
                  sortedAnnouncements.length === 0
                }
                onPress={() =>
                  Alert.alert(
                    '確認批次取消置頂',
                    `將目前已載入且篩選出的 ${sortedAnnouncements.length} 則公告改為非置頂，確定繼續？`,
                    [
                      { text: '取消', style: 'cancel' },
                      { text: '確認', onPress: () => batchSetPinForFilteredAnnouncements(false) },
                    ],
                  )
                }
              />
              <Button
                text={batchDeletingAnnouncements ? '刪除中...' : '刪除目前篩選結果'}
                kind="danger"
                disabled={batchDeletingAnnouncements || sortedAnnouncements.length === 0}
                onPress={() =>
                  Alert.alert(
                    '確認批次刪除',
                    `將刪除目前已載入且篩選出的 ${sortedAnnouncements.length} 則公告，確定繼續？`,
                    [
                      { text: '取消', style: 'cancel' },
                      {
                        text: '刪除',
                        style: 'destructive',
                        onPress: batchDeleteFilteredAnnouncements,
                      },
                    ],
                  )
                }
              />
              <Button
                text={exportingAnnouncements ? '匯出中...' : '匯出目前已載入／篩選 CSV'}
                disabled={exportingAnnouncements || sortedAnnouncements.length === 0}
                onPress={exportAnnouncementsCsv}
              />
            </View>
            {annLoading ? (
              <LoadingState title="公告" subtitle="載入中..." rows={3} />
            ) : annError && announcements.length === 0 ? (
              <AdminListFeedback
                loading={false}
                error={annError}
                empty={false}
                emptyText=""
                onRetry={() => void reloadAnn()}
              />
            ) : (
              <View style={{ gap: 10 }}>
                {annError ? (
                  <Text style={adminStyles.inlineError}>
                    載入失敗，請重試。已載入的內容仍會保留。
                  </Text>
                ) : null}
                {sortedAnnouncements.map((ann) => (
                  <View key={ann.id} style={adminStyles.listItem}>
                    <View style={adminStyles.chipWrap}>
                      {ann.pinned ? <Pill text="置頂" kind="accent" /> : null}
                      {ann.source ? <Pill text={ann.source} /> : null}
                    </View>
                    <Text style={adminStyles.listItemTitle}>{ann.title}</Text>
                    {ann.body ? <Text style={adminStyles.listItemMeta}>{ann.body}</Text> : null}
                    <Text style={adminStyles.listItemMeta}>{formatDateTime(ann.publishedAt)}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      <Button text="編輯" onPress={() => openAnnouncementModal(ann)} />
                      <Button text="刪除" onPress={() => deleteAnnouncement(ann)} />
                    </View>
                  </View>
                ))}
                {announcements.length === 0 ? (
                  <Text style={adminStyles.mutedNote}>尚無公告</Text>
                ) : null}
                {announcements.length > 0 && filteredAnnouncements.length === 0 ? (
                  <Text style={adminStyles.mutedNote}>找不到符合搜尋條件的公告</Text>
                ) : null}
                {moreAnnouncements ? (
                  <Button
                    text={annBusy ? '載入中...' : annError ? '重試載入更多公告' : '載入更多公告'}
                    disabled={annBusy}
                    onPress={() => void loadMoreAnnouncements()}
                  />
                ) : null}
              </View>
            )}
          </AdminSurface>
        )}

        {activeTab === 'events' && (
          <AdminSurface
            title="活動管理"
            description={`已載入 ${events.length} 個活動；搜尋、排序與匯出僅涵蓋已載入項目。`}
          >
            <TextInput
              value={eventKeyword}
              onChangeText={setEventKeyword}
              placeholder="搜尋已載入的活動名稱、描述、地點"
              placeholderTextColor={theme.colors.muted}
              style={adminStyles.searchField}
            />
            <SegmentedControl
              options={[
                { key: 'latest', label: '最新' },
                { key: 'oldest', label: '最舊' },
              ]}
              selected={eventSort}
              onChange={setEventSort}
            />
            <View style={adminStyles.actionStack}>
              <Button text="建立新活動" kind="primary" onPress={() => openEventModal()} />
            </View>
            <View style={adminStyles.secondaryActions}>
              <Button
                text={batchDeletingEvents ? '刪除中...' : '刪除目前篩選結果'}
                kind="danger"
                disabled={batchDeletingEvents || sortedEvents.length === 0}
                onPress={() =>
                  Alert.alert(
                    '確認批次刪除',
                    `將刪除目前已載入且篩選出的 ${sortedEvents.length} 個活動，確定繼續？`,
                    [
                      { text: '取消', style: 'cancel' },
                      { text: '刪除', style: 'destructive', onPress: batchDeleteFilteredEvents },
                    ],
                  )
                }
              />
              <Button
                text={exportingEvents ? '匯出中...' : '匯出目前已載入／篩選 CSV'}
                disabled={exportingEvents || sortedEvents.length === 0}
                onPress={exportEventsCsv}
              />
            </View>
            {evtLoading ? (
              <LoadingState title="活動" subtitle="載入中..." rows={3} />
            ) : (
              <View style={{ gap: 10 }}>
                {sortedEvents.map((evt) => (
                  <View key={evt.id} style={adminStyles.listItem}>
                    <Text style={adminStyles.listItemTitle}>{evt.title}</Text>
                    {evt.location ? (
                      <Text style={adminStyles.listItemMeta}>{evt.location}</Text>
                    ) : null}
                    <Text style={adminStyles.listItemMeta}>
                      {formatDateTime(evt.startsAt) || '時間尚未公布'}
                    </Text>
                    {evt.capacity ? (
                      <Text style={adminStyles.listItemMeta}>
                        👥 {eventRegistrationCount(evt) ?? '待確認'} / {evt.capacity} 人
                      </Text>
                    ) : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                      <Button text="編輯" onPress={() => openEventModal(evt)} />
                      <Button text="刪除" onPress={() => deleteEvent(evt)} />
                    </View>
                  </View>
                ))}
                {events.length === 0 ? <Text style={adminStyles.mutedNote}>尚無活動</Text> : null}
                {events.length > 0 && filteredEvents.length === 0 ? (
                  <Text style={adminStyles.mutedNote}>找不到符合搜尋條件的活動</Text>
                ) : null}
              </View>
            )}
            {evtError ? (
              <Text style={adminStyles.inlineError}>無法更新活動，已載入的內容仍保留。</Text>
            ) : null}
            {moreEvents ? (
              <Button
                text={evtBusy ? '載入中...' : '載入更多活動'}
                disabled={evtBusy}
                onPress={() => void loadMoreEvents()}
              />
            ) : null}
            <Button
              text={evtBusy ? '更新中...' : '更新活動列表'}
              disabled={evtBusy}
              onPress={() => void reloadEvt()}
            />
          </AdminSurface>
        )}

        {activeTab === 'members' && auth.isAdmin && (
          <AdminSurface
            title="成員管理"
            description={`${formatDataStatus({
              loading: memLoading,
              refreshing: memRefreshing,
              error: memError,
              count: members.length,
              hasMore: moreMembers,
            })}。搜尋目前已載入的成員；變更角色僅管理員可執行。`}
          >
            <TextInput
              value={memberKeyword}
              onChangeText={setMemberKeyword}
              placeholder="搜尋目前已載入的姓名、系所、UID 或角色"
              placeholderTextColor={theme.colors.muted}
              style={adminStyles.searchField}
            />
            {!memLoading && !(memError && members.length === 0) ? (
              <View style={adminStyles.chipWrap}>
                <Pill text={`管理員 ${loadedCounts.admins}`} kind="accent" />
                <Pill text={`編輯者 ${loadedCounts.editors}`} />
                <Pill text={`一般 ${loadedCounts.regular}`} />
              </View>
            ) : null}
            {roleUpdateError ? (
              <View style={{ gap: 8 }}>
                <Text style={adminStyles.inlineError}>角色更新失敗：{roleUpdateError}</Text>
                <Button
                  text="清除錯誤提示"
                  kind="outline"
                  onPress={() => setRoleUpdateError(null)}
                />
              </View>
            ) : null}
            {memLoading ? (
              <LoadingState title="成員" subtitle="載入中..." rows={3} />
            ) : memError && members.length === 0 ? (
              <AdminListFeedback
                loading={false}
                error={memError}
                empty={false}
                emptyText=""
                onRetry={() => void reloadMem()}
              />
            ) : (
              <View style={{ gap: 10 }}>
                {memError ? (
                  <Text style={adminStyles.inlineError}>
                    載入失敗，請重試。已載入的內容仍會保留。
                  </Text>
                ) : null}
                {filteredMembers.map((member) => {
                  const updating = pendingRoleUpdateId === member.id;
                  return (
                    <View key={member.id} style={adminStyles.listItem}>
                      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                        <View
                          style={{
                            width: 36,
                            height: 36,
                            borderRadius: 18,
                            backgroundColor: theme.colors.accentSoft,
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <Text style={{ color: theme.colors.accent, fontWeight: '700' }}>
                            {(member.displayName?.[0] || member.id?.[0] || '?').toUpperCase()}
                          </Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={adminStyles.listItemTitle}>
                            {member.displayName || '(未設定名稱)'}
                          </Text>
                          <Text style={adminStyles.listItemMeta}>
                            {member.department || `${member.id.slice(0, 8)}...`}
                          </Text>
                        </View>
                        <Pill
                          text={memberRoleLabel(member.role)}
                          kind={member.role === 'admin' ? 'accent' : 'default'}
                        />
                      </View>
                      {updating ? <Text style={adminStyles.mutedNote}>角色更新中…</Text> : null}
                      {auth.isAdmin && member.id !== auth.user?.uid ? (
                        <View
                          style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}
                        >
                          {member.role !== 'admin' ? (
                            <Button
                              text="設為管理員"
                              disabled={Boolean(pendingRoleUpdateId)}
                              onPress={() => requestMemberRoleChange(member, 'admin')}
                            />
                          ) : null}
                          {member.role !== 'editor' ? (
                            <Button
                              text="設為編輯者"
                              disabled={Boolean(pendingRoleUpdateId)}
                              onPress={() => requestMemberRoleChange(member, 'editor')}
                            />
                          ) : null}
                          {member.role !== 'member' ? (
                            <Button
                              text="設為一般成員"
                              disabled={Boolean(pendingRoleUpdateId)}
                              onPress={() => requestMemberRoleChange(member, 'member')}
                            />
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
                {!auth.isAdmin ? (
                  <Text style={adminStyles.mutedNote}>編輯者僅可檢視成員，無法變更角色。</Text>
                ) : null}
                {members.length === 0 ? <Text style={adminStyles.mutedNote}>尚無成員</Text> : null}
                {members.length > 0 && filteredMembers.length === 0 ? (
                  <Text style={adminStyles.mutedNote}>找不到符合搜尋條件的成員</Text>
                ) : null}
                {moreMembers ? (
                  <Button
                    text={memBusy ? '載入中...' : memError ? '重試載入更多成員' : '載入更多成員'}
                    disabled={memBusy}
                    onPress={() => void loadMoreMembers()}
                  />
                ) : null}
              </View>
            )}
          </AdminSurface>
        )}

        {activeTab === 'settings' && auth.isAdmin && (
          <AdminSurface title="學校設定" description={`${school.name}（${school.code}）`}>
            <View style={{ gap: 12 }}>
              <View>
                <SectionTitle text="基本資訊" />
                <Text style={[adminStyles.mutedNote, { marginTop: 6 }]}>學校 ID：{school.id}</Text>
                <Text style={adminStyles.mutedNote}>代碼：{school.code}</Text>
                <Text style={adminStyles.mutedNote}>目前角色範圍：{roleLabel}</Text>
              </View>

              <View
                style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}
              >
                <SectionTitle text="管理操作" />
                <View style={{ marginTop: 10, gap: 10 }}>
                  {auth.isAdmin ? (
                    <Button
                      text="課程認證管理"
                      onPress={() => nav?.navigate?.('AdminCourseVerify')}
                    />
                  ) : (
                    <Text style={adminStyles.mutedNote}>課程認證僅管理員可開啟。</Text>
                  )}
                  <Button
                    text={listsRefreshing || reloadingAll ? '更新中…' : '重新載入所有資料'}
                    disabled={listsRefreshing || reloadingAll}
                    onPress={() => {
                      void reloadAllWorkbenchData();
                    }}
                  />
                  {(listsRefreshing || reloadingAll) && (
                    <Text style={adminStyles.mutedNote}>
                      正在更新各列表；成功或失敗會顯示在對應區段，不會預先宣告完成。
                    </Text>
                  )}
                </View>
              </View>

              <View
                style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <SectionTitle text="餐廳接單開通" />
                  <Button text="新增餐廳" size="small" onPress={() => openCafeteriaModal()} />
                </View>
                <Text style={[adminStyles.mutedNote, { marginTop: 6 }]}>
                  {formatDataStatus({
                    loading: cafeteriaLoading,
                    refreshing: cafeteriaRefreshing,
                    error: cafeteriaDisplayError,
                    count: cafeterias.length,
                  })}
                </Text>
                <View style={{ marginTop: 10, gap: 10 }}>
                  {cafeteriaLoading ? (
                    <Text style={adminStyles.mutedNote}>載入餐廳設定中…</Text>
                  ) : (
                    <>
                      {cafeteriaDisplayError && cafeterias.length === 0 ? (
                        <AdminListFeedback
                          loading={false}
                          error={cafeteriaDisplayError}
                          empty={false}
                          emptyText=""
                          onRetry={reloadCafeterias}
                        />
                      ) : null}
                      {cafeteriaDisplayError && cafeterias.length > 0 ? (
                        <View style={{ gap: 8 }}>
                          <Text style={adminStyles.inlineError}>
                            載入失敗，請重試。已載入的內容仍會保留。
                          </Text>
                          <Button
                            text="重試"
                            kind="outline"
                            onPress={() => void refreshCafeterias()}
                          />
                        </View>
                      ) : null}
                      {!cafeteriaDisplayError && cafeterias.length === 0 ? (
                        <Text style={adminStyles.mutedNote}>尚無餐廳資料</Text>
                      ) : null}
                      {cafeterias.map((cafeteria) => (
                        <View key={cafeteria.id} style={adminStyles.listItem}>
                          <View
                            style={{
                              flexDirection: 'row',
                              justifyContent: 'space-between',
                              gap: 12,
                            }}
                          >
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={adminStyles.listItemTitle}>{cafeteria.name}</Text>
                              <Text style={adminStyles.listItemMeta}>
                                {cafeteria.location || '未設定位置'} · {cafeteria.id}
                              </Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 6 }}>
                              <Pill
                                text={
                                  cafeteria.pilotStatus === 'live'
                                    ? '正式開通'
                                    : cafeteria.pilotStatus === 'pilot'
                                      ? '試營運'
                                      : '未開通'
                                }
                                kind={
                                  cafeteria.pilotStatus === 'live'
                                    ? 'success'
                                    : cafeteria.pilotStatus === 'pilot'
                                      ? 'warning'
                                      : 'default'
                                }
                              />
                              <Pill
                                text={cafeteria.orderingEnabled ? '可接單' : '已關閉接單'}
                                kind={cafeteria.orderingEnabled ? 'accent' : 'default'}
                              />
                            </View>
                          </View>
                          <View style={adminStyles.chipWrap}>
                            <Pill text={`店員 ${cafeteria.activeOperatorCount}`} kind="muted" />
                            {cafeteria.brandKey ? (
                              <Pill text={`品牌 ${cafeteria.brandKey}`} kind="muted" />
                            ) : null}
                          </View>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                            <Button
                              text="編輯設定"
                              size="small"
                              onPress={() => openCafeteriaModal(cafeteria)}
                            />
                            <Button
                              text="管理店員"
                              size="small"
                              kind="outline"
                              onPress={() => openOperatorModal(cafeteria)}
                            />
                          </View>
                        </View>
                      ))}
                    </>
                  )}
                </View>
              </View>

              <View
                style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}
              >
                <SectionTitle text="最近管理操作" />
                <Text style={[adminStyles.mutedNote, { marginTop: 6 }]}>
                  {formatDataStatus({
                    loading: logsLoading,
                    refreshing: logsRefreshing,
                    error: logsError,
                    count: adminLogs.length,
                    hasMore: moreLogs,
                  })}
                  。搜尋與匯出目前已載入的資料。
                </Text>
                <View style={{ marginTop: 10, gap: 8 }}>
                  <TextInput
                    value={logKeyword}
                    onChangeText={setLogKeyword}
                    placeholder="搜尋目前已載入的操作、細節、操作者"
                    placeholderTextColor={theme.colors.muted}
                    style={adminStyles.searchField}
                  />
                  <SegmentedControl
                    options={[
                      { key: 'all', label: '全部' },
                      { key: 'write', label: '新增/修改' },
                      { key: 'delete', label: '刪除' },
                      { key: 'batch', label: '批次' },
                      { key: 'export', label: '匯出' },
                    ]}
                    selected={logFilter}
                    onChange={setLogFilter}
                  />
                  <Button
                    text={exportingLogs ? '匯出中...' : '匯出目前已載入／篩選 CSV'}
                    disabled={exportingLogs || filteredAdminLogs.length === 0}
                    onPress={exportAdminLogsCsv}
                  />
                </View>
                {logsLoading ? (
                  <Text style={[adminStyles.mutedNote, { marginTop: 8 }]}>載入中…</Text>
                ) : logsError && adminLogs.length === 0 ? (
                  <View style={{ marginTop: 8 }}>
                    <AdminListFeedback
                      loading={false}
                      error={logsError}
                      empty={false}
                      emptyText=""
                      onRetry={() => void reloadLogs()}
                    />
                  </View>
                ) : adminLogs.length === 0 ? (
                  <Text style={[adminStyles.mutedNote, { marginTop: 8 }]}>尚無操作紀錄</Text>
                ) : (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {logsError ? (
                      <Text style={adminStyles.inlineError}>
                        載入失敗，請重試。已載入的內容仍會保留。
                      </Text>
                    ) : null}
                    {filteredAdminLogs.map((log) => (
                      <View key={log.id} style={adminStyles.listItem}>
                        <Text style={adminStyles.listItemTitle}>{log.action}</Text>
                        {log.details ? (
                          <Text style={adminStyles.listItemMeta}>{log.details}</Text>
                        ) : null}
                        <Text style={adminStyles.listItemMeta}>
                          {log.actorEmail || log.actorUid || '未知操作者'} ·{' '}
                          {formatDateTime(log.createdAt)}
                        </Text>
                      </View>
                    ))}
                    {adminLogs.length > 0 && filteredAdminLogs.length === 0 ? (
                      <Text style={adminStyles.mutedNote}>找不到符合篩選條件的操作紀錄</Text>
                    ) : null}
                    {moreLogs ? (
                      <Button
                        text={
                          logsBusy
                            ? '載入中...'
                            : logsError
                              ? '重試載入更多紀錄'
                              : '載入更多操作紀錄'
                        }
                        disabled={logsBusy}
                        onPress={() => void loadMoreLogs()}
                      />
                    ) : null}
                  </View>
                )}
              </View>
            </View>
          </AdminSurface>
        )}
      </ScrollView>

      <Modal
        visible={showAnnouncementModal && isCurrentForm('announcement', announcementFormContext)}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeAnnouncementModal}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={closeAnnouncementModal}>
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
              {editingAnnouncement ? '編輯公告' : '發布公告'}
            </Text>
            <Pressable onPress={saveAnnouncement} disabled={saving}>
              <Text
                style={{
                  color: saving ? theme.colors.muted : theme.colors.accent,
                  fontWeight: '600',
                }}
              >
                {saving ? '儲存中...' : '儲存'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          >
            <FormInput
              label="標題 *"
              value={annTitle}
              onChangeText={setAnnTitle}
              placeholder="輸入公告標題"
            />
            <FormInput
              label="內容"
              value={annBody}
              onChangeText={setAnnBody}
              placeholder="輸入公告內容"
              multiline
            />
            <FormInput
              label="來源"
              value={annSource}
              onChangeText={setAnnSource}
              placeholder="例如：教務處、學務處"
            />
            <Pressable
              onPress={() => setAnnPinned(!annPinned)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 12,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: annPinned ? theme.colors.accent : theme.colors.border,
                  backgroundColor: annPinned ? theme.colors.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {annPinned && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
              <Text style={{ color: theme.colors.text, fontWeight: '600' }}>置頂公告</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={
          showEventModal &&
          eventFormScope === eventScope &&
          isCurrentForm('event', eventFormContext)
        }
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeEventModal}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={closeEventModal}>
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
              {editingEvent ? '編輯活動' : '建立活動'}
            </Text>
            <Pressable onPress={saveEvent} disabled={saving}>
              <Text
                style={{
                  color: saving ? theme.colors.muted : theme.colors.accent,
                  fontWeight: '600',
                }}
              >
                {saving ? '儲存中...' : '儲存'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            pointerEvents={saving ? 'none' : 'auto'}
            contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          >
            <FormInput
              label="活動名稱 *"
              value={evtTitle}
              onChangeText={setEvtTitle}
              placeholder="輸入活動名稱"
            />
            <FormInput
              label="活動描述"
              value={evtDescription}
              onChangeText={setEvtDescription}
              placeholder="輸入活動描述"
              multiline
            />
            <FormInput
              label="地點"
              value={evtLocation}
              onChangeText={setEvtLocation}
              placeholder="輸入活動地點"
            />
            <FormInput
              label="人數上限"
              value={evtCapacity}
              onChangeText={setEvtCapacity}
              placeholder="留空表示不限"
            />
            <FormInput
              label="開始時間"
              value={evtStartsAt}
              onChangeText={setEvtStartsAt}
              placeholder="YYYY-MM-DD HH:mm"
            />
            <FormInput
              label="結束時間"
              value={evtEndsAt}
              onChangeText={setEvtEndsAt}
              placeholder="YYYY-MM-DD HH:mm"
            />
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 8 }}>
              未填開始時間時，活動會顯示「時間尚未公布」。
            </Text>
            <EventRegistrationPolicyFields
              value={evtRegistrationPolicy}
              onChange={setEvtRegistrationPolicy}
            />
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={
          showCafeteriaModal && auth.isAdmin && isCurrentForm('cafeteria', cafeteriaFormContext)
        }
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeCafeteriaModal}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={closeCafeteriaModal}>
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
              {editingCafeteria ? '編輯餐廳' : '新增餐廳'}
            </Text>
            <Pressable onPress={saveCafeteria} disabled={savingCafeteria}>
              <Text
                style={{
                  color: savingCafeteria ? theme.colors.muted : theme.colors.accent,
                  fontWeight: '600',
                }}
              >
                {savingCafeteria ? '儲存中...' : '儲存'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          >
            <FormInput
              label="餐廳名稱 *"
              value={cafeteriaName}
              onChangeText={setCafeteriaName}
              placeholder="輸入餐廳名稱"
            />
            <FormInput
              label="位置"
              value={cafeteriaLocation}
              onChangeText={setCafeteriaLocation}
              placeholder="例如：第一餐廳 1F"
            />
            <FormInput
              label="營業時間"
              value={cafeteriaOpeningHours}
              onChangeText={setCafeteriaOpeningHours}
              placeholder="例如：11:00-19:30"
            />
            <FormInput
              label="品牌代碼"
              value={cafeteriaBrandKey}
              onChangeText={setCafeteriaBrandKey}
              placeholder="留空表示單店管理"
            />
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: theme.colors.muted, marginBottom: 6, fontWeight: '600' }}>
                試用狀態
              </Text>
              <SegmentedControl
                options={[
                  { key: 'inactive', label: '未開通' },
                  { key: 'pilot', label: '試營運' },
                  { key: 'live', label: '正式' },
                ]}
                selected={cafeteriaPilotStatus}
                onChange={(value) =>
                  setCafeteriaPilotStatus(value as 'inactive' | 'pilot' | 'live')
                }
              />
            </View>
            <Pressable
              onPress={() => setCafeteriaOrderingEnabled((current) => !current)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingVertical: 12,
              }}
            >
              <View
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 6,
                  borderWidth: 2,
                  borderColor: cafeteriaOrderingEnabled ? theme.colors.accent : theme.colors.border,
                  backgroundColor: cafeteriaOrderingEnabled ? theme.colors.accent : 'transparent',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {cafeteriaOrderingEnabled && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: '600' }}>開啟接單</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  關閉後學生仍可看到店家，但無法送出訂單。
                </Text>
              </View>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={
          showOperatorModal && auth.isAdmin && isCurrentForm('operator', operatorFormContext)
        }
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeOperatorModal}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={closeOperatorModal}>
              <Text style={{ color: theme.colors.accent, fontWeight: '600' }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 16 }}>
              {selectedOperatorCafeteria ? `${selectedOperatorCafeteria.name} 店員` : '店員管理'}
            </Text>
            <Pressable onPress={saveOperatorAssignment} disabled={savingOperator}>
              <Text
                style={{
                  color: savingOperator ? theme.colors.muted : theme.colors.accent,
                  fontWeight: '600',
                }}
              >
                {savingOperator ? '儲存中...' : '儲存'}
              </Text>
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
          >
            <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 12 }}>
              請輸入 Firebase Auth UID 指派店員。只有 active 店員可處理該餐廳訂單。
            </Text>
            <FormInput
              label="店員 UID *"
              value={operatorUid}
              onChangeText={setOperatorUid}
              placeholder="輸入 Firebase Auth UID"
            />
            <FormInput
              label="顯示名稱"
              value={operatorDisplayName}
              onChangeText={setOperatorDisplayName}
              placeholder="例如：王小明"
            />
            <FormInput
              label="Email"
              value={operatorEmail}
              onChangeText={setOperatorEmail}
              placeholder="例如：merchant@example.com"
            />
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: theme.colors.muted, marginBottom: 6, fontWeight: '600' }}>
                身分
              </Text>
              <SegmentedControl
                options={[
                  { key: 'owner', label: '負責人' },
                  { key: 'manager', label: '主管' },
                  { key: 'staff', label: '店員' },
                ]}
                selected={operatorRole}
                onChange={(value) => setOperatorRole(value as 'owner' | 'manager' | 'staff')}
              />
            </View>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: theme.colors.muted, marginBottom: 6, fontWeight: '600' }}>
                狀態
              </Text>
              <SegmentedControl
                options={[
                  { key: 'active', label: '啟用' },
                  { key: 'inactive', label: '停用' },
                ]}
                selected={operatorStatus}
                onChange={(value) => setOperatorStatus(value as 'active' | 'inactive')}
              />
            </View>

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: theme.colors.border,
                paddingTop: 12,
                gap: 10,
              }}
            >
              <SectionTitle text="目前店員" />
              {operatorsError || operatorsLastRefreshError ? (
                <Text style={adminStyles.inlineError}>載入失敗，請重試。</Text>
              ) : null}
              {operatorsLoading ? (
                <Text style={{ color: theme.colors.muted }}>載入店員中...</Text>
              ) : cafeteriaOperators.length === 0 &&
                !(operatorsError || operatorsLastRefreshError) ? (
                <Text style={{ color: theme.colors.muted }}>此餐廳尚未指派店員</Text>
              ) : (
                cafeteriaOperators.map((operator) => (
                  <View
                    key={operator.id}
                    style={{
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                      padding: 12,
                      gap: 8,
                    }}
                  >
                    <View
                      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: '700' }}>
                          {operator.displayName || operator.email || operator.id}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {operator.email || '未設定 email'} · {operator.id}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 6 }}>
                        <Pill
                          text={operator.status === 'active' ? '啟用中' : '已停用'}
                          kind={operator.status === 'active' ? 'success' : 'default'}
                        />
                        <Pill
                          text={
                            operator.role === 'owner'
                              ? '負責人'
                              : operator.role === 'manager'
                                ? '主管'
                                : '店員'
                          }
                          kind="muted"
                        />
                      </View>
                    </View>
                    <Button
                      text="編輯店員"
                      size="small"
                      kind="outline"
                      onPress={() => {
                        if (selectedOperatorCafeteria) {
                          openOperatorModal(selectedOperatorCafeteria, operator);
                        }
                      }}
                    />
                  </View>
                ))
              )}
            </View>
          </ScrollView>
        </View>
      </Modal>
    </Screen>
  );
}
