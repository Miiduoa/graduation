/* eslint-disable */
/**
 * AI Model Manager Screen — 本地 AI 模型下載管理
 * 讓使用者選擇、下載、管理本地 LLM 模型。
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import * as FileSystem from 'expo-file-system/legacy';
import {
  localLLM,
  MODEL_REGISTRY,
  type ModelDownloadProgress,
  type LLMState,
  type LLMRuntimeAvailability,
} from '../services/localLLMInference';
import { localAssistant } from '../services/localAssistant';
import { theme } from '../ui/theme';

const COLORS = theme.colors;

// ═══════════════════════════════════════════════
// Model Metadata — 使用者友善的模型資訊
// ═══════════════════════════════════════════════

interface ModelInfo {
  id: string;
  name: string;
  description: string;
  sizeLabel: string;
  sizeBytes: number;
  quality: '輕量' | '標準' | '完整';
  qualityStars: number; // 1-5
  speedStars: number; // 1-5
  recommended: boolean;
  features: string[];
  badge?: string;
}

const MODEL_INFO: ModelInfo[] = [
  {
    id: 'smollm2-1.7b',
    name: 'SmolLM2 輕量版',
    description: '速度最快，適合基本問答和簡單對話',
    sizeLabel: '1.1 GB',
    sizeBytes: 1_100_000_000,
    quality: '輕量',
    qualityStars: 3,
    speedStars: 5,
    recommended: false,
    features: ['基本問答', '校園資訊', '快速回覆'],
    badge: '最省空間',
  },
  {
    id: 'qwen2.5-3b',
    name: 'Qwen2.5 標準版',
    description: '中英文表現優秀，推理能力強，最佳性價比',
    sizeLabel: '2.1 GB',
    sizeBytes: 2_100_000_000,
    quality: '標準',
    qualityStars: 4,
    speedStars: 4,
    recommended: true,
    features: ['深度推理', '中英文雙語', '工具使用', '多輪對話'],
    badge: '推薦',
  },
  {
    id: 'phi-3.5-mini',
    name: 'Phi-3.5 完整版',
    description: '推理能力最強，適合複雜問題分析',
    sizeLabel: '2.4 GB',
    sizeBytes: 2_400_000_000,
    quality: '完整',
    qualityStars: 5,
    speedStars: 3,
    recommended: false,
    features: ['最強推理', '數學計算', '邏輯分析', '長文理解'],
    badge: '最強大',
  },
];

// ═══════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════

export default function AIModelManagerScreen({ navigation }: any) {
  const [llmState, setLlmState] = useState<LLMState>(localLLM.getState());
  const [downloadProgress, setDownloadProgress] = useState<Record<string, ModelDownloadProgress>>(
    {},
  );
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [isWifi, setIsWifi] = useState(true);
  const [diskSpace, setDiskSpace] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [runtimeAvailability, setRuntimeAvailability] = useState<LLMRuntimeAvailability>(() =>
    localLLM.getRuntimeAvailability(),
  );
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Init ──
  useEffect(() => {
    const unsub = localLLM.subscribe(setLlmState);
    setRuntimeAvailability(localLLM.getRuntimeAvailability());
    loadState();
    checkNetwork();
    checkDiskSpace();

    // Pulse animation for recommended badge
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 1000, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1000, useNativeDriver: true }),
      ]),
    ).start();

    return unsub;
  }, []);

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const downloaded = await localLLM.getDownloadedModels();
      setDownloadedModels(downloaded);

      const status = await localAssistant.getStatus();
      // 只有在模型真正 ready 時才標記為使用中
      if (status.llmState.modelId && status.llmState.status === 'ready') {
        setActiveModel(status.llmState.modelId);
      }
    } catch (e) {
      console.warn('[AIModelManager] loadState error:', e);
    }
    setLoading(false);
  }, []);

  const checkNetwork = useCallback(async () => {
    const state = await NetInfo.fetch();
    setIsWifi(state.type === 'wifi');
  }, []);

  const checkDiskSpace = useCallback(async () => {
    try {
      const free = await FileSystem.getFreeDiskStorageAsync();
      setDiskSpace(free);
    } catch {
      setDiskSpace(null);
    }
  }, []);

  // ── Actions ──

  const handleDownload = useCallback(
    async (modelId: string) => {
      const info = MODEL_INFO.find((m) => m.id === modelId);
      if (!info) return;

      // Wi-Fi check
      const netState = await NetInfo.fetch();
      if (netState.type !== 'wifi') {
        Alert.alert(
          '建議使用 Wi-Fi',
          `${info.name} 大約 ${info.sizeLabel}，使用行動數據下載可能會產生大量費用。確定要繼續嗎？`,
          [
            { text: '取消', style: 'cancel' },
            { text: '繼續下載', onPress: () => startDownload(modelId) },
          ],
        );
        return;
      }

      // Disk space check
      if (diskSpace !== null && diskSpace < info.sizeBytes * 1.2) {
        Alert.alert(
          '儲存空間不足',
          `下載 ${info.name} 需要約 ${info.sizeLabel} 的空間，但你的裝置只剩 ${formatBytes(diskSpace)}。請先清理一些空間。`,
          [{ text: '了解' }],
        );
        return;
      }

      startDownload(modelId);
    },
    [diskSpace],
  );

  const startDownload = useCallback(async (modelId: string) => {
    try {
      const ok = await localLLM.downloadModel(modelId, (progress) => {
        setDownloadProgress((prev) => ({ ...prev, [modelId]: progress }));
      });

      if (ok) {
        setDownloadedModels((prev) => Array.from(new Set([...prev, modelId])));
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
        Alert.alert('下載完成', '模型已下載成功！現在要啟用嗎？', [
          { text: '稍後', style: 'cancel' },
          { text: '立即啟用', onPress: () => handleActivate(modelId) },
        ]);
      } else {
        const errMsg = localLLM.getState().error ?? '下載失敗，請檢查網路連線後重試。';
        Alert.alert('下載失敗', errMsg);
        setDownloadProgress((prev) => {
          const next = { ...prev };
          delete next[modelId];
          return next;
        });
      }
    } catch (e: any) {
      Alert.alert('下載錯誤', e?.message ?? '未知錯誤，請稍後重試。');
      setDownloadProgress((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  }, []);

  const handleActivate = useCallback(async (modelId: string) => {
    try {
      const runtime = localLLM.getRuntimeAvailability();
      setRuntimeAvailability(runtime);
      if (!runtime.available) {
        Alert.alert('啟用失敗', runtime.reason ?? '本地 AI 推理引擎尚未就緒。');
        return;
      }

      const ok = await localLLM.loadModel(modelId);
      if (ok) {
        setActiveModel(modelId);
        await localAssistant.setConfig({ modelId });
        Alert.alert('啟用成功', 'AI 模型已載入，可以開始對話了！');
      } else {
        setActiveModel(null);
        const state = localLLM.getState();
        const errMsg = state.error?.includes('原生模組')
          ? 'AI 推理引擎尚未就緒，請確認 App 已完整安裝後重試。如果問題持續，請嘗試重新安裝 App。'
          : (state.error ?? '模型載入失敗，請重試。');
        Alert.alert('啟用失敗', errMsg);
      }
    } catch (e: any) {
      setActiveModel(null);
      Alert.alert('啟用失敗', '模型載入時發生錯誤，請稍後重試。');
    }
  }, []);

  const handleDelete = useCallback(
    (modelId: string) => {
      const info = MODEL_INFO.find((m) => m.id === modelId);
      Alert.alert(
        '刪除模型',
        `確定要刪除 ${info?.name ?? modelId}？這將釋放 ${info?.sizeLabel ?? '未知'} 的空間。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '刪除',
            style: 'destructive',
            onPress: async () => {
              await localLLM.deleteModel(modelId);
              setDownloadedModels((prev) => prev.filter((id) => id !== modelId));
              if (activeModel === modelId) setActiveModel(null);
              checkDiskSpace();
            },
          },
        ],
      );
    },
    [activeModel],
  );

  // ── Render ──

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator size="large" color={COLORS.accent} style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <Ionicons name="hardware-chip-outline" size={28} color="#fff" />
          </View>
          <Text style={styles.headerTitle}>本地 AI 模型</Text>
          <Text style={styles.headerSub}>
            下載模型後，AI 助理可以完全在你的手機上運行，不需要網路也能使用
          </Text>
        </View>

        {/* Status Bar */}
        <View style={styles.statusBar}>
          <View style={styles.statusItem}>
            <Ionicons
              name={isWifi ? 'wifi' : 'cellular'}
              size={16}
              color={isWifi ? '#34C759' : '#FF9500'}
            />
            <Text style={styles.statusText}>{isWifi ? 'Wi-Fi 已連線' : '行動數據'}</Text>
          </View>
          {diskSpace !== null && (
            <View style={styles.statusItem}>
              <Ionicons name="folder-outline" size={16} color={COLORS.textSecondary} />
              <Text style={styles.statusText}>可用空間：{formatBytes(diskSpace)}</Text>
            </View>
          )}
          {activeModel && (
            <View style={styles.statusItem}>
              <Ionicons name="checkmark-circle" size={16} color="#34C759" />
              <Text style={[styles.statusText, { color: '#34C759' }]}>
                已啟用：{MODEL_INFO.find((m) => m.id === activeModel)?.name ?? activeModel}
              </Text>
            </View>
          )}
        </View>

        {!runtimeAvailability.available && (
          <View style={styles.runtimeNotice}>
            <Ionicons name="construct-outline" size={18} color="#FF9500" />
            <Text style={styles.runtimeNoticeText}>
              {runtimeAvailability.reason ?? '本地 AI 推理引擎尚未就緒。'}
            </Text>
          </View>
        )}

        {/* Model Cards */}
        {MODEL_INFO.map((model) => {
          const isDownloaded = downloadedModels.includes(model.id);
          const isActive = activeModel === model.id;
          const progress = downloadProgress[model.id];
          const isDownloading =
            (llmState.status === 'downloading' && llmState.modelId === model.id) ||
            !!downloadProgress[model.id];
          const canActivate = runtimeAvailability.available;

          return (
            <Animated.View
              key={model.id}
              style={[
                styles.modelCard,
                isActive && styles.modelCardActive,
                model.recommended && { transform: [{ scale: pulseAnim }] },
              ]}
            >
              {/* Badge */}
              {model.badge && (
                <View
                  style={[
                    styles.badge,
                    model.recommended ? styles.badgeRecommended : styles.badgeNormal,
                  ]}
                >
                  <Text style={styles.badgeText}>{model.badge}</Text>
                </View>
              )}

              {/* Model Header */}
              <View style={styles.modelHeader}>
                <Text style={styles.modelName}>{model.name}</Text>
                <Text style={styles.modelSize}>{model.sizeLabel}</Text>
              </View>

              <Text style={styles.modelDesc}>{model.description}</Text>

              {/* Quality / Speed Bars */}
              <View style={styles.statsRow}>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>品質</Text>
                  <View style={styles.starRow}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Ionicons
                        key={`q${i}`}
                        name={i < model.qualityStars ? 'star' : 'star-outline'}
                        size={14}
                        color={i < model.qualityStars ? '#FFD700' : '#D1D5DB'}
                      />
                    ))}
                  </View>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statLabel}>速度</Text>
                  <View style={styles.starRow}>
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Ionicons
                        key={`s${i}`}
                        name={i < model.speedStars ? 'flash' : 'flash-outline'}
                        size={14}
                        color={i < model.speedStars ? '#FF9500' : '#D1D5DB'}
                      />
                    ))}
                  </View>
                </View>
              </View>

              {/* Features */}
              <View style={styles.featuresRow}>
                {model.features.map((f) => (
                  <View key={f} style={styles.featureChip}>
                    <Text style={styles.featureText}>{f}</Text>
                  </View>
                ))}
              </View>

              {/* Error State */}
              {llmState.status === 'error' && llmState.modelId === model.id && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 10,
                    padding: 10,
                    backgroundColor: '#FF3B3010',
                    borderRadius: 8,
                  }}
                >
                  <Ionicons name="alert-circle" size={16} color="#FF3B30" />
                  <Text style={{ color: '#FF3B30', fontSize: 12, flex: 1 }} numberOfLines={3}>
                    {llmState.error ?? '發生錯誤，請稍後重試'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => handleActivate(model.id)}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      backgroundColor: COLORS.accent,
                      borderRadius: 6,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>重試</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Download Progress */}
              {isDownloading && progress && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, { width: `${progress.percent}%` }]} />
                  </View>
                  <Text style={styles.progressText}>
                    {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.totalBytes)} (
                    {progress.percent}%)
                  </Text>
                </View>
              )}

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                {!isDownloaded && !isDownloading && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.downloadBtn]}
                    onPress={() => handleDownload(model.id)}
                  >
                    <Ionicons name="cloud-download-outline" size={18} color="#fff" />
                    <Text style={styles.actionBtnText}>下載模型</Text>
                  </TouchableOpacity>
                )}

                {isDownloaded && !isActive && (
                  <>
                    <TouchableOpacity
                      style={[
                        styles.actionBtn,
                        styles.activateBtn,
                        !canActivate && styles.actionBtnDisabled,
                      ]}
                      onPress={() => handleActivate(model.id)}
                      disabled={!canActivate}
                    >
                      <Ionicons
                        name="power-outline"
                        size={18}
                        color={canActivate ? '#fff' : COLORS.textSecondary}
                      />
                      <Text
                        style={[styles.actionBtnText, !canActivate && styles.actionBtnTextDisabled]}
                      >
                        {canActivate ? '啟用' : '需重建 App'}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.deleteBtn]}
                      onPress={() => handleDelete(model.id)}
                    >
                      <Ionicons name="trash-outline" size={18} color="#FF3B30" />
                    </TouchableOpacity>
                  </>
                )}

                {isActive && (
                  <View style={styles.activeIndicator}>
                    <Ionicons name="checkmark-circle" size={20} color="#34C759" />
                    <Text style={styles.activeText}>使用中</Text>
                  </View>
                )}

                {isDownloading && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.cancelBtn]}
                    onPress={() => localLLM.abort()}
                  >
                    <Ionicons name="close-circle-outline" size={18} color="#FF3B30" />
                    <Text style={[styles.actionBtnText, { color: '#FF3B30' }]}>取消</Text>
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          );
        })}

        {/* Info Section */}
        <View style={styles.infoSection}>
          <Text style={styles.infoTitle}>關於本地 AI</Text>
          <View style={styles.infoItem}>
            <Ionicons name="lock-closed-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.infoText}>所有對話完全在你的手機上處理，不會上傳到任何伺服器</Text>
          </View>
          <View style={styles.infoItem}>
            <Ionicons name="cloud-offline-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.infoText}>下載模型後可離線使用 AI 助理（網路搜尋功能除外）</Text>
          </View>
          <View style={styles.infoItem}>
            <Ionicons name="battery-half-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.infoText}>使用本地 AI 時手機可能會稍微發熱，這是正常現象</Text>
          </View>
          <View style={styles.infoItem}>
            <Ionicons name="trash-bin-outline" size={18} color={COLORS.textSecondary} />
            <Text style={styles.infoText}>隨時可以刪除模型釋放空間，不影響其他功能</Text>
          </View>
        </View>

        {/* Without Model Notice */}
        <View style={styles.fallbackNotice}>
          <Ionicons name="information-circle-outline" size={20} color={COLORS.accent} />
          <Text style={styles.fallbackText}>
            即使不下載模型，AI
            助理仍可使用基本問答功能（校園資訊、課表查詢等），只是無法進行深度推理和自然對話。
          </Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ═══════════════════════════════════════════════
// Styles
// ═══════════════════════════════════════════════

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    padding: 16,
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 20,
    paddingVertical: 12,
  },
  headerIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 8,
  },
  headerSub: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 20,
  },

  // Status
  statusBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
    paddingHorizontal: 4,
  },
  statusItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  runtimeNotice: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#FF950015',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    alignItems: 'flex-start',
  },
  runtimeNoticeText: {
    fontSize: 12,
    color: COLORS.text,
    flex: 1,
    lineHeight: 18,
  },

  // Model Card
  modelCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    position: 'relative',
    overflow: 'hidden',
  },
  modelCardActive: {
    borderColor: '#34C759',
    borderWidth: 2,
  },
  badge: {
    position: 'absolute',
    top: 12,
    right: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  badgeRecommended: {
    backgroundColor: COLORS.accent,
  },
  badgeNormal: {
    backgroundColor: COLORS.textSecondary + '30',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#fff',
  },
  modelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    paddingRight: 70,
  },
  modelName: {
    fontSize: 17,
    fontWeight: '700',
    color: COLORS.text,
  },
  modelSize: {
    fontSize: 13,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  modelDesc: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 12,
    lineHeight: 18,
  },

  // Stats
  statsRow: {
    flexDirection: 'row',
    gap: 24,
    marginBottom: 12,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    fontWeight: '500',
  },
  starRow: {
    flexDirection: 'row',
    gap: 2,
  },

  // Features
  featuresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 14,
  },
  featureChip: {
    backgroundColor: COLORS.accent + '15',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  featureText: {
    fontSize: 11,
    color: COLORS.accent,
    fontWeight: '500',
  },

  // Progress
  progressContainer: {
    marginBottom: 12,
  },
  progressBarBg: {
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 4,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: 3,
  },
  progressText: {
    fontSize: 11,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Actions
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  downloadBtn: {
    backgroundColor: COLORS.accent,
    flex: 1,
    justifyContent: 'center',
  },
  activateBtn: {
    backgroundColor: '#34C759',
    flex: 1,
    justifyContent: 'center',
  },
  deleteBtn: {
    backgroundColor: '#FF3B3015',
    paddingHorizontal: 12,
  },
  cancelBtn: {
    backgroundColor: '#FF3B3015',
    flex: 1,
    justifyContent: 'center',
  },
  actionBtnDisabled: {
    backgroundColor: COLORS.border,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  actionBtnTextDisabled: {
    color: COLORS.textSecondary,
  },
  activeIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  activeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#34C759',
  },

  // Info
  infoSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginTop: 8,
    marginBottom: 12,
  },
  infoTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
    marginBottom: 12,
  },
  infoItem: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    alignItems: 'flex-start',
  },
  infoText: {
    fontSize: 13,
    color: COLORS.textSecondary,
    flex: 1,
    lineHeight: 18,
  },

  // Fallback Notice
  fallbackNotice: {
    flexDirection: 'row',
    gap: 8,
    backgroundColor: COLORS.accent + '10',
    borderRadius: 12,
    padding: 14,
    alignItems: 'flex-start',
  },
  fallbackText: {
    fontSize: 12,
    color: COLORS.text,
    flex: 1,
    lineHeight: 18,
  },
});
