/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useState } from "react";
import { ScrollView, Text, View, Pressable, TextInput, Alert, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { isAvailableAsync, shareAsync } from "expo-sharing";
import { Paths, File } from "expo-file-system";
import {
  collection,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";

import {
  Screen,
  Card,
  Button,
  Pill,
  LoadingState,
  SectionTitle,
  AnimatedCard,
  StatCard,
  SegmentedControl,
} from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import { useAsyncList } from "../hooks/useAsyncList";
import { useAmbientCues } from "../features/engagement";
import { AmbientCueCard } from "../ui/campusOs";
import {
  bulkDeleteSchoolEvents,
  bulkUpdateSchoolAnnouncements,
  clearSchoolAdminTestData as clearSchoolAdminTestDataCall,
  deleteSchoolAnnouncement,
  deleteSchoolEvent,
  upsertCafeteriaOperatorAssignment,
  upsertSchoolCafeteriaConfig,
  updateSchoolMemberRole as updateSchoolMemberRoleCall,
  upsertSchoolAnnouncement,
  upsertSchoolEvent,
} from "../services/admin";
import { fetchSchoolDirectoryProfiles } from "../services/memberDirectory";
import { formatDateTime } from "../utils/format";

type AdminTab = "overview" | "announcements" | "events" | "members" | "settings";
type SortMode = "latest" | "oldest" | "pinned";
type LogFilterMode = "all" | "write" | "delete" | "batch" | "export";

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
};

type SchoolMember = {
  id: string;
  role: "admin" | "editor" | "member";
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
  pilotStatus: "inactive" | "pilot" | "live";
  orderingEnabled: boolean;
  activeOperatorCount: number;
  updatedAt?: any;
};

type CafeteriaOperator = {
  id: string;
  status: "active" | "inactive";
  role: "owner" | "manager" | "staff";
  displayName?: string | null;
  email?: string | null;
  updatedAt?: any;
};

function toDateFromUnknown(value: any): Date | null {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (typeof value?.seconds === "number") return new Date(value.seconds * 1000);
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateTimeInput(value: any): string {
  const dt = toDateFromUnknown(value);
  if (!dt) return "";
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
  const raw = value == null ? "" : String(value);
  const escaped = raw.replace(/"/g, '""');
  return `"${escaped}"`;
}

function buildCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const headerLine = headers.map(escapeCsvValue).join(",");
  const bodyLines = rows.map((row) => row.map(escapeCsvValue).join(","));
  return [headerLine, ...bodyLines].join("\n");
}

function TabButton(props: { icon: string; label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        flex: 1,
        paddingVertical: 10,
        paddingHorizontal: 8,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: props.active ? theme.colors.accent : theme.colors.border,
        backgroundColor: props.active ? theme.colors.accentSoft : theme.colors.surface2,
        alignItems: "center",
        gap: 4,
      }}
    >
      <Ionicons
        name={props.icon as any}
        size={18}
        color={props.active ? theme.colors.accent : theme.colors.muted}
      />
      <Text
        style={{
          color: props.active ? theme.colors.accent : theme.colors.muted,
          fontWeight: "700",
          fontSize: 11,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

function FormInput(props: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={{ color: theme.colors.muted, marginBottom: 6, fontWeight: "600" }}>
        {props.label}
      </Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={theme.colors.muted}
        multiline={props.multiline}
        style={{
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: theme.radius.md,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface2,
          color: theme.colors.text,
          minHeight: props.multiline ? 100 : undefined,
          textAlignVertical: props.multiline ? "top" : "center",
        }}
      />
    </View>
  );
}

export function AdminDashboardScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();
  const db = getDb();
  const { cue: ambientCue, dismissCue: dismissAmbientCue, openCue: openAmbientCue } = useAmbientCues({
    schoolId: school.id,
    uid: auth.user?.uid ?? null,
    role: "admin",
    surface: "admin",
    limit: 1,
  });

  const [tab, setTab] = useState<AdminTab>("overview");
  const [showAnnouncementModal, setShowAnnouncementModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showCafeteriaModal, setShowCafeteriaModal] = useState(false);
  const [showOperatorModal, setShowOperatorModal] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [editingEvent, setEditingEvent] = useState<ClubEvent | null>(null);
  const [editingCafeteria, setEditingCafeteria] = useState<SchoolCafeteria | null>(null);
  const [selectedOperatorCafeteria, setSelectedOperatorCafeteria] = useState<SchoolCafeteria | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingCafeteria, setSavingCafeteria] = useState(false);
  const [savingOperator, setSavingOperator] = useState(false);
  const [cleaningData, setCleaningData] = useState(false);
  const [memberKeyword, setMemberKeyword] = useState("");
  const [announcementKeyword, setAnnouncementKeyword] = useState("");
  const [eventKeyword, setEventKeyword] = useState("");
  const [announcementSort, setAnnouncementSort] = useState<SortMode>("latest");
  const [eventSort, setEventSort] = useState<Exclude<SortMode, "pinned">>("latest");
  const [batchDeletingAnnouncements, setBatchDeletingAnnouncements] = useState(false);
  const [batchDeletingEvents, setBatchDeletingEvents] = useState(false);
  const [batchPinningAnnouncements, setBatchPinningAnnouncements] = useState(false);
  const [batchUnpinningAnnouncements, setBatchUnpinningAnnouncements] = useState(false);
  const [exportingAnnouncements, setExportingAnnouncements] = useState(false);
  const [exportingEvents, setExportingEvents] = useState(false);
  const [logKeyword, setLogKeyword] = useState("");
  const [logFilter, setLogFilter] = useState<LogFilterMode>("all");
  const [exportingLogs, setExportingLogs] = useState(false);

  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annSource, setAnnSource] = useState("");
  const [annPinned, setAnnPinned] = useState(false);

  const [evtTitle, setEvtTitle] = useState("");
  const [evtDescription, setEvtDescription] = useState("");
  const [evtLocation, setEvtLocation] = useState("");
  const [evtCapacity, setEvtCapacity] = useState("");
  const [evtStartsAt, setEvtStartsAt] = useState("");
  const [evtEndsAt, setEvtEndsAt] = useState("");
  const [cafeteriaName, setCafeteriaName] = useState("");
  const [cafeteriaLocation, setCafeteriaLocation] = useState("");
  const [cafeteriaOpeningHours, setCafeteriaOpeningHours] = useState("");
  const [cafeteriaBrandKey, setCafeteriaBrandKey] = useState("");
  const [cafeteriaPilotStatus, setCafeteriaPilotStatus] = useState<"inactive" | "pilot" | "live">("inactive");
  const [cafeteriaOrderingEnabled, setCafeteriaOrderingEnabled] = useState(false);
  const [operatorUid, setOperatorUid] = useState("");
  const [operatorDisplayName, setOperatorDisplayName] = useState("");
  const [operatorEmail, setOperatorEmail] = useState("");
  const [operatorRole, setOperatorRole] = useState<"owner" | "manager" | "staff">("staff");
  const [operatorStatus, setOperatorStatus] = useState<"active" | "inactive">("active");

  const {
    items: announcements,
    loading: annLoading,
    reload: reloadAnn,
  } = useAsyncList<Announcement>(
    async () => {
      const qy = query(
        collection(db, "schools", school.id, "announcements"),
        orderBy("publishedAt", "desc"),
        limit(50)
      );
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    },
    [db, school.id]
  );

  const {
    items: events,
    loading: evtLoading,
    reload: reloadEvt,
  } = useAsyncList<ClubEvent>(
    async () => {
      const qy = query(
        collection(db, "schools", school.id, "clubEvents"),
        orderBy("startsAt", "desc"),
        limit(50)
      );
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    },
    [db, school.id]
  );

  const {
    items: members,
    loading: memLoading,
    reload: reloadMem,
  } = useAsyncList<SchoolMember>(
    async () => {
      const qy = query(collection(db, "schools", school.id, "members"), limit(100));
      const snap = await getDocs(qy);
      const directoryProfiles = await fetchSchoolDirectoryProfiles(
        school.id,
        snap.docs.map((docSnap) => docSnap.id),
        db,
      );
      const profilesById = Object.fromEntries(
        directoryProfiles.map((profile) => [profile.uid, profile]),
      );

      return snap.docs.map((d) => {
        const data = d.data() as any;
        const profile = profilesById[d.id];
        return {
          id: d.id,
          role: data.role ?? "member",
          displayName: profile?.displayName ?? d.id.slice(0, 8),
          department: profile?.department ?? null,
          avatarUrl: profile?.avatarUrl ?? null,
          joinedAt: data.joinedAt,
        } satisfies SchoolMember;
      });
    },
    [db, school.id]
  );

  const {
    items: adminLogs,
    loading: logsLoading,
    reload: reloadLogs,
  } = useAsyncList<AdminLog>(
    async () => {
      const qy = query(
        collection(db, "schools", school.id, "adminLogs"),
        orderBy("createdAt", "desc"),
        limit(20)
      );
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    },
    [db, school.id]
  );

  const {
    items: cafeterias,
    loading: cafeteriaLoading,
    reload: reloadCafeterias,
  } = useAsyncList<SchoolCafeteria>(
    async () => {
      const qy = query(
        collection(db, "schools", school.id, "cafeterias"),
        orderBy("name", "asc"),
        limit(100)
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
            data.pilotStatus === "pilot" || data.pilotStatus === "live"
              ? data.pilotStatus
              : "inactive",
          orderingEnabled: data.orderingEnabled === true,
          activeOperatorCount: typeof data.activeOperatorCount === "number" ? data.activeOperatorCount : 0,
          updatedAt: data.updatedAt,
        } satisfies SchoolCafeteria;
      });
    },
    [db, school.id]
  );

  const {
    items: cafeteriaOperators,
    loading: operatorsLoading,
    reload: reloadOperators,
  } = useAsyncList<CafeteriaOperator>(
    async () => {
      if (!selectedOperatorCafeteria) {
        return [];
      }

      const snap = await getDocs(
        query(
          collection(
            db,
            "schools",
            school.id,
            "cafeterias",
            selectedOperatorCafeteria.id,
            "operators"
          ),
          limit(100)
        )
      );

      return snap.docs
        .map((docSnap) => {
          const data = docSnap.data() as any;
          return {
            id: docSnap.id,
            status: data.status === "inactive" ? "inactive" : "active",
            role: data.role === "owner" || data.role === "manager" ? data.role : "staff",
            displayName: data.displayName ?? null,
            email: data.email ?? null,
            updatedAt: data.updatedAt,
          } satisfies CafeteriaOperator;
        })
        .sort((a, b) => a.id.localeCompare(b.id, "zh-TW"));
    },
    [db, school.id, selectedOperatorCafeteria?.id]
  );

  const stats = useMemo(() => {
    return {
      announcements: announcements.length,
      events: events.length,
      members: members.length,
      admins: members.filter((m) => m.role === "admin").length,
    };
  }, [announcements, events, members]);

  const filteredMembers = useMemo(() => {
    const kw = memberKeyword.trim().toLowerCase();
    if (!kw) return members;
    return members.filter((member) => {
      const fields = [
        member.displayName ?? "",
        member.department ?? "",
        member.id,
        member.role,
      ];
      return fields.some((f) => f.toLowerCase().includes(kw));
    });
  }, [members, memberKeyword]);

  const filteredAnnouncements = useMemo(() => {
    const kw = announcementKeyword.trim().toLowerCase();
    if (!kw) return announcements;
    return announcements.filter((ann) => {
      const fields = [ann.title, ann.body, ann.source ?? ""];
      return fields.some((f) => f.toLowerCase().includes(kw));
    });
  }, [announcements, announcementKeyword]);

  const filteredEvents = useMemo(() => {
    const kw = eventKeyword.trim().toLowerCase();
    if (!kw) return events;
    return events.filter((evt) => {
      const fields = [evt.title, evt.description ?? "", evt.location ?? ""];
      return fields.some((f) => f.toLowerCase().includes(kw));
    });
  }, [events, eventKeyword]);

  const sortedAnnouncements = useMemo(() => {
    const items = [...filteredAnnouncements];
    const getTime = (ann: Announcement) => toDateFromUnknown(ann.publishedAt)?.getTime() ?? 0;
    if (announcementSort === "oldest") {
      return items.sort((a, b) => getTime(a) - getTime(b));
    }
    if (announcementSort === "pinned") {
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
    if (eventSort === "oldest") {
      return items.sort((a, b) => getTime(a) - getTime(b));
    }
    return items.sort((a, b) => getTime(b) - getTime(a));
  }, [eventSort, filteredEvents]);

  const filteredAdminLogs = useMemo(() => {
    const kw = logKeyword.trim().toLowerCase();
    return adminLogs.filter((log) => {
      const action = (log.action ?? "").toLowerCase();
      const details = (log.details ?? "").toLowerCase();
      const actor = (log.actorEmail ?? log.actorUid ?? "").toLowerCase();

      const matchKeyword = !kw || action.includes(kw) || details.includes(kw) || actor.includes(kw);
      if (!matchKeyword) return false;

      if (logFilter === "all") return true;
      if (logFilter === "write") return action.includes("create_") || action.includes("update_");
      if (logFilter === "delete") return action.includes("delete_");
      if (logFilter === "batch") return action.includes("batch_");
      if (logFilter === "export") return action.includes("export_");
      return true;
    });
  }, [adminLogs, logFilter, logKeyword]);

  const openAnnouncementModal = (ann?: Announcement) => {
    if (ann) {
      setEditingAnnouncement(ann);
      setAnnTitle(ann.title);
      setAnnBody(ann.body);
      setAnnSource(ann.source ?? "");
      setAnnPinned(ann.pinned ?? false);
    } else {
      setEditingAnnouncement(null);
      setAnnTitle("");
      setAnnBody("");
      setAnnSource(school.name);
      setAnnPinned(false);
    }
    setShowAnnouncementModal(true);
  };

  const saveAnnouncement = async () => {
    if (!annTitle.trim()) {
      Alert.alert("錯誤", "請輸入標題");
      return;
    }
    setSaving(true);
    try {
      await upsertSchoolAnnouncement({
        schoolId: school.id,
        announcementId: editingAnnouncement?.id ?? null,
        title: annTitle.trim(),
        body: annBody.trim(),
        source: annSource.trim() || school.name,
        pinned: annPinned,
      });
      setShowAnnouncementModal(false);
      reloadAnn();
      reloadLogs();
      Alert.alert("成功", editingAnnouncement ? "公告已更新" : "公告已發布");
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const deleteAnnouncement = async (ann: Announcement) => {
    Alert.alert("確認刪除", `確定要刪除「${ann.title}」？`, [
      { text: "取消", style: "cancel" },
      {
        text: "刪除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSchoolAnnouncement({
              schoolId: school.id,
              announcementId: ann.id,
            });
            reloadAnn();
            reloadLogs();
          } catch (e: any) {
            Alert.alert("錯誤", e?.message ?? "刪除失敗");
          }
        },
      },
    ]);
  };

  const openEventModal = (evt?: ClubEvent) => {
    if (evt) {
      setEditingEvent(evt);
      setEvtTitle(evt.title);
      setEvtDescription(evt.description ?? "");
      setEvtLocation(evt.location ?? "");
      setEvtCapacity(evt.capacity?.toString() ?? "");
      setEvtStartsAt(formatDateTimeInput(evt.startsAt));
      setEvtEndsAt(formatDateTimeInput(evt.endsAt));
    } else {
      setEditingEvent(null);
      setEvtTitle("");
      setEvtDescription("");
      setEvtLocation("");
      setEvtCapacity("");
      setEvtStartsAt("");
      setEvtEndsAt("");
    }
    setShowEventModal(true);
  };

  const openCafeteriaModal = (cafeteria?: SchoolCafeteria) => {
    if (cafeteria) {
      setEditingCafeteria(cafeteria);
      setCafeteriaName(cafeteria.name);
      setCafeteriaLocation(cafeteria.location ?? "");
      setCafeteriaOpeningHours(cafeteria.openingHours ?? "");
      setCafeteriaBrandKey(cafeteria.brandKey ?? "");
      setCafeteriaPilotStatus(cafeteria.pilotStatus);
      setCafeteriaOrderingEnabled(cafeteria.orderingEnabled);
    } else {
      setEditingCafeteria(null);
      setCafeteriaName("");
      setCafeteriaLocation("");
      setCafeteriaOpeningHours("");
      setCafeteriaBrandKey("");
      setCafeteriaPilotStatus("inactive");
      setCafeteriaOrderingEnabled(false);
    }
    setShowCafeteriaModal(true);
  };

  const buildCafeteriaId = (name: string) => {
    const normalized = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return normalized || `cafeteria-${Date.now()}`;
  };

  const saveCafeteria = async () => {
    if (!cafeteriaName.trim()) {
      Alert.alert("錯誤", "請輸入餐廳名稱");
      return;
    }

    setSavingCafeteria(true);
    try {
      await upsertSchoolCafeteriaConfig({
        schoolId: school.id,
        cafeteriaId: editingCafeteria?.id ?? buildCafeteriaId(cafeteriaName),
        name: cafeteriaName.trim(),
        location: cafeteriaLocation.trim() || null,
        openingHours: cafeteriaOpeningHours.trim() || null,
        brandKey: cafeteriaBrandKey.trim() || null,
        pilotStatus: cafeteriaPilotStatus,
        orderingEnabled: cafeteriaOrderingEnabled,
      });
      setShowCafeteriaModal(false);
      reloadCafeterias();
      reloadLogs();
      Alert.alert("成功", editingCafeteria ? "餐廳設定已更新" : "餐廳已建立");
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "儲存餐廳設定失敗");
    } finally {
      setSavingCafeteria(false);
    }
  };

  const openOperatorModal = (cafeteria: SchoolCafeteria, operator?: CafeteriaOperator) => {
    setSelectedOperatorCafeteria(cafeteria);
    setOperatorUid(operator?.id ?? "");
    setOperatorDisplayName(operator?.displayName ?? "");
    setOperatorEmail(operator?.email ?? "");
    setOperatorRole(operator?.role ?? "staff");
    setOperatorStatus(operator?.status ?? "active");
    setShowOperatorModal(true);
  };

  const saveOperatorAssignment = async () => {
    if (!selectedOperatorCafeteria) {
      Alert.alert("錯誤", "請先選擇餐廳");
      return;
    }
    if (!operatorUid.trim()) {
      Alert.alert("錯誤", "請輸入店員 UID");
      return;
    }

    setSavingOperator(true);
    try {
      await upsertCafeteriaOperatorAssignment({
        schoolId: school.id,
        cafeteriaId: selectedOperatorCafeteria.id,
        targetUid: operatorUid.trim(),
        displayName: operatorDisplayName.trim() || null,
        email: operatorEmail.trim() || null,
        role: operatorRole,
        status: operatorStatus,
      });
      reloadOperators();
      reloadCafeterias();
      reloadLogs();
      Alert.alert("成功", "店員指派已更新");
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "店員指派失敗");
    } finally {
      setSavingOperator(false);
    }
  };

  const saveEvent = async () => {
    if (!evtTitle.trim()) {
      Alert.alert("錯誤", "請輸入活動名稱");
      return;
    }
    const normalizedCapacity = evtCapacity.trim();
    if (normalizedCapacity) {
      const n = Number(normalizedCapacity);
      if (!Number.isInteger(n) || n <= 0) {
        Alert.alert("錯誤", "人數上限需為正整數，或留空表示不限");
        return;
      }
    }
    const startDate = evtStartsAt.trim() ? parseDateTimeInput(evtStartsAt) : null;
    const endDate = evtEndsAt.trim() ? parseDateTimeInput(evtEndsAt) : null;
    if (evtStartsAt.trim() && !startDate) {
      Alert.alert("錯誤", "開始時間格式錯誤，請使用 YYYY-MM-DD HH:mm");
      return;
    }
    if (evtEndsAt.trim() && !endDate) {
      Alert.alert("錯誤", "結束時間格式錯誤，請使用 YYYY-MM-DD HH:mm");
      return;
    }
    if (startDate && endDate && endDate <= startDate) {
      Alert.alert("錯誤", "結束時間需晚於開始時間");
      return;
    }

    setSaving(true);
    try {
      await upsertSchoolEvent({
        schoolId: school.id,
        eventId: editingEvent?.id ?? null,
        title: evtTitle.trim(),
        description: evtDescription.trim(),
        location: evtLocation.trim(),
        capacity: normalizedCapacity ? Number(normalizedCapacity) : null,
        startsAt: startDate ? startDate.toISOString() : null,
        endsAt: endDate ? endDate.toISOString() : null,
      });
      setShowEventModal(false);
      reloadEvt();
      reloadLogs();
      Alert.alert("成功", editingEvent ? "活動已更新" : "活動已建立");
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "儲存失敗");
    } finally {
      setSaving(false);
    }
  };

  const deleteEvent = async (evt: ClubEvent) => {
    Alert.alert("確認刪除", `確定要刪除「${evt.title}」？`, [
      { text: "取消", style: "cancel" },
      {
        text: "刪除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSchoolEvent({
              schoolId: school.id,
              eventId: evt.id,
            });
            reloadEvt();
            reloadLogs();
          } catch (e: any) {
            Alert.alert("錯誤", e?.message ?? "刪除失敗");
          }
        },
      },
    ]);
  };

  const updateMemberRole = async (member: SchoolMember, newRole: "admin" | "editor" | "member") => {
    try {
      await updateSchoolMemberRoleCall({
        schoolId: school.id,
        targetUid: member.id,
        role: newRole,
      });
      reloadMem();
      reloadLogs();
      Alert.alert("成功", "權限已更新");
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "更新失敗");
    }
  };

  const clearTestingData = async () => {
    setCleaningData(true);
    try {
      const result = await clearSchoolAdminTestDataCall({ schoolId: school.id });
      reloadAnn();
      reloadEvt();
      reloadLogs();
      Alert.alert(
        "成功",
        `已清空測試資料（公告 ${result.deleted.announcements} 筆、活動 ${result.deleted.events} 筆）`
      );
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "清空資料失敗");
    } finally {
      setCleaningData(false);
    }
  };

  const batchDeleteFilteredAnnouncements = async () => {
    if (sortedAnnouncements.length === 0) {
      Alert.alert("提示", "目前沒有可刪除的公告。");
      return;
    }
    setBatchDeletingAnnouncements(true);
    try {
      await bulkUpdateSchoolAnnouncements({
        schoolId: school.id,
        announcementIds: sortedAnnouncements.map((ann) => ann.id),
        action: "delete",
      });
      reloadAnn();
      reloadLogs();
      Alert.alert("成功", `已刪除 ${sortedAnnouncements.length} 則公告`);
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "批次刪除公告失敗");
    } finally {
      setBatchDeletingAnnouncements(false);
    }
  };

  const batchDeleteFilteredEvents = async () => {
    if (sortedEvents.length === 0) {
      Alert.alert("提示", "目前沒有可刪除的活動。");
      return;
    }
    setBatchDeletingEvents(true);
    try {
      await bulkDeleteSchoolEvents({
        schoolId: school.id,
        eventIds: sortedEvents.map((evt) => evt.id),
      });
      reloadEvt();
      reloadLogs();
      Alert.alert("成功", `已刪除 ${sortedEvents.length} 個活動`);
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "批次刪除活動失敗");
    } finally {
      setBatchDeletingEvents(false);
    }
  };

  const batchSetPinForFilteredAnnouncements = async (pinned: boolean) => {
    if (sortedAnnouncements.length === 0) {
      Alert.alert("提示", "目前沒有可更新的公告。");
      return;
    }
    if (pinned) {
      setBatchPinningAnnouncements(true);
    } else {
      setBatchUnpinningAnnouncements(true);
    }
    try {
      await bulkUpdateSchoolAnnouncements({
        schoolId: school.id,
        announcementIds: sortedAnnouncements.map((ann) => ann.id),
        action: pinned ? "pin" : "unpin",
      });
      reloadAnn();
      reloadLogs();
      Alert.alert("成功", `已將 ${sortedAnnouncements.length} 則公告設為${pinned ? "置頂" : "非置頂"}`);
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "批次更新公告失敗");
    } finally {
      setBatchPinningAnnouncements(false);
      setBatchUnpinningAnnouncements(false);
    }
  };

  const exportAnnouncementsCsv = async () => {
    if (sortedAnnouncements.length === 0) {
      Alert.alert("提示", "目前沒有可匯出的公告資料。");
      return;
    }
    setExportingAnnouncements(true);
    try {
      const csv = buildCsv(
        ["id", "title", "body", "source", "pinned", "publishedAt"],
        sortedAnnouncements.map((ann) => [
          ann.id,
          ann.title,
          ann.body,
          ann.source ?? "",
          ann.pinned ? "1" : "0",
          formatDateTime(ann.publishedAt),
        ])
      );
      const filename = `announcements-${school.code}-${Date.now()}.csv`;
      const file = new File(Paths.cache, filename);
      file.write(csv);
      const canShare = await isAvailableAsync();
      if (!canShare) {
        Alert.alert("提示", "此裝置不支援分享功能，檔案已產生於快取目錄。");
        return;
      }
      await shareAsync(file.uri, {
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
      logAdminAction("export_announcements_csv", `count=${sortedAnnouncements.length}`);
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "匯出公告 CSV 失敗");
    } finally {
      setExportingAnnouncements(false);
    }
  };

  const exportEventsCsv = async () => {
    if (sortedEvents.length === 0) {
      Alert.alert("提示", "目前沒有可匯出的活動資料。");
      return;
    }
    setExportingEvents(true);
    try {
      const csv = buildCsv(
        ["id", "title", "description", "location", "startsAt", "endsAt", "capacity", "registeredCount"],
        sortedEvents.map((evt) => [
          evt.id,
          evt.title,
          evt.description ?? "",
          evt.location ?? "",
          formatDateTime(evt.startsAt),
          formatDateTime(evt.endsAt),
          evt.capacity ?? "",
          evt.registeredCount ?? "",
        ])
      );
      const filename = `events-${school.code}-${Date.now()}.csv`;
      const file = new File(Paths.cache, filename);
      file.write(csv);
      const canShare = await isAvailableAsync();
      if (!canShare) {
        Alert.alert("提示", "此裝置不支援分享功能，檔案已產生於快取目錄。");
        return;
      }
      await shareAsync(file.uri, {
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
      logAdminAction("export_events_csv", `count=${sortedEvents.length}`);
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "匯出活動 CSV 失敗");
    } finally {
      setExportingEvents(false);
    }
  };

  const exportAdminLogsCsv = async () => {
    if (filteredAdminLogs.length === 0) {
      Alert.alert("提示", "目前沒有可匯出的操作紀錄。");
      return;
    }
    setExportingLogs(true);
    try {
      const csv = buildCsv(
        ["id", "action", "details", "actor", "createdAt"],
        filteredAdminLogs.map((log) => [
          log.id,
          log.action,
          log.details ?? "",
          log.actorEmail || log.actorUid || "",
          formatDateTime(log.createdAt),
        ])
      );
      const filename = `admin-logs-${school.code}-${Date.now()}.csv`;
      const file = new File(Paths.cache, filename);
      file.write(csv);
      const canShare = await isAvailableAsync();
      if (!canShare) {
        Alert.alert("提示", "此裝置不支援分享功能，檔案已產生於快取目錄。");
        return;
      }
      await shareAsync(file.uri, {
        mimeType: "text/csv",
        UTI: "public.comma-separated-values-text",
      });
      logAdminAction("export_admin_logs_csv", `count=${filteredAdminLogs.length}`);
    } catch (e: any) {
      Alert.alert("錯誤", e?.message ?? "匯出操作紀錄 CSV 失敗");
    } finally {
      setExportingLogs(false);
    }
  };

  const logAdminAction = async (action: string, details?: string) => {
    console.info("[AdminDashboard] Local-only admin action:", { action, details });
  };

  if (!auth.isAdmin && !auth.isEditor) {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <Card title="管理員控制台" subtitle="此功能僅限管理員或編輯者使用。">
            <Pill text="權限不足" />
            <Text style={{ color: theme.colors.muted, marginTop: 10, lineHeight: 20 }}>
              若你是管理員，請用具有管理員權限的帳號登入。
            </Text>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <TabButton icon="grid" label="總覽" active={tab === "overview"} onPress={() => setTab("overview")} />
          <TabButton icon="newspaper" label="公告" active={tab === "announcements"} onPress={() => setTab("announcements")} />
          <TabButton icon="calendar" label="活動" active={tab === "events"} onPress={() => setTab("events")} />
          <TabButton icon="people" label="成員" active={tab === "members"} onPress={() => setTab("members")} />
          <TabButton icon="settings" label="設定" active={tab === "settings"} onPress={() => setTab("settings")} />
        </View>

        {tab === "overview" && (
          <>
            <AnimatedCard title="管理員總覽" subtitle={`${school.name}（${school.code}）`}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <Pill text={auth.isAdmin ? "管理員" : "編輯者"} kind="accent" />
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{auth.user?.email}</Text>
              </View>
            </AnimatedCard>

            {ambientCue ? (
              <AmbientCueCard
                signalType={ambientCue.signalType}
                headline={ambientCue.headline}
                body={ambientCue.body}
                metric={ambientCue.metric}
                actionLabel={ambientCue.ctaLabel}
                onPress={() => openAmbientCue(ambientCue, nav)}
                onDismiss={() => {
                  void dismissAmbientCue(ambientCue);
                }}
              />
            ) : null}

            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <StatCard
                  icon="newspaper-outline"
                  label="公告"
                  value={stats.announcements}
                  color={theme.colors.accent}
                  onPress={() => setTab("announcements")}
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatCard
                  icon="calendar-outline"
                  label="活動"
                  value={stats.events}
                  color={theme.colors.success}
                  onPress={() => setTab("events")}
                />
              </View>
              <View style={{ flex: 1 }}>
                <StatCard
                  icon="people-outline"
                  label="成員"
                  value={stats.members}
                  color="#F59E0B"
                  onPress={() => setTab("members")}
                />
              </View>
            </View>

            <Card title="快速操作">
              <View style={{ gap: 10 }}>
                <Button text="發布新公告" kind="primary" onPress={() => openAnnouncementModal()} />
                <Button text="建立新活動" onPress={() => openEventModal()} />
                <Button text="課程認證" onPress={() => nav?.navigate?.("AdminCourseVerify")} />
              </View>
            </Card>

            <Card title="最新公告" subtitle={`最近 ${Math.min(3, announcements.length)} 則`}>
              {annLoading ? (
                <Text style={{ color: theme.colors.muted }}>載入中...</Text>
              ) : announcements.length === 0 ? (
                <Text style={{ color: theme.colors.muted }}>尚無公告</Text>
              ) : (
                <View style={{ gap: 8 }}>
                  {announcements.slice(0, 3).map((ann) => (
                    <Pressable
                      key={ann.id}
                      onPress={() => openAnnouncementModal(ann)}
                      style={{
                        padding: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: theme.colors.surface2,
                        borderWidth: 1,
                        borderColor: theme.colors.border,
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        {ann.pinned && <Ionicons name="pin" size={14} color={theme.colors.accent} />}
                        <Text style={{ color: theme.colors.text, fontWeight: "700", flex: 1 }} numberOfLines={1}>
                          {ann.title}
                        </Text>
                      </View>
                      <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                        {formatDateTime(ann.publishedAt)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </Card>
          </>
        )}

        {tab === "announcements" && (
          <Card title="公告管理" subtitle={`共 ${announcements.length} 則公告`}>
            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={announcementKeyword}
                onChangeText={setAnnouncementKeyword}
                placeholder="搜尋標題、內容、來源"
                placeholderTextColor={theme.colors.muted}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                }}
              />
            </View>
            <View style={{ marginBottom: 12 }}>
              <SegmentedControl
                options={[
                  { key: "latest", label: "最新" },
                  { key: "oldest", label: "最舊" },
                  { key: "pinned", label: "置頂優先" },
                ]}
                selected={announcementSort}
                onChange={setAnnouncementSort}
              />
            </View>
            <View style={{ marginBottom: 12, gap: 8 }}>
              <Button text="發布新公告" kind="primary" onPress={() => openAnnouncementModal()} />
              <Button
                text={batchPinningAnnouncements ? "套用中..." : "目前篩選結果：批次置頂"}
                disabled={batchPinningAnnouncements || batchUnpinningAnnouncements || sortedAnnouncements.length === 0}
                onPress={() =>
                  Alert.alert(
                    "確認批次置頂",
                    `將 ${sortedAnnouncements.length} 則目前篩選出的公告設為置頂，確定繼續？`,
                    [
                      { text: "取消", style: "cancel" },
                      { text: "確認", onPress: () => batchSetPinForFilteredAnnouncements(true) },
                    ]
                  )
                }
              />
              <Button
                text={batchUnpinningAnnouncements ? "套用中..." : "目前篩選結果：批次取消置頂"}
                disabled={batchPinningAnnouncements || batchUnpinningAnnouncements || sortedAnnouncements.length === 0}
                onPress={() =>
                  Alert.alert(
                    "確認批次取消置頂",
                    `將 ${sortedAnnouncements.length} 則目前篩選出的公告改為非置頂，確定繼續？`,
                    [
                      { text: "取消", style: "cancel" },
                      { text: "確認", onPress: () => batchSetPinForFilteredAnnouncements(false) },
                    ]
                  )
                }
              />
              <Button
                text={batchDeletingAnnouncements ? "刪除中..." : "刪除目前篩選結果"}
                kind="danger"
                disabled={batchDeletingAnnouncements || sortedAnnouncements.length === 0}
                onPress={() =>
                  Alert.alert(
                    "確認批次刪除",
                    `將刪除 ${sortedAnnouncements.length} 則目前篩選出的公告，確定繼續？`,
                    [
                      { text: "取消", style: "cancel" },
                      { text: "刪除", style: "destructive", onPress: batchDeleteFilteredAnnouncements },
                    ]
                  )
                }
              />
              <Button
                text={exportingAnnouncements ? "匯出中..." : "匯出目前篩選結果 CSV"}
                disabled={exportingAnnouncements || sortedAnnouncements.length === 0}
                onPress={exportAnnouncementsCsv}
              />
            </View>
            {annLoading ? (
              <LoadingState title="公告" subtitle="載入中..." rows={3} />
            ) : (
              <View style={{ gap: 10 }}>
                {sortedAnnouncements.map((ann) => (
                  <View
                    key={ann.id}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      {ann.pinned && <Pill text="置頂" kind="accent" />}
                      {ann.source && <Pill text={ann.source} />}
                    </View>
                    <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{ann.title}</Text>
                    <Text style={{ color: theme.colors.muted, marginTop: 4, fontSize: 12 }} numberOfLines={2}>
                      {ann.body}
                    </Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 6 }}>
                      {formatDateTime(ann.publishedAt)}
                    </Text>
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      <Button text="編輯" onPress={() => openAnnouncementModal(ann)} />
                      <Button text="刪除" onPress={() => deleteAnnouncement(ann)} />
                    </View>
                  </View>
                ))}
                {announcements.length === 0 && (
                  <Text style={{ color: theme.colors.muted }}>尚無公告</Text>
                )}
                {announcements.length > 0 && filteredAnnouncements.length === 0 && (
                  <Text style={{ color: theme.colors.muted }}>找不到符合搜尋條件的公告</Text>
                )}
              </View>
            )}
          </Card>
        )}

        {tab === "events" && (
          <Card title="活動管理" subtitle={`共 ${events.length} 個活動`}>
            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={eventKeyword}
                onChangeText={setEventKeyword}
                placeholder="搜尋活動名稱、描述、地點"
                placeholderTextColor={theme.colors.muted}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                }}
              />
            </View>
            <View style={{ marginBottom: 12 }}>
              <SegmentedControl
                options={[
                  { key: "latest", label: "最新" },
                  { key: "oldest", label: "最舊" },
                ]}
                selected={eventSort}
                onChange={setEventSort}
              />
            </View>
            <View style={{ marginBottom: 12, gap: 8 }}>
              <Button text="建立新活動" kind="primary" onPress={() => openEventModal()} />
              <Button
                text={batchDeletingEvents ? "刪除中..." : "刪除目前篩選結果"}
                kind="danger"
                disabled={batchDeletingEvents || sortedEvents.length === 0}
                onPress={() =>
                  Alert.alert(
                    "確認批次刪除",
                    `將刪除 ${sortedEvents.length} 個目前篩選出的活動，確定繼續？`,
                    [
                      { text: "取消", style: "cancel" },
                      { text: "刪除", style: "destructive", onPress: batchDeleteFilteredEvents },
                    ]
                  )
                }
              />
              <Button
                text={exportingEvents ? "匯出中..." : "匯出目前篩選結果 CSV"}
                disabled={exportingEvents || sortedEvents.length === 0}
                onPress={exportEventsCsv}
              />
            </View>
            {evtLoading ? (
              <LoadingState title="活動" subtitle="載入中..." rows={3} />
            ) : (
              <View style={{ gap: 10 }}>
                {sortedEvents.map((evt) => (
                  <View
                    key={evt.id}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{evt.title}</Text>
                    {evt.location && (
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                        📍 {evt.location}
                      </Text>
                    )}
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                      🗓️ {formatDateTime(evt.startsAt)}
                    </Text>
                    {evt.capacity && (
                      <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                        👥 {evt.registeredCount ?? 0} / {evt.capacity} 人
                      </Text>
                    )}
                    <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                      <Button text="編輯" onPress={() => openEventModal(evt)} />
                      <Button text="刪除" onPress={() => deleteEvent(evt)} />
                    </View>
                  </View>
                ))}
                {events.length === 0 && (
                  <Text style={{ color: theme.colors.muted }}>尚無活動</Text>
                )}
                {events.length > 0 && filteredEvents.length === 0 && (
                  <Text style={{ color: theme.colors.muted }}>找不到符合搜尋條件的活動</Text>
                )}
              </View>
            )}
          </Card>
        )}

        {tab === "members" && (
          <Card title="成員管理" subtitle={`共 ${members.length} 位成員`}>
            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={memberKeyword}
                onChangeText={setMemberKeyword}
                placeholder="搜尋姓名、系所、UID 或角色"
                placeholderTextColor={theme.colors.muted}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: theme.radius.md,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface2,
                  color: theme.colors.text,
                }}
              />
            </View>
            <View style={{ marginBottom: 12, flexDirection: "row", gap: 8 }}>
              <Pill text={`管理員 ${stats.admins}`} kind="accent" />
              <Pill text={`編輯者 ${members.filter((m) => m.role === "editor").length}`} />
              <Pill text={`一般 ${members.filter((m) => m.role === "member").length}`} />
            </View>
            {memLoading ? (
              <LoadingState title="成員" subtitle="載入中..." rows={3} />
            ) : (
              <View style={{ gap: 10 }}>
                {filteredMembers.map((member) => (
                  <View
                    key={member.id}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 18,
                          backgroundColor: theme.colors.accentSoft,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ color: theme.colors.accent, fontWeight: "700" }}>
                          {(member.displayName?.[0] || member.id?.[0] || "?").toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                          {member.displayName || "(未設定名稱)"}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                          {member.department || member.id.slice(0, 8) + "..."}
                        </Text>
                      </View>
                      <Pill
                        text={
                          member.role === "admin"
                            ? "管理員"
                            : member.role === "editor"
                            ? "編輯者"
                            : "一般"
                        }
                        kind={member.role === "admin" ? "accent" : "default"}
                      />
                    </View>
                    {auth.isAdmin && member.id !== auth.user?.uid && (
                      <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
                        {member.role !== "admin" && (
                          <Button
                            text="設為管理員"
                            onPress={() => updateMemberRole(member, "admin")}
                          />
                        )}
                        {member.role !== "editor" && (
                          <Button
                            text="設為編輯者"
                            onPress={() => updateMemberRole(member, "editor")}
                          />
                        )}
                        {member.role !== "member" && (
                          <Button
                            text="設為一般"
                            onPress={() => updateMemberRole(member, "member")}
                          />
                        )}
                      </View>
                    )}
                  </View>
                ))}
                {members.length === 0 && (
                  <Text style={{ color: theme.colors.muted }}>尚無成員</Text>
                )}
                {members.length > 0 && filteredMembers.length === 0 && (
                  <Text style={{ color: theme.colors.muted }}>找不到符合搜尋條件的成員</Text>
                )}
              </View>
            )}
          </Card>
        )}

        {tab === "settings" && (
          <Card title="學校設定" subtitle={`${school.name}（${school.code}）`}>
            <View style={{ gap: 12 }}>
              <View>
                <SectionTitle text="基本資訊" />
                <Text style={{ color: theme.colors.muted, marginTop: 6 }}>
                  學校 ID：{school.id}
                </Text>
                <Text style={{ color: theme.colors.muted, marginTop: 2 }}>
                  代碼：{school.code}
                </Text>
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}>
                <SectionTitle text="管理操作" />
                <View style={{ marginTop: 10, gap: 10 }}>
                  <Button text="課程認證管理" onPress={() => nav?.navigate?.("AdminCourseVerify")} />
                  <Button text="重新載入所有資料" onPress={() => {
                    reloadAnn();
                    reloadEvt();
                    reloadMem();
                    reloadCafeterias();
                    reloadLogs();
                    Alert.alert("成功", "資料已重新載入");
                  }} />
                </View>
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <SectionTitle text="餐廳接單開通" />
                  <Button text="新增餐廳" size="small" onPress={() => openCafeteriaModal()} />
                </View>
                <View style={{ marginTop: 10, gap: 10 }}>
                  {cafeteriaLoading ? (
                    <Text style={{ color: theme.colors.muted }}>載入餐廳設定中...</Text>
                  ) : cafeterias.length === 0 ? (
                    <Text style={{ color: theme.colors.muted }}>尚無餐廳資料</Text>
                  ) : (
                    cafeterias.map((cafeteria) => (
                      <View
                        key={cafeteria.id}
                        style={{
                          borderRadius: theme.radius.md,
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          backgroundColor: theme.colors.surface2,
                          padding: 12,
                          gap: 10,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{cafeteria.name}</Text>
                            <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                              {cafeteria.location || "未設定位置"} · {cafeteria.id}
                            </Text>
                          </View>
                          <View style={{ alignItems: "flex-end", gap: 6 }}>
                            <Pill
                              text={
                                cafeteria.pilotStatus === "live"
                                  ? "正式開通"
                                  : cafeteria.pilotStatus === "pilot"
                                    ? "試營運"
                                    : "未開通"
                              }
                              kind={
                                cafeteria.pilotStatus === "live"
                                  ? "success"
                                  : cafeteria.pilotStatus === "pilot"
                                    ? "warning"
                                    : "default"
                              }
                            />
                            <Pill
                              text={cafeteria.orderingEnabled ? "可接單" : "已關閉接單"}
                              kind={cafeteria.orderingEnabled ? "accent" : "default"}
                            />
                          </View>
                        </View>
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          <Pill text={`operator ${cafeteria.activeOperatorCount}`} kind="muted" />
                          {cafeteria.brandKey ? <Pill text={`品牌 ${cafeteria.brandKey}`} kind="muted" /> : null}
                        </View>
                        <View style={{ flexDirection: "row", gap: 8 }}>
                          <Button text="編輯設定" size="small" onPress={() => openCafeteriaModal(cafeteria)} />
                          <Button
                            text="管理店員"
                            size="small"
                            kind="outline"
                            onPress={() => openOperatorModal(cafeteria)}
                          />
                        </View>
                      </View>
                    ))
                  )}
                </View>
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}>
                <SectionTitle text="最近管理操作" />
                <View style={{ marginTop: 10, gap: 8 }}>
                  <TextInput
                    value={logKeyword}
                    onChangeText={setLogKeyword}
                    placeholder="搜尋操作、細節、操作者"
                    placeholderTextColor={theme.colors.muted}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: theme.radius.md,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: theme.colors.surface2,
                      color: theme.colors.text,
                    }}
                  />
                  <SegmentedControl
                    options={[
                      { key: "all", label: "全部" },
                      { key: "write", label: "新增/修改" },
                      { key: "delete", label: "刪除" },
                      { key: "batch", label: "批次" },
                      { key: "export", label: "匯出" },
                    ]}
                    selected={logFilter}
                    onChange={setLogFilter}
                  />
                  <Button
                    text={exportingLogs ? "匯出中..." : "匯出目前篩選結果 CSV"}
                    disabled={exportingLogs || filteredAdminLogs.length === 0}
                    onPress={exportAdminLogsCsv}
                  />
                </View>
                {logsLoading ? (
                  <Text style={{ color: theme.colors.muted, marginTop: 8 }}>載入中...</Text>
                ) : adminLogs.length === 0 ? (
                  <Text style={{ color: theme.colors.muted, marginTop: 8 }}>尚無操作紀錄</Text>
                ) : (
                  <View style={{ gap: 8, marginTop: 10 }}>
                    {filteredAdminLogs.map((log) => (
                      <View
                        key={log.id}
                        style={{
                          borderWidth: 1,
                          borderColor: theme.colors.border,
                          borderRadius: theme.radius.md,
                          backgroundColor: theme.colors.surface2,
                          padding: 10,
                        }}
                      >
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{log.action}</Text>
                        {log.details ? (
                          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{log.details}</Text>
                        ) : null}
                        <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>
                          {log.actorEmail || log.actorUid || "未知操作者"} · {formatDateTime(log.createdAt)}
                        </Text>
                      </View>
                    ))}
                    {adminLogs.length > 0 && filteredAdminLogs.length === 0 && (
                      <Text style={{ color: theme.colors.muted }}>找不到符合篩選條件的操作紀錄</Text>
                    )}
                  </View>
                )}
              </View>

              <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}>
                <SectionTitle text="危險區域" />
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 6, marginBottom: 10 }}>
                  以下操作無法復原，請謹慎使用。
                </Text>
                <Button
                  text={cleaningData ? "清空中..." : "清空所有測試資料"}
                  kind="danger"
                  disabled={cleaningData}
                  onPress={() => {
                    Alert.alert("確認", "此操作將清空所有測試資料，無法復原。確定要繼續嗎？", [
                      { text: "取消", style: "cancel" },
                      {
                        text: "確定清空",
                        style: "destructive",
                        onPress: clearTestingData,
                      },
                    ]);
                  }}
                />
              </View>
            </View>
          </Card>
        )}
      </ScrollView>

      <Modal
        visible={showAnnouncementModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowAnnouncementModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={() => setShowAnnouncementModal(false)}>
              <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
              {editingAnnouncement ? "編輯公告" : "發布公告"}
            </Text>
            <Pressable onPress={saveAnnouncement} disabled={saving}>
              <Text style={{ color: saving ? theme.colors.muted : theme.colors.accent, fontWeight: "600" }}>
                {saving ? "儲存中..." : "儲存"}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
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
                flexDirection: "row",
                alignItems: "center",
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
                  backgroundColor: annPinned ? theme.colors.accent : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {annPinned && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>置頂公告</Text>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showEventModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowEventModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={() => setShowEventModal(false)}>
              <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
              {editingEvent ? "編輯活動" : "建立活動"}
            </Text>
            <Pressable onPress={saveEvent} disabled={saving}>
              <Text style={{ color: saving ? theme.colors.muted : theme.colors.accent, fontWeight: "600" }}>
                {saving ? "儲存中..." : "儲存"}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
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
              💡 未填開始時間時，系統會預設為 7 天後；可另外填入結束時間。
            </Text>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showCafeteriaModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowCafeteriaModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={() => setShowCafeteriaModal(false)}>
              <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
              {editingCafeteria ? "編輯餐廳" : "新增餐廳"}
            </Text>
            <Pressable onPress={saveCafeteria} disabled={savingCafeteria}>
              <Text style={{ color: savingCafeteria ? theme.colors.muted : theme.colors.accent, fontWeight: "600" }}>
                {savingCafeteria ? "儲存中..." : "儲存"}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
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
              <Text style={{ color: theme.colors.muted, marginBottom: 6, fontWeight: "600" }}>
                試用狀態
              </Text>
              <SegmentedControl
                options={[
                  { key: "inactive", label: "未開通" },
                  { key: "pilot", label: "試營運" },
                  { key: "live", label: "正式" },
                ]}
                selected={cafeteriaPilotStatus}
                onChange={(value) => setCafeteriaPilotStatus(value as "inactive" | "pilot" | "live")}
              />
            </View>
            <Pressable
              onPress={() => setCafeteriaOrderingEnabled((current) => !current)}
              style={{
                flexDirection: "row",
                alignItems: "center",
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
                  backgroundColor: cafeteriaOrderingEnabled ? theme.colors.accent : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {cafeteriaOrderingEnabled && <Ionicons name="checkmark" size={16} color="#fff" />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>開啟接單</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                  關閉後學生仍可看到店家，但無法送出訂單。
                </Text>
              </View>
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal
        visible={showOperatorModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowOperatorModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.colors.border,
            }}
          >
            <Pressable onPress={() => setShowOperatorModal(false)}>
              <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>取消</Text>
            </Pressable>
            <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 16 }}>
              {selectedOperatorCafeteria ? `${selectedOperatorCafeteria.name} 店員` : "店員管理"}
            </Text>
            <Pressable onPress={saveOperatorAssignment} disabled={savingOperator}>
              <Text style={{ color: savingOperator ? theme.colors.muted : theme.colors.accent, fontWeight: "600" }}>
                {savingOperator ? "儲存中..." : "儲存"}
              </Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
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
              <Text style={{ color: theme.colors.muted, marginBottom: 6, fontWeight: "600" }}>
                身分
              </Text>
              <SegmentedControl
                options={[
                  { key: "owner", label: "負責人" },
                  { key: "manager", label: "主管" },
                  { key: "staff", label: "店員" },
                ]}
                selected={operatorRole}
                onChange={(value) => setOperatorRole(value as "owner" | "manager" | "staff")}
              />
            </View>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: theme.colors.muted, marginBottom: 6, fontWeight: "600" }}>
                狀態
              </Text>
              <SegmentedControl
                options={[
                  { key: "active", label: "啟用" },
                  { key: "inactive", label: "停用" },
                ]}
                selected={operatorStatus}
                onChange={(value) => setOperatorStatus(value as "active" | "inactive")}
              />
            </View>

            <View style={{ borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12, gap: 10 }}>
              <SectionTitle text="目前店員" />
              {operatorsLoading ? (
                <Text style={{ color: theme.colors.muted }}>載入店員中...</Text>
              ) : cafeteriaOperators.length === 0 ? (
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
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                          {operator.displayName || operator.email || operator.id}
                        </Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                          {operator.email || "未設定 email"} · {operator.id}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end", gap: 6 }}>
                        <Pill
                          text={operator.status === "active" ? "啟用中" : "已停用"}
                          kind={operator.status === "active" ? "success" : "default"}
                        />
                        <Pill
                          text={
                            operator.role === "owner"
                              ? "負責人"
                              : operator.role === "manager"
                                ? "主管"
                                : "店員"
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
