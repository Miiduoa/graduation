/* eslint-disable */
import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Screen, Card, Button, AnimatedCard, SectionTitle } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import {
  getOfflineQueue,
  getFailedActions,
  processOfflineQueue,
  retryFailedAction,
  clearFailedActions,
  clearOfflineQueue,
  getOfflineDataSize,
  subscribeToSyncEvents,
  getPendingConflicts,
  resolveConflict,
  clearPendingConflict,
  subscribeToConflicts,
  type QueuedAction,
  type FailedAction,
  type ConflictInfo,
} from "../services/offline";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return date.toLocaleString("zh-TW", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function getCollectionLabel(collection: string): string {
  const labels: Record<string, string> = {
    announcements: "公告",
    events: "活動",
    groupPosts: "貼文",
    comments: "留言",
    lostFoundItems: "失物招領",
    orders: "訂單",
    messages: "訊息",
    seatReservations: "座位預約",
  };
  return labels[collection] || collection;
}

function getActionTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    create: "新增",
    update: "更新",
    delete: "刪除",
  };
  return labels[type] || type;
}

function QueueItem({
  action,
  isFailed,
  onRetry,
}: {
  action: QueuedAction | FailedAction;
  isFailed?: boolean;
  onRetry?: () => void;
}) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  };

  const failedAction = isFailed ? (action as FailedAction) : null;

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: isFailed ? theme.colors.error + "30" : theme.colors.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: isFailed
              ? theme.colors.error + "15"
              : theme.colors.accentSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons
            name={
              action.type === "create"
                ? "add-circle"
                : action.type === "update"
                ? "pencil"
                : "trash"
            }
            size={18}
            color={isFailed ? theme.colors.error : theme.colors.accent}
          />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
            {getActionTypeLabel(action.type)} {getCollectionLabel(action.collection)}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {formatTimestamp(action.timestamp)}
            {action.retryCount > 0 && ` · 重試 ${action.retryCount} 次`}
          </Text>
        </View>

        {isFailed && onRetry && (
          <Pressable
            onPress={handleRetry}
            disabled={retrying}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: theme.radius.md,
              backgroundColor: theme.colors.accent,
              opacity: retrying ? 0.5 : 1,
            }}
          >
            {retrying ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
                重試
              </Text>
            )}
          </Pressable>
        )}
      </View>

      {failedAction?.errorMessage && (
        <View
          style={{
            marginTop: 8,
            padding: 8,
            backgroundColor: theme.colors.error + "10",
            borderRadius: theme.radius.sm,
          }}
        >
          <Text style={{ color: theme.colors.error, fontSize: 12 }}>
            {failedAction.errorMessage}
          </Text>
        </View>
      )}
    </View>
  );
}

function ConflictItem({
  conflict,
  onResolve,
}: {
  conflict: ConflictInfo;
  onResolve: (resolution: "keep_local" | "keep_server" | "merge") => void;
}) {
  const [resolving, setResolving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleResolve = async (resolution: "keep_local" | "keep_server" | "merge") => {
    setResolving(true);
    try {
      await onResolve(resolution);
    } finally {
      setResolving(false);
    }
  };

  return (
    <View
      style={{
        backgroundColor: theme.colors.surface,
        borderRadius: theme.radius.md,
        padding: 12,
        marginBottom: 8,
        borderWidth: 1,
        borderColor: "#F59E0B30",
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: "#F59E0B15",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="git-compare" size={18} color="#F59E0B" />
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "600" }}>
            {getActionTypeLabel(conflict.action.type)} {getCollectionLabel(conflict.action.collection)}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
            {conflict.conflictFields.length} 個欄位衝突
          </Text>
        </View>

        <Pressable onPress={() => setShowDetails(!showDetails)}>
          <Ionicons
            name={showDetails ? "chevron-up" : "chevron-down"}
            size={20}
            color={theme.colors.muted}
          />
        </Pressable>
      </View>

      {showDetails && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 8 }}>
            衝突欄位: {conflict.conflictFields.join(", ")}
          </Text>

          <View
            style={{
              flexDirection: "row",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <View
              style={{
                flex: 1,
                padding: 8,
                backgroundColor: theme.colors.accentSoft,
                borderRadius: theme.radius.sm,
              }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 11, fontWeight: "600", marginBottom: 4 }}>
                您的版本
              </Text>
              {conflict.conflictFields.slice(0, 3).map((field) => (
                <Text key={field} style={{ color: theme.colors.text, fontSize: 11 }} numberOfLines={1}>
                  {field}: {String(conflict.clientData[field] ?? "無")}
                </Text>
              ))}
            </View>

            <View
              style={{
                flex: 1,
                padding: 8,
                backgroundColor: theme.colors.surface2,
                borderRadius: theme.radius.sm,
              }}
            >
              <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "600", marginBottom: 4 }}>
                伺服器版本
              </Text>
              {conflict.conflictFields.slice(0, 3).map((field) => (
                <Text key={field} style={{ color: theme.colors.text, fontSize: 11 }} numberOfLines={1}>
                  {field}: {String(conflict.serverData[field] ?? "無")}
                </Text>
              ))}
            </View>
          </View>
        </View>
      )}

      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Pressable
          onPress={() => handleResolve("keep_local")}
          disabled={resolving}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.accent,
            alignItems: "center",
            opacity: resolving ? 0.5 : 1,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>
            使用我的版本
          </Text>
        </Pressable>

        <Pressable
          onPress={() => handleResolve("keep_server")}
          disabled={resolving}
          style={{
            flex: 1,
            paddingVertical: 8,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            opacity: resolving ? 0.5 : 1,
          }}
        >
          <Text style={{ color: theme.colors.text, fontSize: 12, fontWeight: "600" }}>
            使用伺服器版本
          </Text>
        </Pressable>

        <Pressable
          onPress={() => handleResolve("merge")}
          disabled={resolving}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: theme.radius.sm,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: "center",
            opacity: resolving ? 0.5 : 1,
          }}
        >
          <Ionicons name="git-merge" size={16} color={theme.colors.text} />
        </Pressable>
      </View>

      {resolving && (
        <View style={{ alignItems: "center", marginTop: 8 }}>
          <ActivityIndicator size="small" color={theme.colors.accent} />
        </View>
      )}
    </View>
  );
}

export function OfflineQueueScreen(props: any) {
  const nav = props?.navigation;
  const { isOnline } = useNetworkStatus();

  const [pendingQueue, setPendingQueue] = useState<QueuedAction[]>([]);
  const [failedActions, setFailedActions] = useState<FailedAction[]>([]);
  const [conflicts, setConflicts] = useState<ConflictInfo[]>([]);
  const [dataSize, setDataSize] = useState({ count: 0, approximateBytes: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ processed: number; total: number } | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [queue, failed, size, pendingConflicts] = await Promise.all([
        getOfflineQueue(),
        getFailedActions(),
        getOfflineDataSize(),
        Promise.resolve(getPendingConflicts()),
      ]);
      setPendingQueue(queue);
      setFailedActions(failed);
      setDataSize(size);
      setConflicts(pendingConflicts);
    } catch (error) {
      console.error("Failed to load offline data:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();

    const unsubscribeSyncEvents = subscribeToSyncEvents((event) => {
      switch (event.type) {
        case "sync_start":
          setSyncing(true);
          setSyncProgress({ processed: 0, total: event.total ?? 0 });
          break;
        case "sync_progress":
          setSyncProgress({ processed: event.processed ?? 0, total: event.total ?? 0 });
          break;
        case "sync_complete":
        case "sync_error":
          setSyncing(false);
          setSyncProgress(null);
          loadData();
          break;
        case "conflict":
          // 衝突發生時重新載入資料
          loadData();
          break;
      }
    });

    // 訂閱衝突事件
    const unsubscribeConflicts = subscribeToConflicts(() => {
      loadData();
    });

    return () => {
      unsubscribeSyncEvents();
      unsubscribeConflicts();
    };
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
  };

  const handleSyncNow = async () => {
    if (!isOnline) {
      Alert.alert("無法同步", "目前處於離線狀態，請連接網路後再試");
      return;
    }

    setSyncing(true);
    try {
      const result = await processOfflineQueue();
      if (result.success > 0 || result.failed > 0 || result.conflicts > 0) {
        let message = `成功: ${result.success}`;
        if (result.failed > 0) message += `\n失敗: ${result.failed}`;
        if (result.conflicts > 0) message += `\n衝突: ${result.conflicts} (請在下方解決)`;
        Alert.alert("同步完成", message);
      }
    } catch (error) {
      Alert.alert("同步失敗", "同步過程中發生錯誤，請稍後再試");
    } finally {
      setSyncing(false);
      await loadData();
    }
  };

  const handleResolveConflict = async (
    actionId: string,
    resolution: "keep_local" | "keep_server" | "merge"
  ) => {
    try {
      await resolveConflict(actionId, resolution);
      await loadData();
      
      const resolutionLabel = {
        keep_local: "已保留您的版本",
        keep_server: "已保留伺服器版本",
        merge: "已合併變更",
      }[resolution];
      
      Alert.alert("衝突已解決", resolutionLabel);
    } catch (error) {
      Alert.alert("解決失敗", "無法解決此衝突，請稍後再試");
    }
  };

  const handleRetryFailed = async (actionId: string) => {
    const success = await retryFailedAction(actionId);
    if (success) {
      await loadData();
    }
  };

  const handleClearFailed = () => {
    Alert.alert(
      "清除失敗項目",
      "確定要清除所有失敗的同步項目嗎？這些資料將無法恢復。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清除",
          style: "destructive",
          onPress: async () => {
            await clearFailedActions();
            await loadData();
          },
        },
      ]
    );
  };

  const handleClearPending = () => {
    Alert.alert(
      "清除待同步項目",
      "確定要清除所有待同步項目嗎？這些變更將不會上傳到伺服器。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "清除",
          style: "destructive",
          onPress: async () => {
            await clearOfflineQueue();
            await loadData();
          },
        },
      ]
    );
  };

  const totalItems = pendingQueue.length + failedActions.length + conflicts.length;

  if (loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={theme.colors.accent} />
          <Text style={{ color: theme.colors.muted, marginTop: 12 }}>載入中...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ gap: 12, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.colors.accent}
            colors={[theme.colors.accent]}
          />
        }
      >
        <AnimatedCard title="離線資料狀態" subtitle="">
          <View style={{ alignItems: "center", paddingVertical: 16 }}>
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: isOnline
                  ? conflicts.length > 0
                    ? "#F59E0B15"
                    : totalItems > 0
                    ? "#F59E0B15"
                    : theme.colors.success + "15"
                  : "#F59E0B15",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              <Ionicons
                name={
                  isOnline
                    ? conflicts.length > 0
                      ? "git-compare"
                      : totalItems > 0
                      ? "cloud-upload"
                      : "cloud-done"
                    : "cloud-offline"
                }
                size={32}
                color={
                  isOnline
                    ? conflicts.length > 0
                      ? "#F59E0B"
                      : totalItems > 0
                      ? "#F59E0B"
                      : theme.colors.success
                    : "#F59E0B"
                }
              />
            </View>

            <Text style={{ color: theme.colors.text, fontSize: 18, fontWeight: "700" }}>
              {isOnline
                ? conflicts.length > 0
                  ? `${conflicts.length} 個衝突待解決`
                  : totalItems > 0
                  ? `${totalItems} 筆待同步`
                  : "已同步完成"
                : "離線模式"}
            </Text>

            <Text style={{ color: theme.colors.muted, marginTop: 4 }}>
              快取資料：{formatBytes(dataSize.approximateBytes)}
            </Text>

            {syncing && syncProgress && (
              <View style={{ marginTop: 12, alignItems: "center" }}>
                <ActivityIndicator size="small" color={theme.colors.accent} />
                <Text style={{ color: theme.colors.accent, fontSize: 12, marginTop: 4 }}>
                  同步中 ({syncProgress.processed}/{syncProgress.total})
                </Text>
              </View>
            )}
          </View>

          {totalItems > 0 && isOnline && !syncing && conflicts.length === 0 && (
            <Button
              text="立即同步"
              kind="primary"
              onPress={handleSyncNow}
            />
          )}
        </AnimatedCard>

        {conflicts.length > 0 && (
          <Card
            title="需要解決的衝突"
            subtitle={`${conflicts.length} 個`}
          >
            <View style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <Ionicons name="warning" size={16} color="#F59E0B" />
                <Text style={{ color: "#F59E0B", fontSize: 13, fontWeight: "600" }}>
                  請解決以下衝突後才能繼續同步
                </Text>
              </View>
              <Text style={{ color: theme.colors.muted, fontSize: 12, lineHeight: 18 }}>
                這些資料在您離線時被其他人修改過，請選擇要保留哪個版本。
              </Text>
            </View>

            {conflicts.map((conflict) => (
              <ConflictItem
                key={conflict.action.id}
                conflict={conflict}
                onResolve={(resolution) => handleResolveConflict(conflict.action.id, resolution)}
              />
            ))}
          </Card>
        )}

        {pendingQueue.length > 0 && (
          <Card
            title="待同步項目"
            subtitle={`${pendingQueue.length} 筆`}
          >
            {pendingQueue.slice(0, 10).map((action) => (
              <QueueItem key={action.id} action={action} />
            ))}

            {pendingQueue.length > 10 && (
              <Text style={{ color: theme.colors.muted, textAlign: "center", marginTop: 8 }}>
                還有 {pendingQueue.length - 10} 筆...
              </Text>
            )}

            <View style={{ marginTop: 12 }}>
              <Button
                text="清除全部待同步項目"
                onPress={handleClearPending}
              />
            </View>
          </Card>
        )}

        {failedActions.length > 0 && (
          <Card
            title="同步失敗項目"
            subtitle={`${failedActions.length} 筆`}
          >
            {failedActions.slice(0, 10).map((action) => (
              <QueueItem
                key={action.id}
                action={action}
                isFailed
                onRetry={() => handleRetryFailed(action.id)}
              />
            ))}

            {failedActions.length > 10 && (
              <Text style={{ color: theme.colors.muted, textAlign: "center", marginTop: 8 }}>
                還有 {failedActions.length - 10} 筆...
              </Text>
            )}

            <View style={{ marginTop: 12 }}>
              <Button
                text="清除全部失敗項目"
                onPress={handleClearFailed}
              />
            </View>
          </Card>
        )}

        {totalItems === 0 && (
          <Card title="沒有待同步資料">
            <View style={{ alignItems: "center", paddingVertical: 16 }}>
              <Ionicons name="checkmark-circle" size={48} color={theme.colors.success} />
              <Text style={{ color: theme.colors.text, marginTop: 12 }}>
                所有資料都已同步完成
              </Text>
            </View>
          </Card>
        )}

        <Card title="關於離線同步" subtitle="">
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Ionicons name="cloud-upload-outline" size={20} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                當您處於離線狀態時，所有變更會暫存在裝置上，待網路恢復後自動同步。
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Ionicons name="warning-outline" size={20} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                如果同步時發生衝突（例如其他人同時修改了相同資料），系統會提示您選擇要保留的版本。
              </Text>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Ionicons name="trash-outline" size={20} color={theme.colors.muted} />
              <Text style={{ color: theme.colors.muted, flex: 1, lineHeight: 20 }}>
                清除待同步項目會導致這些變更遺失，請謹慎操作。
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}
