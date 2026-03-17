import React, { useMemo, useState, useEffect, useCallback } from "react";
import { ScrollView, Text, View, Pressable, Share, Alert, TextInput, Linking, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp, updateDoc, query, orderBy, where, increment } from "firebase/firestore";
import * as Calendar from "expo-calendar";
import { useAsyncList } from "../hooks/useAsyncList";
import { useDataSource } from "../hooks/useDataSource";
import { Screen, Card, Pill, Button, LoadingState, ErrorState, SectionTitle, CountdownTimer, AnimatedCard, InfoRow, FeatureHighlight, Avatar, StatusBadge, RatingStars, ProgressRing } from "../ui/components";
import { useFavorites } from "../state/favorites";
import { useAuth } from "../state/auth";
import { getDb } from "../firebase";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { formatDateTime, toDate, formatRelativeTime } from "../utils/format";
import type { ClubEvent } from "../data/types";

type Registration = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  registeredAt?: any;
  status: "registered" | "cancelled" | "waitlist";
  checkedIn?: boolean;
  checkedInAt?: any;
  waitlistPosition?: number;
};

type EventReview = {
  id: string;
  uid: string;
  email?: string | null;
  displayName?: string | null;
  rating: number;
  comment: string;
  createdAt?: any;
};

type UserProfile = {
  uid: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
};

export function EventDetailScreen(props: any) {
  const { school } = useSchool();
  const nav = props?.navigation;
  const id: string | undefined = props?.route?.params?.id;
  const fav = useFavorites();
  const auth = useAuth();
  const db = getDb();

  const [err, setErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [showAllRegistrations, setShowAllRegistrations] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState("");
  const [submittingReview, setSubmittingReview] = useState(false);

  const [item, setItem] = useState<ClubEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [similarEvents, setSimilarEvents] = useState<ClubEvent[]>([]);

  const ds = useDataSource();

  const loadEvent = useCallback(async () => {
    if (!id) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    
    try {
      const event = await ds.getEvent(id);
      if (!event) {
        setNotFound(true);
        setItem(null);
      } else {
        setItem(event);
        setNotFound(false);
        
        // 載入相似活動
        try {
          const allEvents = await ds.listEvents(school.id);
          const related = allEvents
            .filter((e) => e.id !== event.id)
            .filter((e) => {
              const eStart = toDate(e.startsAt);
              return eStart && eStart > new Date();
            })
            .slice(0, 3);
          setSimilarEvents(related);
        } catch {
          setSimilarEvents([]);
        }
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "載入活動失敗");
      setItem(null);
    } finally {
      setLoading(false);
    }
  }, [id, ds, school.id]);

  useEffect(() => {
    loadEvent();
  }, [loadEvent]);

  const { items: registrations, loading: regLoading, reload: reloadRegistrations } = useAsyncList<Registration>(
    async () => {
      if (!id) return [];
      const ref = collection(db, "events", id, "registrations");
      const qy = query(ref, orderBy("registeredAt", "asc"));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ uid: d.id, ...(d.data() as any) })) as Registration[];
    },
    [db, id]
  );

  // Fetch reviews for ended events
  const { items: reviews, loading: reviewsLoading, reload: reloadReviews } = useAsyncList<EventReview>(
    async () => {
      if (!id) return [];
      const ref = collection(db, "events", id, "reviews");
      const qy = query(ref, orderBy("createdAt", "desc"));
      const snap = await getDocs(qy);
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as EventReview[];
    },
    [db, id]
  );

  // Fetch user profiles for display
  const { items: userProfiles } = useAsyncList<UserProfile>(
    async () => {
      const uids = new Set<string>();
      for (const r of registrations) uids.add(r.uid);
      for (const r of reviews) uids.add(r.uid);
      const profiles: UserProfile[] = [];
      for (const uid of uids) {
        try {
          const snap = await getDoc(doc(db, "users", uid));
          if (snap.exists()) {
            profiles.push({ uid, ...(snap.data() as any) });
          }
        } catch {}
      }
      return profiles;
    },
    [db, registrations.map(r => r.uid).join(","), reviews.map(r => r.uid).join(",")]
  );

  const profilesById = useMemo(() => {
    const map: Record<string, UserProfile> = {};
    for (const p of userProfiles) map[p.uid] = p;
    return map;
  }, [userProfiles]);

  const myRegistration = useMemo(() => {
    if (!auth.user) return null;
    return registrations.find((r) => r.uid === auth.user?.uid && (r.status === "registered" || r.status === "waitlist")) ?? null;
  }, [registrations, auth.user?.uid]);

  const myReview = useMemo(() => {
    if (!auth.user) return null;
    return reviews.find((r) => r.uid === auth.user?.uid) ?? null;
  }, [reviews, auth.user?.uid]);

  const registeredCount = useMemo(() => {
    return registrations.filter((r) => r.status === "registered").length;
  }, [registrations]);

  const waitlistCount = useMemo(() => {
    return registrations.filter((r) => r.status === "waitlist").length;
  }, [registrations]);

  const checkedInCount = useMemo(() => {
    return registrations.filter((r) => r.status === "registered" && r.checkedIn).length;
  }, [registrations]);

  const averageRating = useMemo(() => {
    if (reviews.length === 0) return 0;
    return reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  }, [reviews]);

  const isFull = useMemo(() => {
    if (!item?.capacity) return false;
    return registeredCount >= item.capacity;
  }, [item?.capacity, registeredCount]);

  const canRegister = useMemo(() => {
    if (!auth.user) return false;
    if (myRegistration) return false;
    return true;
  }, [auth.user, myRegistration]);

  const onRegister = async (joinWaitlist = false) => {
    setErr(null);
    setSuccessMsg(null);
    if (!auth.user) {
      setErr("請先到『我的』登入後再報名");
      return;
    }
    if (!id) return;

    const status = (isFull && !joinWaitlist) ? "waitlist" : (isFull ? "waitlist" : "registered");
    
    if (isFull && !joinWaitlist) {
      Alert.alert(
        "名額已滿",
        "是否要加入候補名單？有名額釋出時會通知你。",
        [
          { text: "取消", style: "cancel" },
          { text: "加入候補", onPress: () => onRegister(true) },
        ]
      );
      return;
    }

    setActionLoading(true);
    try {
      const waitlistPosition = status === "waitlist" ? waitlistCount + 1 : undefined;
      await setDoc(doc(db, "events", id, "registrations", auth.user.uid), {
        uid: auth.user.uid,
        email: auth.user.email ?? null,
        displayName: auth.profile?.displayName ?? null,
        avatarUrl: auth.profile?.avatarUrl ?? null,
        registeredAt: serverTimestamp(),
        status,
        schoolId: school.id,
        checkedIn: false,
        waitlistPosition,
      });
      reloadRegistrations();
      setSuccessMsg(status === "waitlist" ? "已加入候補名單" : "報名成功！");
    } catch (e: any) {
      setErr(e?.message ?? "報名失敗");
    } finally {
      setActionLoading(false);
    }
  };

  const onCancelRegistration = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!auth.user) return;
    if (!id) return;

    Alert.alert(
      "取消報名",
      "確定要取消報名嗎？",
      [
        { text: "保持報名", style: "cancel" },
        {
          text: "確認取消",
          style: "destructive",
          onPress: async () => {
            setActionLoading(true);
            try {
              await deleteDoc(doc(db, "events", id, "registrations", auth.user!.uid));
              reloadRegistrations();
              setSuccessMsg("已取消報名");
            } catch (e: any) {
              setErr(e?.message ?? "取消報名失敗");
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  };

  // Add to calendar
  const onAddToCalendar = async () => {
    if (!item) return;
    try {
      const { status } = await Calendar.requestCalendarPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("權限不足", "請在設定中允許行事曆權限");
        return;
      }

      const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
      const defaultCalendar = calendars.find(
        (cal) => cal.allowsModifications && cal.source.name === "Default"
      ) || calendars.find((cal) => cal.allowsModifications);

      if (!defaultCalendar) {
        Alert.alert("錯誤", "找不到可用的行事曆");
        return;
      }

      const startDate = toDate(item.startsAt);
      const endDate = toDate(item.endsAt) || startDate;

      if (!startDate) {
        Alert.alert("錯誤", "活動時間資訊不完整");
        return;
      }

      await Calendar.createEventAsync(defaultCalendar.id, {
        title: item.title,
        notes: item.description,
        location: item.location || "",
        startDate,
        endDate,
        alarms: [{ relativeOffset: -60 }], // 1 hour before
      });

      setSuccessMsg("已加入行事曆");
    } catch (e: any) {
      setErr(e?.message ?? "加入行事曆失敗");
    }
  };

  // Submit review
  const onSubmitReview = async () => {
    setErr(null);
    setSuccessMsg(null);
    if (!auth.user) {
      setErr("請先登入");
      return;
    }
    if (!id) return;
    if (reviewRating === 0) {
      setErr("請選擇評分");
      return;
    }

    setSubmittingReview(true);
    try {
      await setDoc(doc(db, "events", id, "reviews", auth.user.uid), {
        uid: auth.user.uid,
        email: auth.user.email ?? null,
        displayName: auth.profile?.displayName ?? null,
        rating: reviewRating,
        comment: reviewComment.trim(),
        createdAt: serverTimestamp(),
      });
      setReviewRating(0);
      setReviewComment("");
      reloadReviews();
      setSuccessMsg("感謝你的評價！");
    } catch (e: any) {
      setErr(e?.message ?? "提交評價失敗");
    } finally {
      setSubmittingReview(false);
    }
  };

  // Show QR code for check-in
  const onShowQRCode = () => {
    if (!id || !auth.user) return;
    nav?.navigate?.("QRCode", { 
      type: "event-checkin", 
      data: JSON.stringify({ eventId: id, uid: auth.user.uid }),
      title: "活動簽到",
      subtitle: item?.title,
    });
  };

  // Navigate to map for location
  const onOpenLocation = () => {
    if (!item?.location) return;
    const url = Platform.select({
      ios: `maps:0,0?q=${encodeURIComponent(item.location)}`,
      android: `geo:0,0?q=${encodeURIComponent(item.location)}`,
    });
    if (url) Linking.openURL(url);
  };

  const startsAtDate = useMemo(() => toDate(item?.startsAt), [item?.startsAt]);
  const endsAtDate = useMemo(() => toDate(item?.endsAt), [item?.endsAt]);

  const eventStatus = useMemo(() => {
    if (!startsAtDate) return "unknown";
    const now = new Date();
    if (now < startsAtDate) return "upcoming";
    if (endsAtDate && now > endsAtDate) return "ended";
    return "ongoing";
  }, [startsAtDate, endsAtDate]);


  const handleShare = async () => {
    if (!item) return;
    const range = `${formatDateTime(item.startsAt)} ~ ${formatDateTime(item.endsAt)}`;
    const message = `【${item.title}】\n\n${item.description}\n\n時間：${range}${item.location ? `\n地點：${item.location}` : ""}\n\n報名人數：${registeredCount}${item.capacity ? `/${item.capacity}` : ""}`;
    try {
      await Share.share({ message, title: item.title });
    } catch {}
  };

  const handleAddReminder = () => {
    Alert.alert(
      "設定活動提醒",
      "選擇提醒時間",
      [
        { text: "活動前 1 小時", onPress: () => Alert.alert("已設定", "將在活動開始前 1 小時提醒你") },
        { text: "活動前 1 天", onPress: () => Alert.alert("已設定", "將在活動開始前 1 天提醒你") },
        { text: "活動前 1 週", onPress: () => Alert.alert("已設定", "將在活動開始前 1 週提醒你") },
        { text: "取消", style: "cancel" },
      ]
    );
  };

  if (loading) {
    return <LoadingState title="活動" subtitle="載入中..." rows={2} />;
  }
  
  if (loadError) {
    return (
      <ErrorState 
        title="活動" 
        subtitle="讀取失敗" 
        hint={loadError} 
        actionText="重試" 
        onAction={loadEvent}
        errorType="network"
      />
    );
  }
  
  if (notFound || !item) {
    return (
      <ErrorState 
        title="找不到活動" 
        subtitle="此活動不存在或已被刪除" 
        hint="活動可能已過期或被移除，請返回列表頁查看其他活動。"
        actionText="返回"
        onAction={() => nav?.goBack?.()}
        errorType="notFound"
      />
    );
  }

  const range = `${formatDateTime(item.startsAt)} ~ ${formatDateTime(item.endsAt)}`;
  const isFav = fav.isFavorite("event", item.id);

  const getStatusColor = () => {
    switch (eventStatus) {
      case "upcoming": return theme.colors.accent;
      case "ongoing": return theme.colors.success;
      case "ended": return theme.colors.muted;
      default: return theme.colors.muted;
    }
  };

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        {/* Error/Success Messages */}
        {err && (
          <AnimatedCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.danger}15`, borderRadius: theme.radius.md }}>
              <Ionicons name="alert-circle" size={20} color={theme.colors.danger} />
              <Text style={{ flex: 1, color: theme.colors.danger }}>{err}</Text>
              <Pressable onPress={() => setErr(null)}>
                <Ionicons name="close" size={20} color={theme.colors.danger} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}
        {successMsg && (
          <AnimatedCard>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, backgroundColor: `${theme.colors.success}15`, borderRadius: theme.radius.md }}>
              <Ionicons name="checkmark-circle" size={20} color={theme.colors.success} />
              <Text style={{ flex: 1, color: theme.colors.success }}>{successMsg}</Text>
              <Pressable onPress={() => setSuccessMsg(null)}>
                <Ionicons name="close" size={20} color={theme.colors.success} />
              </Pressable>
            </View>
          </AnimatedCard>
        )}

        {/* Main Event Card */}
        <AnimatedCard title={item.title} subtitle="">
          {/* Status & Reviews Header */}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <StatusBadge 
                status={eventStatus === "upcoming" ? "info" : eventStatus === "ongoing" ? "success" : "default"} 
                label={eventStatus === "upcoming" ? "即將開始" : eventStatus === "ongoing" ? "進行中" : "已結束"} 
              />
              {myRegistration && (
                <StatusBadge 
                  status={myRegistration.status === "waitlist" ? "warning" : "success"} 
                  label={myRegistration.status === "waitlist" ? `候補第 ${myRegistration.waitlistPosition ?? "?"}` : "已報名"} 
                />
              )}
              {myRegistration?.checkedIn && <StatusBadge status="success" label="已簽到" />}
            </View>
            {reviews.length > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Ionicons name="star" size={16} color="#F59E0B" />
                <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{averageRating.toFixed(1)}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>({reviews.length})</Text>
              </View>
            )}
          </View>

          <Text style={{ color: theme.colors.text, lineHeight: 22, fontSize: 15, marginBottom: 16 }}>{item.description}</Text>

          {/* Event Details */}
          <View style={{ gap: 12 }}>
            <Pressable 
              onPress={eventStatus === "upcoming" ? onAddToCalendar : undefined}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2 }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${getStatusColor()}20`, alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="calendar" size={20} color={getStatusColor()} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>時間</Text>
                <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{range}</Text>
              </View>
              {eventStatus === "upcoming" && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Ionicons name="add-circle-outline" size={18} color={theme.colors.accent} />
                  <Text style={{ color: theme.colors.accent, fontSize: 12 }}>加入行事曆</Text>
                </View>
              )}
            </Pressable>

            {item.location && (
              <Pressable 
                onPress={onOpenLocation}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2 }}
              >
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: `${theme.colors.success}20`, alignItems: "center", justifyContent: "center" }}>
                  <Ionicons name="location" size={20} color={theme.colors.success} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.muted, fontSize: 12 }}>地點</Text>
                  <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{item.location}</Text>
                </View>
                <Ionicons name="navigate-outline" size={18} color={theme.colors.accent} />
              </Pressable>
            )}

            {/* Registration Stats */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1, padding: 12, borderRadius: theme.radius.md, backgroundColor: theme.colors.accentSoft, alignItems: "center" }}>
                <Text style={{ color: theme.colors.accent, fontWeight: "900", fontSize: 24 }}>{registeredCount}</Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{item.capacity ? `/ ${item.capacity}` : ""} 已報名</Text>
              </View>
              {waitlistCount > 0 && (
                <View style={{ flex: 1, padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.warning}15`, alignItems: "center" }}>
                  <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 24 }}>{waitlistCount}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>候補中</Text>
                </View>
              )}
              {eventStatus !== "upcoming" && checkedInCount > 0 && (
                <View style={{ flex: 1, padding: 12, borderRadius: theme.radius.md, backgroundColor: `${theme.colors.success}15`, alignItems: "center" }}>
                  <Text style={{ color: theme.colors.success, fontWeight: "900", fontSize: 24 }}>{checkedInCount}</Text>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>已簽到</Text>
                </View>
              )}
            </View>
          </View>

          {/* Action Buttons */}
          <View style={{ marginTop: 16, flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button
              text={isFav ? "取消收藏" : "收藏"}
              kind={isFav ? "secondary" : "primary"}
              onPress={() => fav.toggleFavorite("event", item.id)}
            />
            <Button text="分享" onPress={handleShare} />
            {eventStatus === "upcoming" && <Button text="設定提醒" onPress={handleAddReminder} />}
          </View>
        </AnimatedCard>

        {eventStatus === "upcoming" && startsAtDate && (
          <AnimatedCard title="活動倒數" subtitle="距離活動開始還有" delay={100}>
            <CountdownTimer targetDate={startsAtDate} label="" />
          </AnimatedCard>
        )}

        {/* Registration Card */}
        <AnimatedCard
          title="報名資訊"
          subtitle={item.capacity ? `名額：${registeredCount}/${item.capacity}` : "名額：不限"}
          delay={200}
        >
          {item.capacity && (
            <View style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 12 }}>報名進度</Text>
                <Text style={{ color: isFull ? theme.colors.danger : theme.colors.accent, fontSize: 12, fontWeight: "700" }}>
                  {Math.round((registeredCount / item.capacity) * 100)}%
                </Text>
              </View>
              <View
                style={{
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: theme.colors.surface2,
                  overflow: "hidden",
                }}
              >
                <View
                  style={{
                    height: "100%",
                    width: `${Math.min(100, (registeredCount / item.capacity) * 100)}%`,
                    backgroundColor: isFull ? theme.colors.danger : theme.colors.accent,
                    borderRadius: 5,
                  }}
                />
              </View>
              {isFull && (
                <Text style={{ color: theme.colors.danger, fontSize: 12, marginTop: 6 }}>
                  名額已滿，可加入候補名單
                </Text>
              )}
            </View>
          )}

          {/* My Registration Status */}
          {myRegistration && (
            <View style={{ 
              padding: 14, 
              borderRadius: theme.radius.md, 
              backgroundColor: myRegistration.status === "waitlist" ? `${theme.colors.warning}15` : theme.colors.accentSoft,
              marginBottom: 14,
              borderLeftWidth: 3,
              borderLeftColor: myRegistration.status === "waitlist" ? "#F59E0B" : theme.colors.success,
            }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons 
                  name={myRegistration.status === "waitlist" ? "time" : "checkmark-circle"} 
                  size={24} 
                  color={myRegistration.status === "waitlist" ? "#F59E0B" : theme.colors.success} 
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontWeight: "700" }}>
                    {myRegistration.status === "waitlist" ? `你在候補名單第 ${myRegistration.waitlistPosition ?? "?"} 位` : "你已成功報名此活動"}
                  </Text>
                  {myRegistration.registeredAt && (
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>
                      報名時間：{formatRelativeTime(toDate(myRegistration.registeredAt))}
                    </Text>
                  )}
                </View>
              </View>
              {myRegistration.checkedIn && (
                <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="checkmark-done" size={18} color={theme.colors.success} />
                  <Text style={{ color: theme.colors.success, fontSize: 13 }}>已於活動現場簽到</Text>
                </View>
              )}
            </View>
          )}

          {!auth.user && (
            <View style={{ padding: 12, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md, marginBottom: 14 }}>
              <Text style={{ color: theme.colors.muted, textAlign: "center" }}>
                請先到『我的』登入後才能報名
              </Text>
            </View>
          )}

          {/* Action Buttons */}
          <View style={{ gap: 10 }}>
            {myRegistration ? (
              <>
                {eventStatus !== "ended" && myRegistration.status === "registered" && !myRegistration.checkedIn && (
                  <Button
                    text="顯示簽到 QR Code"
                    kind="primary"
                    onPress={onShowQRCode}
                  />
                )}
                <Button
                  text={actionLoading ? "處理中..." : "取消報名"}
                  kind="secondary"
                  disabled={actionLoading}
                  onPress={onCancelRegistration}
                />
              </>
            ) : eventStatus !== "ended" ? (
              <Button
                text={
                  actionLoading
                    ? "報名中..."
                    : !auth.user
                      ? "登入後報名"
                      : isFull
                        ? "加入候補名單"
                        : "立即報名"
                }
                kind="primary"
                disabled={!auth.user || actionLoading}
                onPress={() => onRegister()}
              />
            ) : (
              <View style={{ padding: 12, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md }}>
                <Text style={{ color: theme.colors.muted, textAlign: "center" }}>活動已結束</Text>
              </View>
            )}
          </View>

          {regLoading && <Text style={{ color: theme.colors.muted, marginTop: 10, textAlign: "center" }}>載入報名資訊中...</Text>}
        </AnimatedCard>

        {/* Registration List */}
        {registeredCount > 0 && (
          <AnimatedCard title="報名名單" subtitle={`已報名 ${registeredCount} 人${waitlistCount > 0 ? ` · 候補 ${waitlistCount} 人` : ""}`} delay={300}>
            <View style={{ gap: 8 }}>
              {registrations
                .filter((r) => r.status === "registered")
                .slice(0, showAllRegistrations ? undefined : 5)
                .map((r, idx) => {
                  const profile = profilesById[r.uid];
                  const displayName = profile?.displayName || r.displayName || r.email || `${r.uid.slice(0, 8)}…`;
                  return (
                    <View
                      key={r.uid}
                      style={{
                        flexDirection: "row",
                        gap: 12,
                        alignItems: "center",
                        padding: 10,
                        borderRadius: theme.radius.md,
                        backgroundColor: r.uid === auth.user?.uid ? theme.colors.accentSoft : theme.colors.surface2,
                      }}
                    >
                      <View style={{ position: "relative" }}>
                        {(profile?.avatarUrl || r.avatarUrl) ? (
                          <Avatar name={displayName} size={36} imageUrl={profile?.avatarUrl || r.avatarUrl} />
                        ) : (
                          <View
                            style={{
                              width: 36,
                              height: 36,
                              borderRadius: 18,
                              backgroundColor: theme.colors.surface,
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ color: theme.colors.accent, fontWeight: "700", fontSize: 14 }}>
                              {displayName[0]?.toUpperCase() ?? "?"}
                            </Text>
                          </View>
                        )}
                        {r.checkedIn && (
                          <View style={{ position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderRadius: 7, backgroundColor: theme.colors.success, alignItems: "center", justifyContent: "center" }}>
                            <Ionicons name="checkmark" size={10} color="#fff" />
                          </View>
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{displayName}</Text>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                          第 {idx + 1} 位報名{r.checkedIn ? " · 已簽到" : ""}
                        </Text>
                      </View>
                      {r.uid === auth.user?.uid && <Pill text="你" kind="accent" />}
                    </View>
                  );
                })}

              {registeredCount > 5 && (
                <Pressable onPress={() => setShowAllRegistrations(!showAllRegistrations)}>
                  <Text style={{ color: theme.colors.accent, textAlign: "center", marginTop: 8, fontWeight: "600" }}>
                    {showAllRegistrations ? "收起" : `查看全部 ${registeredCount} 人`}
                  </Text>
                </Pressable>
              )}
            </View>

            {/* Waitlist */}
            {waitlistCount > 0 && (
              <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: theme.colors.border }}>
                <Text style={{ color: theme.colors.muted, fontWeight: "600", marginBottom: 10 }}>候補名單</Text>
                <View style={{ gap: 8 }}>
                  {registrations
                    .filter((r) => r.status === "waitlist")
                    .slice(0, 3)
                    .map((r) => {
                      const profile = profilesById[r.uid];
                      const displayName = profile?.displayName || r.displayName || r.email || `${r.uid.slice(0, 8)}…`;
                      return (
                        <View
                          key={r.uid}
                          style={{
                            flexDirection: "row",
                            gap: 10,
                            alignItems: "center",
                            padding: 8,
                            borderRadius: theme.radius.sm,
                            backgroundColor: r.uid === auth.user?.uid ? `${theme.colors.warning}15` : theme.colors.surface2,
                          }}
                        >
                          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: "#F59E0B", alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>{r.waitlistPosition ?? "?"}</Text>
                          </View>
                          <Text style={{ color: theme.colors.text, flex: 1, fontSize: 13 }}>{displayName}</Text>
                          {r.uid === auth.user?.uid && <Pill text="你" kind="accent" />}
                        </View>
                      );
                    })}
                  {waitlistCount > 3 && (
                    <Text style={{ color: theme.colors.muted, textAlign: "center", fontSize: 12 }}>
                      還有 {waitlistCount - 3} 人候補中...
                    </Text>
                  )}
                </View>
              </View>
            )}
          </AnimatedCard>
        )}

        {similarEvents.length > 0 && (
          <AnimatedCard title="相似活動推薦" subtitle="你可能也感興趣" delay={400}>
            <View style={{ gap: 10 }}>
              {similarEvents.map((e) => {
                const eStart = toDate(e.startsAt);
                return (
                  <Pressable
                    key={e.id}
                    onPress={() => props?.navigation?.push?.("EventDetail", { id: e.id })}
                    style={{
                      padding: 12,
                      borderRadius: theme.radius.md,
                      backgroundColor: theme.colors.surface2,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                    }}
                  >
                    <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{e.title}</Text>
                    <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 4 }}>
                      {eStart ? formatRelativeTime(eStart) : ""}
                      {e.location ? ` · ${e.location}` : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </AnimatedCard>
        )}

        {/* Reviews Section - Only for ended events */}
        {eventStatus === "ended" && (
          <AnimatedCard 
            title={`活動評價${reviews.length > 0 ? ` (${reviews.length})` : ""}`} 
            subtitle={reviews.length > 0 ? `平均評分 ${averageRating.toFixed(1)} 分` : "分享你的參與心得"}
            delay={450}
          >
            {/* Rating Summary */}
            {reviews.length > 0 && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 16, padding: 14, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md }}>
                <View style={{ alignItems: "center" }}>
                  <Text style={{ color: "#F59E0B", fontWeight: "900", fontSize: 36 }}>{averageRating.toFixed(1)}</Text>
                  <RatingStars rating={averageRating} size={16} />
                  <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 4 }}>{reviews.length} 則評價</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  {[5, 4, 3, 2, 1].map((star) => {
                    const count = reviews.filter(r => r.rating === star).length;
                    const pct = reviews.length > 0 ? (count / reviews.length) * 100 : 0;
                    return (
                      <View key={star} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: theme.colors.muted, fontSize: 11, width: 14 }}>{star}</Text>
                        <Ionicons name="star" size={10} color="#F59E0B" />
                        <View style={{ flex: 1, height: 6, backgroundColor: theme.colors.surface, borderRadius: 3, overflow: "hidden" }}>
                          <View style={{ height: "100%", width: `${pct}%`, backgroundColor: "#F59E0B", borderRadius: 3 }} />
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 10, width: 20 }}>{count}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Submit Review Form */}
            {auth.user && myRegistration && !myReview && (
              <View style={{ marginBottom: 16, padding: 14, backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md }}>
                <Text style={{ color: theme.colors.text, fontWeight: "600", marginBottom: 10 }}>分享你的體驗</Text>
                <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: 12 }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Pressable key={star} onPress={() => setReviewRating(star)}>
                      <Ionicons 
                        name={star <= reviewRating ? "star" : "star-outline"} 
                        size={32} 
                        color="#F59E0B" 
                      />
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  placeholder="分享你的參與心得..."
                  placeholderTextColor="rgba(168,176,194,0.6)"
                  multiline
                  style={{
                    minHeight: 80,
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: theme.radius.sm,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: "rgba(255,255,255,0.04)",
                    color: theme.colors.text,
                    textAlignVertical: "top",
                    marginBottom: 10,
                  }}
                />
                <Button 
                  text={submittingReview ? "提交中..." : "提交評價"} 
                  kind="primary" 
                  disabled={submittingReview || reviewRating === 0}
                  onPress={onSubmitReview} 
                />
              </View>
            )}

            {myReview && (
              <View style={{ marginBottom: 16, padding: 12, backgroundColor: theme.colors.accentSoft, borderRadius: theme.radius.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="checkmark-circle" size={16} color={theme.colors.success} />
                  <Text style={{ color: theme.colors.success, fontSize: 13 }}>你已評價此活動</Text>
                </View>
              </View>
            )}

            {/* Review List */}
            {reviews.length > 0 && (
              <View style={{ gap: 12 }}>
                {reviews.slice(0, 5).map((r) => {
                  const profile = profilesById[r.uid];
                  const displayName = profile?.displayName || r.displayName || r.email || "匿名";
                  return (
                    <View key={r.id} style={{ padding: 12, backgroundColor: theme.colors.surface2, borderRadius: theme.radius.md }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                        {profile?.avatarUrl ? (
                          <Avatar name={displayName} size={32} imageUrl={profile.avatarUrl} />
                        ) : (
                          <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: theme.colors.surface, alignItems: "center", justifyContent: "center" }}>
                            <Text style={{ color: theme.colors.accent, fontWeight: "600", fontSize: 13 }}>{displayName[0]?.toUpperCase() ?? "?"}</Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.colors.text, fontWeight: "600", fontSize: 13 }}>{displayName}</Text>
                          <RatingStars rating={r.rating} size={12} />
                        </View>
                        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{formatRelativeTime(toDate(r.createdAt))}</Text>
                      </View>
                      {r.comment && <Text style={{ color: theme.colors.text, lineHeight: 20 }}>{r.comment}</Text>}
                    </View>
                  );
                })}
              </View>
            )}

            {reviews.length === 0 && !myRegistration && (
              <View style={{ alignItems: "center", paddingVertical: 20 }}>
                <Ionicons name="chatbubbles-outline" size={40} color={theme.colors.muted} />
                <Text style={{ color: theme.colors.muted, marginTop: 10, textAlign: "center" }}>還沒有評價</Text>
              </View>
            )}
          </AnimatedCard>
        )}

        {/* Quick Actions */}
        <AnimatedCard title="活動功能" subtitle="更多便利功能" delay={500}>
          <View style={{ gap: 10 }}>
            <Pressable onPress={handleAddReminder}>
              <FeatureHighlight
                icon="notifications-outline"
                title="活動提醒"
                description="設定提醒，不錯過重要活動"
                color={theme.colors.accent}
              />
            </Pressable>
            <Pressable onPress={onAddToCalendar}>
              <FeatureHighlight
                icon="calendar-outline"
                title="加入行事曆"
                description="將活動同步到手機行事曆"
                color={theme.colors.success}
              />
            </Pressable>
            {myRegistration && myRegistration.status === "registered" && (
              <Pressable onPress={onShowQRCode}>
                <FeatureHighlight
                  icon="qr-code-outline"
                  title="活動簽到"
                  description="掃碼簽到，快速確認出席"
                  color="#F59E0B"
                />
              </Pressable>
            )}
          </View>
        </AnimatedCard>
      </ScrollView>
    </Screen>
  );
}
