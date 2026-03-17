import React, { useState } from "react";
import {
  Modal,
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "./navigationTheme";
import { theme } from "./theme";
import type { ConflictInfo } from "../services/offline";

type ConflictResolutionModalProps = {
  visible: boolean;
  conflicts: ConflictInfo[];
  onResolve: (
    actionId: string,
    resolution: "keep_local" | "keep_server" | "merge"
  ) => Promise<void>;
  onDismiss: () => void;
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "（無）";
  if (typeof value === "string") return value.length > 50 ? value.slice(0, 50) + "..." : value;
  if (typeof value === "number") return value.toString();
  if (typeof value === "boolean") return value ? "是" : "否";
  if (value instanceof Date) return value.toLocaleString("zh-TW");
  if (Array.isArray(value)) return `[${value.length} 項目]`;
  if (typeof value === "object") return JSON.stringify(value).slice(0, 50) + "...";
  return String(value);
}

function ConflictItem({
  conflict,
  onResolve,
}: {
  conflict: ConflictInfo;
  onResolve: (resolution: "keep_local" | "keep_server" | "merge") => Promise<void>;
}) {
  const [resolving, setResolving] = useState(false);
  const [selectedResolution, setSelectedResolution] = useState<string | null>(null);

  const handleResolve = async (resolution: "keep_local" | "keep_server" | "merge") => {
    setResolving(true);
    setSelectedResolution(resolution);
    try {
      await onResolve(resolution);
    } finally {
      setResolving(false);
      setSelectedResolution(null);
    }
  };

  const collectionLabels: Record<string, string> = {
    announcements: "公告",
    events: "活動",
    groupPosts: "貼文",
    comments: "留言",
    lostFoundItems: "失物招領",
    orders: "訂單",
  };

  const collectionLabel = collectionLabels[conflict.action.collection] || conflict.action.collection;

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.lg,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: "#F59E0B20",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 12,
          }}
        >
          <Ionicons name="git-compare" size={20} color="#F59E0B" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>
            {collectionLabel}資料衝突
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {conflict.action.type === "create" ? "新增" : conflict.action.type === "update" ? "更新" : "刪除"}
            {" · "}
            {new Date(conflict.action.timestamp).toLocaleString("zh-TW")}
          </Text>
        </View>
      </View>

      <Text style={{ color: theme.colors.muted, fontSize: 13, marginBottom: 8 }}>
        以下欄位有衝突：
      </Text>

      {conflict.conflictFields.slice(0, 5).map((field) => (
        <View
          key={field}
          style={{
            backgroundColor: theme.colors.surface2,
            borderRadius: theme.radius.md,
            padding: 12,
            marginBottom: 8,
          }}
        >
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 4 }}>
            {field}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#22C55E", fontSize: 10, marginBottom: 2 }}>本地</Text>
              <Text style={{ color: theme.colors.text, fontSize: 13 }} numberOfLines={2}>
                {formatValue(conflict.clientData[field])}
              </Text>
            </View>
            <View style={{ width: 1, backgroundColor: theme.colors.border }} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: "#3B82F6", fontSize: 10, marginBottom: 2 }}>伺服器</Text>
              <Text style={{ color: theme.colors.text, fontSize: 13 }} numberOfLines={2}>
                {formatValue(conflict.serverData[field])}
              </Text>
            </View>
          </View>
        </View>
      ))}

      {conflict.conflictFields.length > 5 && (
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>
          還有 {conflict.conflictFields.length - 5} 個欄位有衝突...
        </Text>
      )}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
        <Pressable
          onPress={() => handleResolve("keep_local")}
          disabled={resolving}
          style={{
            flex: 1,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: theme.radius.md,
            backgroundColor: "#22C55E20",
            borderWidth: 1,
            borderColor: "#22C55E50",
            alignItems: "center",
            opacity: resolving ? 0.5 : 1,
          }}
        >
          {resolving && selectedResolution === "keep_local" ? (
            <ActivityIndicator size="small" color="#22C55E" />
          ) : (
            <>
              <Ionicons name="phone-portrait" size={16} color="#22C55E" />
              <Text style={{ color: "#22C55E", fontSize: 12, fontWeight: "600", marginTop: 4 }}>
                保留本地
              </Text>
            </>
          )}
        </Pressable>

        <Pressable
          onPress={() => handleResolve("keep_server")}
          disabled={resolving}
          style={{
            flex: 1,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: theme.radius.md,
            backgroundColor: "#3B82F620",
            borderWidth: 1,
            borderColor: "#3B82F650",
            alignItems: "center",
            opacity: resolving ? 0.5 : 1,
          }}
        >
          {resolving && selectedResolution === "keep_server" ? (
            <ActivityIndicator size="small" color="#3B82F6" />
          ) : (
            <>
              <Ionicons name="cloud" size={16} color="#3B82F6" />
              <Text style={{ color: "#3B82F6", fontSize: 12, fontWeight: "600", marginTop: 4 }}>
                保留伺服器
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

export function ConflictResolutionModal({
  visible,
  conflicts,
  onResolve,
  onDismiss,
}: ConflictResolutionModalProps) {
  const [resolvedCount, setResolvedCount] = useState(0);

  const handleResolve = async (
    actionId: string,
    resolution: "keep_local" | "keep_server" | "merge"
  ) => {
    await onResolve(actionId, resolution);
    setResolvedCount((c) => c + 1);
  };

  const remainingConflicts = conflicts.length - resolvedCount;

  if (!visible || remainingConflicts === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onDismiss}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.6)",
          justifyContent: "flex-end",
        }}
      >
        <View
          style={{
            backgroundColor: theme.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: "80%",
            paddingBottom: 34,
          }}
        >
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
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: "#F59E0B20",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="warning" size={20} color="#F59E0B" />
              </View>
              <View>
                <Text style={{ color: theme.colors.text, fontSize: 17, fontWeight: "700" }}>
                  資料同步衝突
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                  {remainingConflicts} 筆資料需要處理
                </Text>
              </View>
            </View>

            <Pressable onPress={onDismiss} hitSlop={10}>
              <Ionicons name="close" size={24} color={theme.colors.muted} />
            </Pressable>
          </View>

          <View style={{ padding: 16 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: theme.colors.surface2,
                padding: 12,
                borderRadius: theme.radius.md,
                marginBottom: 12,
              }}
            >
              <Ionicons name="information-circle" size={18} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, fontSize: 13, flex: 1, lineHeight: 18 }}>
                離線期間您修改的資料與伺服器上的資料有衝突。請選擇要保留哪個版本。
              </Text>
            </View>
          </View>

          <ScrollView
            style={{ paddingHorizontal: 16 }}
            contentContainerStyle={{ paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
            showsVerticalScrollIndicator={false}
          >
            {conflicts.slice(resolvedCount).map((conflict) => (
              <ConflictItem
                key={conflict.action.id}
                conflict={conflict}
                onResolve={(resolution) => handleResolve(conflict.action.id, resolution)}
              />
            ))}
          </ScrollView>

          <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
            <Pressable
              onPress={onDismiss}
              style={{
                paddingVertical: 14,
                borderRadius: theme.radius.md,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
                alignItems: "center",
              }}
            >
              <Text style={{ color: theme.colors.text, fontWeight: "600" }}>稍後處理</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
