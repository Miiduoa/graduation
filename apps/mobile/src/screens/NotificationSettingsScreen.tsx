/* eslint-disable @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps */
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View, Switch, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, Pill, SectionTitle } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useAuth } from "../state/auth";
import {
  type NotificationPreferences,
  defaultNotificationPreferences,
  loadNotificationPreferences,
  saveNotificationPreferences,
  syncPushTokenForUser,
} from "../services/notifications";

type ToggleRowProps = {
  icon: string;
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
};

function ToggleRow({ icon, label, description, value, onValueChange, disabled }: ToggleRowProps) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <Ionicons name={icon as any} size={22} color={theme.colors.muted} style={{ marginRight: 12 }} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontWeight: "600" }}>{label}</Text>
        {description ? (
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginTop: 2 }}>{description}</Text>
        ) : null}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: theme.colors.border, true: theme.colors.accent }}
        thumbColor={value ? "#fff" : theme.colors.muted}
      />
    </View>
  );
}

type TimePickerProps = {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
};

function TimePicker({ label, value, onChange, disabled }: TimePickerProps) {
  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
  const [h, m] = value.split(":");

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ color: theme.colors.muted, minWidth: 40 }}>{label}</Text>
      <Pressable
        onPress={() => {
          if (disabled) return;
          const nextH = ((parseInt(h, 10) + 1) % 24).toString().padStart(2, "0");
          onChange(`${nextH}:${m}`);
        }}
        style={{
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: theme.radius.md,
          backgroundColor: theme.colors.surface2,
          borderWidth: 1,
          borderColor: theme.colors.border,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <Text style={{ color: theme.colors.text, fontWeight: "700" }}>{value}</Text>
      </Pressable>
    </View>
  );
}

export function NotificationSettingsScreen(props: any) {
  const nav = props?.navigation;
  const auth = useAuth();

  const [prefs, setPrefs] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<string>("unknown");

  useEffect(() => {
    if (!auth.user) return;
    const uid = auth.user.uid;

    (async () => {
      try {
        setPrefs(await loadNotificationPreferences(uid));
      } catch (e) {
        console.error("Failed to load notification preferences:", e);
      } finally {
        setLoading(false);
      }
    })();
  }, [auth.user?.uid]);

  const updatePref = <K extends keyof NotificationPreferences>(
    key: K,
    value: NotificationPreferences[K]
  ) => {
    setPrefs((p) => ({ ...p, [key]: value }));
  };

  const handleSave = async () => {
    if (!auth.user) return;
    setSaving(true);
    try {
      await saveNotificationPreferences(auth.user.uid, prefs);
    } catch (e) {
      console.error("Failed to save preferences:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleEnablePush = async () => {
    if (!auth.user) return;
    const token = await syncPushTokenForUser(auth.user.uid);
    if (token) {
      setPushToken(token);
      setPermissionStatus("granted");
      updatePref("enabled", true);
    } else {
      setPermissionStatus("denied");
    }
  };

  if (!auth.user) {
    return (
      <Screen>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
          <Card title="通知設定" subtitle="尚未登入">
            <Text style={{ color: theme.colors.muted }}>
              請先到『我的』登入後才能設定通知。
            </Text>
          </Card>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}>
        <Card title="推播通知" subtitle="開啟後即使 App 未開啟也能收到通知">
          {permissionStatus === "denied" ? (
            <View style={{ marginBottom: 12 }}>
              <Pill text="通知權限被拒絕，請到系統設定開啟" />
            </View>
          ) : null}

          {pushToken ? (
            <View style={{ marginBottom: 12 }}>
              <Pill text="已啟用推播通知" kind="accent" />
              <Text
                style={{ color: theme.colors.muted, fontSize: 10, marginTop: 6 }}
                numberOfLines={1}
              >
                Token: {pushToken.slice(0, 30)}...
              </Text>
            </View>
          ) : (
            <Button text="啟用推播通知" kind="primary" onPress={handleEnablePush} />
          )}

          <ToggleRow
            icon="notifications"
            label="通知總開關"
            description="關閉後將不會收到任何推播通知"
            value={prefs.enabled}
            onValueChange={(v) => updatePref("enabled", v)}
          />
        </Card>

        <Card title="通知類型" subtitle="選擇你想收到的通知類型">
          <ToggleRow
            icon="megaphone"
            label="公告通知"
            description="學校公告、系所公告"
            value={prefs.announcements}
            onValueChange={(v) => updatePref("announcements", v)}
            disabled={!prefs.enabled}
          />
          <ToggleRow
            icon="calendar"
            label="活動通知"
            description="活動提醒、報名確認"
            value={prefs.events}
            onValueChange={(v) => updatePref("events", v)}
            disabled={!prefs.enabled}
          />
          <ToggleRow
            icon="chatbubbles"
            label="群組通知"
            description="群組新貼文、公告"
            value={prefs.groups}
            onValueChange={(v) => updatePref("groups", v)}
            disabled={!prefs.enabled}
          />
          <ToggleRow
            icon="document-text"
            label="作業通知"
            description="新作業、截止提醒"
            value={prefs.assignments}
            onValueChange={(v) => updatePref("assignments", v)}
            disabled={!prefs.enabled}
          />
          <ToggleRow
            icon="school"
            label="成績通知"
            description="成績發布通知"
            value={prefs.grades}
            onValueChange={(v) => updatePref("grades", v)}
            disabled={!prefs.enabled}
          />
          <ToggleRow
            icon="mail"
            label="私訊通知"
            description="私人訊息"
            value={prefs.messages}
            onValueChange={(v) => updatePref("messages", v)}
            disabled={!prefs.enabled}
          />
        </Card>

        <Card title="免打擾" subtitle="在指定時段內不會收到通知">
          <ToggleRow
            icon="moon"
            label="啟用免打擾"
            value={prefs.quietHoursEnabled}
            onValueChange={(v) => updatePref("quietHoursEnabled", v)}
            disabled={!prefs.enabled}
          />

          {prefs.quietHoursEnabled && prefs.enabled ? (
            <View style={{ marginTop: 12, gap: 12 }}>
              <TimePicker
                label="開始"
                value={prefs.quietHoursStart}
                onChange={(v) => updatePref("quietHoursStart", v)}
              />
              <TimePicker
                label="結束"
                value={prefs.quietHoursEnd}
                onChange={(v) => updatePref("quietHoursEnd", v)}
              />
              <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
                點擊時間可調整（每次 +1 小時）
              </Text>
            </View>
          ) : null}
        </Card>

        <View style={{ paddingHorizontal: 16 }}>
          <Button
            text={saving ? "儲存中..." : "儲存設定"}
            kind="primary"
            onPress={handleSave}
            disabled={saving || loading}
          />
        </View>

        <Card title="說明" subtitle="">
          <Text style={{ color: theme.colors.muted, lineHeight: 20 }}>
            • 推播通知需要在實機上才能使用{"\n"}
            • 首次啟用時會詢問通知權限{"\n"}
            • 若權限被拒絕，請到系統設定 → 通知 → 找到此 App 並開啟{"\n"}
            • 免打擾時段內的通知會在時段結束後一次顯示
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}
