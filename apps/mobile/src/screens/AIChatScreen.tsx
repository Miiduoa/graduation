/* eslint-disable */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  ScrollView,
  Text,
  View,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Notifications from 'expo-notifications';
import { Screen } from '../ui/components';
import type { AssistantActionProposal } from '../data';
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from '../ui/navigationTheme';
import { theme } from '../ui/theme';
import { useSchool } from '../state/school';
import { useAuth } from '../state/auth';
import { useDataSource } from '../hooks/useDataSource';
import { useAsyncList } from '../hooks/useAsyncList';
import { useSchedule } from '../state/schedule';
import {
  chatWithCampusAssistant,
  chatWithLocalLLMStreaming,
  getAIStatus,
  submitFeedback,
  type AIMessage,
  type AIContext,
  type StreamingCallback,
} from '../services/ai';
import { toDate } from '../utils/format';
import {
  clearAIChatHistory,
  getAIChatHistoryStorageKey,
  loadAIChatHistory,
  loadAiPersonalContext,
  saveAIChatHistory,
  type AiPersonalContext,
} from '../features/ai';
import { loadPersistedValue, savePersistedValue } from '../services/persistedStorage';
import { earnXP } from '../services/gamificationEngine';
import {
  loadProactiveAIReports,
  markProactiveAIReportsSeen,
  type ProactiveAIReport,
} from '../services/proactiveAI';
import { isEffectivelyOnline } from '../services/offline';
import { executeAgentToolAction, type AIActionExecutionResult } from '../services/aiActionExecutor';
import {
  buildAIAppContext,
  emptyAIAppRuntimeData,
  loadAIAppRuntimeData,
  type AIAppRuntimeData,
} from '../services/aiAppContext';
import { shouldUseWebSearch } from '../services/webSearch';
import { buildNavigationTarget, navigateToTarget } from '../utils/courseNavigation';
import {
  getPuDiningCafeterias,
  getPuDiningMenuItems,
  hasPuOfficialCafeteriaName,
  hasPuOfficialMenuSignal,
  isProvidenceDiningSchoolId,
} from '../data/puDiningCatalog';
import type { Cafeteria, MenuItem } from '../data/types';
import {
  createAIBrain,
  understandQuery,
  trainFromFeedback,
  updateBrainContext,
  composeResponse,
  trainNgramOnResponse,
  trainEmbeddingOnSentence,
  advancedTokenize,
  semanticSimilarity,
  serializeBrain,
  deserializeBrain,
  getContextSummary,
  getSlotValue,
  getMemoryValue,
  indexDocument,
  hybridRetrieve,
  heuristicHelpful,
  autoLearnFromTurn,
  summaryToText,
  distillFromGeminiResponse,
  evaluateResponseQuality,
  contextualEnhance,
  composeStructuredResponse,
  inferContextualFactors,
  AI_BRAIN_STORAGE_KEY,
  type LocalAIBrain,
  type IntentLabel,
  type ResponseStrategy,
  type ResponseCandidate,
  type RetrievalResult,
  type ReasoningChain,
  type ClarificationRequest,
  type ContextualFactors,
} from '../services/localAIEngine';
import {
  AGENT_TOOLS,
  TASK_CHAINS,
  PROACTIVE_TRIGGERS,
  AGENT_ROLE_CONFIG,
  getToolById,
  matchTaskChain,
  getAgentCapabilitySummary,
  simulateAgentGreeting,
  simulateRecentExecutions,
  simulateProactiveMessages,
  getDefaultMemory,
  getInitialContext,
  getMemoryStorageKey,
  extractLearnableFacts,
  mergeLearnedFacts,
  addRecentAction,
  buildThinkingChain,
  type AgentTool,
  type AgentRole,
  type ToolExecution,
  type ToolExecutionStatus,
  type TaskChain,
  type TaskStep,
  type ConversationState,
  type ConversationContext,
  type ProactiveTrigger,
  type AgentMemory,
  type ToolParameter,
  type ThinkingStep,
  type RecentAction,
  buildKnowledgeGraph,
  detectInteractionPatterns,
  recordCorrection,
  queryKnowledgeGraph,
  getDefaultLearningState,
  type ActiveLearningState,
  type KnowledgeNode,
  // Local AI engine
  addTrainingPair,
  updatePairQuality,
  exportTrainingInsights,
  getDefaultTrainingDB,
  getTrainingDBStorageKey,
  generateLocalAnswer,
  getLocalConfidence,
  autoTagQuestion,
  normalizeLocalTrainingDB,
  type LocalTrainingDB,
} from '../data/puAIAgentData';

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

const CHAT_HISTORY_MAX = 50;

// Unique message ID generator — prevents React key collisions
let _msgIdSeq = 0;
function genMsgId(prefix = 'msg'): string {
  _msgIdSeq += 1;
  return `${prefix}-${Date.now()}-${_msgIdSeq}-${Math.random().toString(36).slice(2, 5)}`;
}

type MessageRole = 'user' | 'assistant' | 'system';

type AgentMessageType =
  | 'text' // 純文字
  | 'thinking' // 思考過程
  | 'tool_confirm' // 確認執行工具
  | 'tool_executing' // 執行中
  | 'tool_result' // 執行結果
  | 'chain_progress' // 任務鏈進度
  | 'param_collect' // 收集參數
  | 'proactive' // 主動推播
  | 'capability_card'; // 能力展示卡

type ThinkingStepUI = {
  step: string;
  detail: string;
  status: 'done' | 'checking' | 'warning' | 'info';
};

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  suggestions?: string[];
  actions?: AssistantActionProposal[];
  agentType?: AgentMessageType;
  toolExecution?: ToolExecution;
  chainProgress?: { chain: TaskChain; currentStep: number; completedSteps: number[] };
  paramCollect?: { tool: AgentTool; collected: Record<string, any>; nextParam: ToolParameter };
  proactiveTrigger?: ProactiveTrigger;
  thinkingSteps?: ThinkingStepUI[];
};

const DINING_CAFETERIA_VALUE_LABELS: Record<string, string> = {
  jingyuan: '靜園餐廳',
  yiyuan: '宜園餐廳',
  'zhishan-1f': '至善美食廣場一樓',
  'zhishan-2f': '至善美食廣場二樓',
  shawmu: '小木屋鬆餅',
  okmart: 'OK 便利商店',
  main_cafeteria: '靜園餐廳',
  campus: '校內餐廳',
  convenience: 'OK 便利商店',
  drinks: '校內飲料櫃位',
};

const DINING_FOOD_KEYWORDS = [
  '飲料',
  '水果杯',
  '吐司',
  '漢堡',
  '蛋餅',
  '鐵板麵',
  '炸牛排',
  '雞腿排',
  '酸辣粉',
  '螺獅粉',
  '自助餐',
  '素食餐檯',
  '自選餐盒',
  '滷味',
  '壽喜燒飯盒',
  '鍋貼',
  '咖哩飯',
  '麻醬麵',
  '蛋炒飯',
  '炒泡麵',
  '鍋燒麵',
  '酸菜魚',
  '車輪餅',
  '雞蛋糕',
  '豆漿',
  '家常餐',
  '茶飲',
  '炸雞',
  '快餐',
  '漢堡',
  '飯捲',
  '拉麵',
  '咖啡',
  '鬆餅',
  '飯糰',
  '微波鮮食',
  '茶葉蛋',
];

function compactText(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[\s｜|、，,。．.（）()【】\[\]{}「」『』\-—_]/g, '');
}

function diningMenuKey(menu: MenuItem): string {
  return `${menu.cafeteria ?? ''}::${menu.name ?? ''}`;
}

function formatDiningPrice(menu?: Pick<MenuItem, 'price'> | null): string {
  return typeof menu?.price === 'number' ? `$${menu.price}` : '價格未提供';
}

function resolveDiningCafeteriaLabel(value: unknown, cafeterias: Cafeteria[]): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '校內餐廳';
  if (DINING_CAFETERIA_VALUE_LABELS[raw]) return DINING_CAFETERIA_VALUE_LABELS[raw];
  const found = cafeterias.find(
    (cafeteria) =>
      cafeteria.id === raw || cafeteria.name.includes(raw) || raw.includes(cafeteria.name),
  );
  return found?.name ?? raw;
}

function parseSmallPositiveInt(value: unknown): number | null {
  const normalized = String(value ?? '').replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );
  const digit = normalized.match(/[1-9]/)?.[0];
  if (digit) return Number(digit);
  const chineseDigit = normalized.match(/[一二三四五六七八九十]/)?.[0];
  const map: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  return chineseDigit ? (map[chineseDigit] ?? null) : null;
}

function parseDiningChoiceIndex(message: string): number | null {
  const normalized = message.replace(/[０-９]/g, (digit) =>
    String.fromCharCode(digit.charCodeAt(0) - 0xfee0),
  );
  const explicitChoice = normalized.match(/第\s*([1-9一二三四五六七八九十])\s*(?:道|個|項|號|份)?/);
  if (explicitChoice) return parseSmallPositiveInt(explicitChoice[1]);
  const suffixChoice = normalized.match(/([1-9一二三四五六七八九十])\s*(?:道|個|項|號|份)/);
  return suffixChoice ? parseSmallPositiveInt(suffixChoice[1]) : null;
}

function parseDiningRecommendationLine(
  line: string,
): { index: number; itemName: string; cafeteria?: string } | null {
  const match = line.match(/^\s*(\d+)[\.\、]\s*(.+?)\s*$/);
  if (!match) return null;

  let itemName = match[2].trim();
  let cafeteria: string | undefined;
  const cafeteriaMatch = itemName.match(/（([^）]+)）\s*$/);
  if (cafeteriaMatch) {
    cafeteria = cafeteriaMatch[1].trim();
    itemName = itemName.slice(0, cafeteriaMatch.index).trim();
  }
  itemName = itemName.replace(/\s+[—-]\s*.*$/, '').trim();
  if (!itemName || /公車|課程|作業|公告|活動|步驟/.test(itemName)) return null;

  return { index: Number(match[1]), itemName, cafeteria };
}

function resolveAgentRoleFromProfile(profile: unknown): AgentRole {
  const p = (profile ?? {}) as {
    role?: string | null;
    serviceRoles?: string[] | null;
    merchantAssignments?: unknown[] | null;
  };
  if (Array.isArray(p.merchantAssignments) && p.merchantAssignments.length > 0) return 'vendor';
  if (Array.isArray(p.serviceRoles) && p.serviceRoles.includes('vendor')) return 'vendor';
  if (p.role === 'admin') return 'admin';
  if (p.role === 'staff') return 'staff';
  if (p.role === 'teacher' || p.role === 'professor' || p.role === 'principal') return 'faculty';
  return 'student';
}

function messageFromProactiveReport(report: ProactiveAIReport): Message {
  return {
    id: `proactive-${report.id}`,
    role: 'assistant',
    content: `主動回報｜${report.title}\n\n${report.body}`,
    timestamp: new Date(report.createdAt),
    suggestions: report.suggestions,
    actions: report.actions,
    agentType: 'proactive',
  };
}

// ═══════════════════════════════════════════════════
// Sub-Components
// ═══════════════════════════════════════════════════

function TypingIndicator() {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    const createAnimation = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, useNativeDriver: true }),
        ]),
      );
    const a1 = createAnimation(dot1, 0);
    const a2 = createAnimation(dot2, 150);
    const a3 = createAnimation(dot3, 300);
    animationsRef.current = [a1, a2, a3];
    a1.start();
    a2.start();
    a3.start();
    return () => {
      animationsRef.current.forEach((a) => a.stop());
      dot1.setValue(0);
      dot2.setValue(0);
      dot3.setValue(0);
    };
  }, [dot1, dot2, dot3]);

  return (
    <View style={{ flexDirection: 'row', gap: 4, padding: 12 }}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.colors.accent,
            opacity: dot,
          }}
        />
      ))}
    </View>
  );
}

// ── Thinking Bubble ──
function ThinkingBubble(props: { steps: ThinkingStepUI[]; collapsed?: boolean }) {
  const { steps, collapsed } = props;
  const [isExpanded, setIsExpanded] = useState(!collapsed);
  const statusIcon: Record<string, { icon: string; color: string }> = {
    done: { icon: 'checkmark-circle', color: '#10B981' },
    checking: { icon: 'sync-outline', color: '#6366F1' },
    warning: { icon: 'alert-circle', color: '#F59E0B' },
    info: { icon: 'information-circle', color: '#3B82F6' },
  };

  return (
    <Pressable
      onPress={() => setIsExpanded((e) => !e)}
      style={{
        backgroundColor: `${theme.colors.accent}08`,
        borderRadius: 12,
        padding: 10,
        borderWidth: 1,
        borderColor: `${theme.colors.accent}15`,
        marginBottom: 6,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Ionicons name="bulb-outline" size={14} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: '600', flex: 1 }}>
          思考過程
        </Text>
        <Ionicons
          name={isExpanded ? 'chevron-up' : 'chevron-down'}
          size={14}
          color={theme.colors.muted}
        />
      </View>
      {isExpanded && (
        <View style={{ marginTop: 8, gap: 4 }}>
          {steps.map((s, i) => {
            const si = statusIcon[s.status] ?? statusIcon.info;
            return (
              <View
                key={i}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingLeft: 4 }}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
                  {i < steps.length - 1 ? '├' : '└'}
                </Text>
                <Ionicons
                  name={si.icon as any}
                  size={12}
                  color={si.color}
                  style={{ marginTop: 1 }}
                />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 12 }}>
                    <Text style={{ fontWeight: '600' }}>{s.step}</Text>
                    <Text style={{ color: theme.colors.muted }}> {s.detail}</Text>
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </Pressable>
  );
}

// ── Tool Confirmation Card ──
function ToolConfirmCard(props: {
  execution: ToolExecution;
  tool: AgentTool | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { execution, tool, onConfirm, onCancel } = props;
  if (!tool) return null;
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface2,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: `${tool.color}30`,
        marginTop: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: `${tool.color}20`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ionicons name={tool.icon as any} size={18} color={tool.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15 }}>
            {tool.name}
          </Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{tool.description}</Text>
        </View>
      </View>
      {/* Parameters */}
      <View
        style={{
          backgroundColor: `${tool.color}08`,
          borderRadius: 10,
          padding: 12,
          marginBottom: 12,
        }}
      >
        {Object.entries(execution.params)
          .filter(([key]) => !key.startsWith('__'))
          .map(([key, val]) => {
            const paramDef = tool.parameters.find((p) => p.name === key);
            return (
              <View
                key={key}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 3,
                }}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 13 }}>
                  {paramDef?.label ?? key}
                </Text>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '600' }}>
                  {paramDef?.type === 'select'
                    ? (paramDef.options?.find((o) => o.value === val)?.label ?? String(val))
                    : String(val)}
                </Text>
              </View>
            );
          })}
      </View>
      {execution.confirmationMessage && (
        <Text
          style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 10, fontStyle: 'italic' }}
        >
          {execution.confirmationMessage}
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Pressable
          onPress={onCancel}
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: theme.colors.surface2,
            borderWidth: 1,
            borderColor: theme.colors.border,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: theme.colors.muted, fontWeight: '600' }}>取消</Text>
        </Pressable>
        <Pressable
          onPress={onConfirm}
          style={{
            flex: 2,
            paddingVertical: 10,
            borderRadius: 10,
            backgroundColor: tool.color,
            alignItems: 'center',
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>確認執行</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Tool Execution Status Card ──
function ToolStatusCard(props: { execution: ToolExecution; tool: AgentTool | undefined }) {
  const { execution, tool } = props;
  if (!tool) return null;
  const statusConfig: Record<ToolExecutionStatus, { icon: string; color: string; label: string }> =
    {
      pending: { icon: 'hourglass-outline', color: '#F59E0B', label: '等待中' },
      confirming: { icon: 'help-circle-outline', color: '#3B82F6', label: '待確認' },
      executing: { icon: 'sync-outline', color: '#6366F1', label: '執行中' },
      success: { icon: 'checkmark-circle', color: '#10B981', label: '完成' },
      failed: { icon: 'close-circle', color: '#EF4444', label: '失敗' },
      cancelled: { icon: 'ban-outline', color: '#6B7280', label: '已取消' },
    };
  const sc = statusConfig[execution.status];
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface2,
        borderRadius: 14,
        padding: 14,
        borderLeftWidth: 3,
        borderLeftColor: sc.color,
        marginTop: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {execution.status === 'executing' ? (
          <ActivityIndicator size="small" color={sc.color} />
        ) : (
          <Ionicons name={sc.icon as any} size={18} color={sc.color} />
        )}
        <Text style={{ color: sc.color, fontWeight: '700', fontSize: 14 }}>
          {tool.name} — {sc.label}
        </Text>
      </View>
      {execution.result && (
        <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 20, marginTop: 2 }}>
          {execution.result}
        </Text>
      )}
      {execution.error && (
        <Text style={{ color: '#EF4444', fontSize: 13, lineHeight: 20, marginTop: 2 }}>
          {execution.error}
        </Text>
      )}
    </View>
  );
}

// ── Chain Progress Card ──
function ChainProgressCard(props: {
  chain: TaskChain;
  currentStep: number;
  completedSteps: number[];
  onSkipStep?: () => void;
}) {
  const { chain, currentStep, completedSteps, onSkipStep } = props;
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface2,
        borderRadius: 16,
        padding: 16,
        borderWidth: 1,
        borderColor: `${chain.color}30`,
        marginTop: 4,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <Ionicons name={chain.icon as any} size={20} color={chain.color} />
        <Text style={{ color: theme.colors.text, fontWeight: '700', fontSize: 15, flex: 1 }}>
          {chain.name}
        </Text>
        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
          {completedSteps.length}/{chain.steps.length}
        </Text>
      </View>
      {chain.steps.map((step) => {
        const isDone = completedSteps.includes(step.order);
        const isCurrent = step.order === currentStep;
        const tool = getToolById(step.toolId);
        return (
          <View
            key={step.order}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 12,
                backgroundColor: isDone
                  ? '#10B981'
                  : isCurrent
                    ? chain.color
                    : theme.colors.surface2,
                borderWidth: isCurrent ? 0 : 1,
                borderColor: theme.colors.border,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isDone ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : isCurrent ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: theme.colors.muted, fontSize: 10, fontWeight: '700' }}>
                  {step.order}
                </Text>
              )}
            </View>
            <Text
              style={{
                color: isDone ? '#10B981' : isCurrent ? theme.colors.text : theme.colors.muted,
                fontSize: 13,
                fontWeight: isCurrent ? '700' : '400',
                flex: 1,
                textDecorationLine: isDone ? 'line-through' : 'none',
              }}
            >
              {step.label}
            </Text>
            {step.optional && isCurrent && (
              <Pressable
                onPress={onSkipStep}
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: theme.colors.surface2,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                }}
              >
                <Text style={{ color: theme.colors.muted, fontSize: 11 }}>跳過</Text>
              </Pressable>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Proactive Suggestion Banner ──
function ProactiveBanner(props: {
  trigger: ProactiveTrigger;
  message: string;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const { trigger, message, onAction, onDismiss } = props;
  return (
    <Pressable
      onPress={onAction}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        backgroundColor: `${trigger.color}12`,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: `${trigger.color}25`,
        marginBottom: 8,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: `${trigger.color}20`,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Ionicons name={trigger.icon as any} size={16} color={trigger.color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 19 }}>{message}</Text>
      </View>
      <Pressable onPress={onDismiss} hitSlop={8}>
        <Ionicons name="close" size={16} color={theme.colors.muted} />
      </Pressable>
    </Pressable>
  );
}

// ── Param Collection Inline ──
function ParamCollectRow(props: { param: ToolParameter; onSelect: (value: string) => void }) {
  const { param, onSelect } = props;
  if (param.type === 'select' && param.options) {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
          {param.label}：
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {param.options.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: theme.colors.accentSoft,
                borderWidth: 1,
                borderColor: `${theme.colors.accent}40`,
              }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }
  if (param.type === 'multi_select' && param.options) {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>
          {param.label}（可多選，選完輸入任意文字繼續）：
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {param.options.map((opt) => (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 7,
                borderRadius: 999,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
              }}
            >
              <Text style={{ color: theme.colors.text, fontSize: 13 }}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }
  return (
    <View style={{ marginTop: 6 }}>
      <Text style={{ color: theme.colors.muted, fontSize: 12 }}>
        請輸入 {param.label}
        {param.hint ? `（${param.hint}）` : ''}：
      </Text>
    </View>
  );
}

// ── Capability Showcase (shows on first launch) ──
function CapabilityGrid(props: {
  role: AgentRole;
  onTryTool: (prompt: string) => void;
  offline?: boolean;
}) {
  const { role, onTryTool, offline } = props;
  const capabilities = getAgentCapabilitySummary(role);
  const quickPrompts: Record<string, string> = offline
    ? {
        cafeteria: '幫我訂午餐',
        health: '我有點頭痛，幫我評估',
        library: '圖書館座位怎麼預約',
        dorm: '宿舍冷氣壞了，幫我寫報修草稿',
        lost_found: '我在圖書館掉了學生證，幫我寫公告',
        print: '列印服務在哪裡',
        course: '幫我寫請假信草稿',
        transport: '怎麼搭公車到台中車站',
        calendar: '提醒我明天下午交作業要怎麼設定',
        social: '幫我寫訊息草稿',
      }
    : {
        cafeteria: '幫我推薦今天午餐',
        health: '我有點頭痛，幫我評估',
        library: '幫我預約圖書館座位',
        dorm: '宿舍冷氣壞了，幫我報修',
        lost_found: '我在圖書館掉了學生證',
        print: '查詢列印餘額',
        course: '幫我請明天的病假',
        transport: '查公車到站時間',
        calendar: '提醒我明天下午交作業',
        social: '發訊息給我的課程群組',
      };
  const tools = AGENT_TOOLS.filter((t) => t.roleAccess.includes(role));
  const categories = Array.from(new Set(tools.map((t) => t.category)));

  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      {categories.slice(0, 5).map((cat) => {
        const catTools = tools.filter((t) => t.category === cat);
        const firstTool = catTools[0];
        if (!firstTool) return null;
        return (
          <Pressable
            key={cat}
            onPress={() => onTryTool(quickPrompts[cat] ?? `幫我${firstTool.name}`)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingVertical: 8,
              paddingHorizontal: 12,
              backgroundColor: `${firstTool.color}08`,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: `${firstTool.color}15`,
            }}
          >
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: `${firstTool.color}18`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Ionicons name={firstTool.icon as any} size={14} color={firstTool.color} />
            </View>
            <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
              {catTools
                .map((t) =>
                  offline && t.requiresConfirmation && t.id !== 'order_meal'
                    ? `${t.name}草稿`
                    : t.name,
                )
                .join(' / ')}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={theme.colors.muted} />
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Recent Executions Preview ──
function RecentExecutionsBar(props: { executions: ToolExecution[] }) {
  const { executions } = props;
  if (executions.length === 0) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '600', marginBottom: 6 }}>
        最近操作
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {executions.map((exec) => {
          const tool = getToolById(exec.toolId);
          if (!tool) return null;
          const isSuccess = exec.status === 'success';
          return (
            <View
              key={exec.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: isSuccess ? '#10B98115' : '#EF444415',
                borderWidth: 1,
                borderColor: isSuccess ? '#10B98125' : '#EF444425',
              }}
            >
              <Ionicons
                name={isSuccess ? 'checkmark-circle' : 'close-circle'}
                size={14}
                color={isSuccess ? '#10B981' : '#EF4444'}
              />
              <Text style={{ color: theme.colors.text, fontSize: 12 }}>{tool.name}</Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

// ── Message Bubble (Enhanced) ──
function MessageBubble(props: {
  message: Message;
  onAction?: (proposal: AssistantActionProposal) => void;
  onSuggestion?: (text: string) => void;
  onFeedback?: (messageId: string, rating: 'thumbs_up' | 'thumbs_down') => void;
  onConfirmTool?: (executionId: string) => void;
  onCancelTool?: (executionId: string) => void;
  onParamSelect?: (value: string) => void;
  onSkipChainStep?: () => void;
  onProactiveAction?: (triggerId: string) => void;
}) {
  const {
    message,
    onAction,
    onSuggestion,
    onFeedback,
    onConfirmTool,
    onCancelTool,
    onParamSelect,
    onSkipChainStep,
    onProactiveAction,
  } = props;
  const isUser = message.role === 'user';
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(isUser ? 20 : -20)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current = Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }),
    ]);
    animRef.current.start();
    return () => {
      animRef.current?.stop();
    };
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        transform: [{ translateX: slideAnim }],
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: isUser ? '85%' : '92%',
        marginVertical: 4,
      }}
    >
      {/* Agent avatar for non-user messages */}
      {!isUser && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              backgroundColor: '#6366F1',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="flash" size={12} color="#fff" />
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: '600' }}>
            AI Agent
          </Text>
          {message.agentType && message.agentType !== 'text' && (
            <View
              style={{
                paddingHorizontal: 6,
                paddingVertical: 1,
                borderRadius: 4,
                backgroundColor: '#6366F115',
              }}
            >
              <Text style={{ color: '#6366F1', fontSize: 9, fontWeight: '600' }}>
                {message.agentType === 'tool_confirm'
                  ? '確認'
                  : message.agentType === 'tool_executing'
                    ? '執行中'
                    : message.agentType === 'tool_result'
                      ? '結果'
                      : message.agentType === 'chain_progress'
                        ? '任務鏈'
                        : message.agentType === 'param_collect'
                          ? '收集資訊'
                          : message.agentType === 'proactive'
                            ? '主動建議'
                            : ''}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Thinking Steps */}
      {!isUser && message.thinkingSteps && message.thinkingSteps.length > 0 && (
        <ThinkingBubble
          steps={message.thinkingSteps}
          collapsed={message.agentType !== 'thinking'}
        />
      )}

      {/* Main bubble */}
      {message.content.length > 0 && (
        <View
          style={{
            padding: 14,
            borderRadius: 18,
            borderBottomRightRadius: isUser ? 4 : 18,
            borderBottomLeftRadius: isUser ? 18 : 4,
            backgroundColor: isUser ? theme.colors.accent : theme.colors.surface2,
            borderWidth: isUser ? 0 : 1,
            borderColor: theme.colors.border,
          }}
        >
          <Text
            style={{ color: isUser ? '#fff' : theme.colors.text, lineHeight: 22, fontSize: 14 }}
          >
            {message.content}
          </Text>
        </View>
      )}

      {/* Tool Confirm Card */}
      {message.agentType === 'tool_confirm' && message.toolExecution && (
        <ToolConfirmCard
          execution={message.toolExecution}
          tool={getToolById(message.toolExecution.toolId)}
          onConfirm={() => onConfirmTool?.(message.toolExecution!.id)}
          onCancel={() => onCancelTool?.(message.toolExecution!.id)}
        />
      )}

      {/* Tool Status Card */}
      {(message.agentType === 'tool_executing' || message.agentType === 'tool_result') &&
        message.toolExecution && (
          <ToolStatusCard
            execution={message.toolExecution}
            tool={getToolById(message.toolExecution.toolId)}
          />
        )}

      {/* Chain Progress */}
      {message.agentType === 'chain_progress' && message.chainProgress && (
        <ChainProgressCard
          chain={message.chainProgress.chain}
          currentStep={message.chainProgress.currentStep}
          completedSteps={message.chainProgress.completedSteps}
          onSkipStep={onSkipChainStep}
        />
      )}

      {/* Param Collection */}
      {message.agentType === 'param_collect' && message.paramCollect && (
        <ParamCollectRow
          param={message.paramCollect.nextParam}
          onSelect={(v) => onParamSelect?.(v)}
        />
      )}

      {/* Suggestions */}
      {message.suggestions && message.suggestions.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {message.suggestions.map((s, i) => (
            <Pressable
              key={i}
              onPress={() => onSuggestion?.(s)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 999,
                backgroundColor: theme.colors.accentSoft,
                borderWidth: 1,
                borderColor: `${theme.colors.accent}40`,
              }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Action buttons */}
      {message.actions && message.actions.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          {message.actions.map((a, i) => (
            <Pressable
              key={i}
              onPress={() => onAction?.(a)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: theme.radius.md,
                backgroundColor: a.requiresConfirmation
                  ? `${theme.colors.warning}12`
                  : theme.colors.surface2,
                borderWidth: 1,
                borderColor: a.requiresConfirmation
                  ? `${theme.colors.warning}55`
                  : theme.colors.border,
              }}
            >
              <Ionicons
                name={a.requiresConfirmation ? 'shield-checkmark-outline' : 'open-outline'}
                size={14}
                color={a.requiresConfirmation ? theme.colors.warning : theme.colors.accent}
              />
              <Text style={{ color: theme.colors.text, fontSize: 13 }}>
                {a.label}
                {a.requiresConfirmation ? '（需確認）' : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Timestamp + Feedback */}
      <View
        style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, marginLeft: 4, gap: 8 }}
      >
        <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
        {!isUser && message.id !== 'greeting' && (
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <Pressable
              onPress={() => {
                setFeedbackGiven('thumbs_up');
                onFeedback?.(message.id, 'thumbs_up');
              }}
              style={{ padding: 4, opacity: feedbackGiven === 'thumbs_down' ? 0.3 : 1 }}
              disabled={!!feedbackGiven}
            >
              <Ionicons
                name={feedbackGiven === 'thumbs_up' ? 'thumbs-up' : 'thumbs-up-outline'}
                size={14}
                color={feedbackGiven === 'thumbs_up' ? theme.colors.accent : theme.colors.muted}
              />
            </Pressable>
            <Pressable
              onPress={() => {
                setFeedbackGiven('thumbs_down');
                onFeedback?.(message.id, 'thumbs_down');
              }}
              style={{ padding: 4, opacity: feedbackGiven === 'thumbs_up' ? 0.3 : 1 }}
              disabled={!!feedbackGiven}
            >
              <Ionicons
                name={feedbackGiven === 'thumbs_down' ? 'thumbs-down' : 'thumbs-down-outline'}
                size={14}
                color={feedbackGiven === 'thumbs_down' ? '#e74c3c' : theme.colors.muted}
              />
            </Pressable>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ═══════════════════════════════════════════════════
// Main Screen
// ═══════════════════════════════════════════════════

export function AIChatScreen(props: any) {
  const nav = props?.navigation;
  const { school } = useSchool();
  const auth = useAuth();
  const ds = useDataSource();
  const scrollRef = useRef<ScrollView>(null);
  const { courses } = useSchedule();

  // ── State ──
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [aiStatus] = useState(() => getAIStatus());
  const isOfflineAI = aiStatus.provider === 'offline' || aiStatus.provider === 'mock';
  const [pendingAssignments, setPendingAssignments] = useState<
    AiPersonalContext['pendingAssignments']
  >([]);
  const [weeklyReport, setWeeklyReport] = useState<AiPersonalContext['weeklyReport']>(null);
  const [appRuntimeData, setAppRuntimeData] = useState<AIAppRuntimeData>(() =>
    emptyAIAppRuntimeData(),
  );
  const [latestProactiveReports, setLatestProactiveReports] = useState<ProactiveAIReport[]>([]);
  const [showCapabilities, setShowCapabilities] = useState(true);
  const [recentExecutions, setRecentExecutions] = useState<ToolExecution[]>(() =>
    isOfflineAI ? [] : simulateRecentExecutions(),
  );
  const [proactiveMessages, setProactiveMessages] = useState(() =>
    isOfflineAI ? [] : simulateProactiveMessages(),
  );
  const [agentContext, setAgentContext] = useState<ConversationContext>(() => getInitialContext());
  const [agentMemory, setAgentMemory] = useState<AgentMemory>(() =>
    getDefaultMemory(auth.user?.uid ?? 'guest'),
  );
  const [learningState, setLearningState] = useState<ActiveLearningState>(() =>
    getDefaultLearningState(),
  );
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeNode[]>([]);
  const [trainingDB, setTrainingDB] = useState<LocalTrainingDB>(() => getDefaultTrainingDB());
  const lastQAPairIdRef = useRef<string | null>(null); // 追蹤最近的 QA pair，用於回饋評分
  // ── GPT 級本地 AI 大腦 ──
  const [aiBrain, setAiBrain] = useState<LocalAIBrain>(() => createAIBrain());
  const lastStrategyRef = useRef<ResponseStrategy>('direct_answer');
  const lastIntentRef = useRef<IntentLabel>('general');
  const userRole: AgentRole = useMemo(
    () => resolveAgentRoleFromProfile(auth.profile),
    [auth.profile?.role, auth.profile?.serviceRoles, auth.profile?.merchantAssignments],
  );
  const aiModeMeta = useMemo(() => {
    if (isOfflineAI) {
      return {
        label: aiStatus.webSearchEnabled ? '本機代理 AI + 連網搜尋' : '本機代理 AI',
        detail: aiStatus.webSearchEnabled
          ? '本機規劃任務；外部知識會查公開來源、整理證據並本機學習'
          : '本機規劃任務、產生草稿與主動回報，不使用雲端 AI API',
        icon: aiStatus.webSearchEnabled
          ? ('search-outline' as const)
          : ('phone-portrait-outline' as const),
        color: '#10B981',
      };
    }
    if (aiStatus.provider === 'local-llm') {
      return {
        label: '本機模型',
        detail: '連線到你設定的本機 LLM server',
        icon: 'hardware-chip-outline' as const,
        color: '#3B82F6',
      };
    }
    return {
      label: '雲端模型',
      detail: '目前會呼叫外部 AI provider',
      icon: 'cloud-outline' as const,
      color: '#F59E0B',
    };
  }, [aiStatus.provider, aiStatus.webSearchEnabled, isOfflineAI]);

  const buildGreetingContent = useCallback(
    (name: string) => {
      if (isOfflineAI) {
        return [
          `嗨 ${name}，我是本機代理 AI。`,
          '我現在不連 Gemini、OpenAI 或後端 AI server，所以不會假裝有雲端大模型的通用推理能力。',
          '但我可以在手機內拆解任務、收集缺少資料、要求確認、產生可送出的草稿，並保留本機操作紀錄。',
          '我也會在本機偵測課前提醒、作業截止/逾期和重要公告，主動回報到通知與這個聊天紀錄。',
          aiStatus.webSearchEnabled
            ? '遇到外部知識、路線、天氣、最新或現任資訊時，我會連網查公開來源，先整理證據再回答，並把可追溯資料存成本地知識庫。'
            : '',
          '',
          '你可以直接說：「我不舒服」「幫我請假」「我要讀書」「宿舍冷氣壞了」「怎麼去台中車站」。',
        ]
          .filter(Boolean)
          .join('\n');
      }
      return simulateAgentGreeting(name, userRole);
    },
    [aiStatus.webSearchEnabled, isOfflineAI, userRole],
  );

  const memoryStorageKey = useMemo(
    () => getMemoryStorageKey(auth.user?.uid ?? 'guest'),
    [auth.user?.uid],
  );

  const chatHistoryKey = useMemo(
    () => getAIChatHistoryStorageKey(auth.user?.uid ?? null, school.id),
    [auth.user?.uid, school.id],
  );

  // ── Memory persistence (per-user isolation) ──
  useEffect(() => {
    let cancelled = false;
    async function loadMemory() {
      try {
        const restored = await loadPersistedValue<AgentMemory>({
          storageKey: memoryStorageKey,
          fallback: getDefaultMemory(auth.user?.uid ?? 'guest'),
        });
        if (!cancelled) setAgentMemory(restored);
      } catch (e) {
        console.warn('[AIChat] memory load fail:', e);
      }
    }
    loadMemory();
    return () => {
      cancelled = true;
    };
  }, [memoryStorageKey, auth.user?.uid]);

  const saveMemoryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveMemoryRef.current) clearTimeout(saveMemoryRef.current);
    saveMemoryRef.current = setTimeout(async () => {
      try {
        await savePersistedValue(memoryStorageKey, agentMemory);
      } catch (e) {
        console.warn('[AIChat] memory save fail:', e);
      }
    }, 1000);
    return () => {
      if (saveMemoryRef.current) clearTimeout(saveMemoryRef.current);
    };
  }, [agentMemory, memoryStorageKey]);

  // ── Training DB persistence (自動訓練資料庫) ──
  const trainingDBKey = useMemo(
    () => getTrainingDBStorageKey(auth.user?.uid ?? 'guest'),
    [auth.user?.uid],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadTrainingData() {
      try {
        const restored = await loadPersistedValue<LocalTrainingDB>({
          storageKey: trainingDBKey,
          fallback: getDefaultTrainingDB(),
        });
        if (!cancelled) setTrainingDB(normalizeLocalTrainingDB(restored));
      } catch (e) {
        console.warn('[AIChat] training DB load fail:', e);
      }
    }
    loadTrainingData();
    return () => {
      cancelled = true;
    };
  }, [trainingDBKey]);

  const saveTrainingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTrainingRef.current) clearTimeout(saveTrainingRef.current);
    saveTrainingRef.current = setTimeout(async () => {
      try {
        await savePersistedValue(trainingDBKey, trainingDB);
      } catch (e) {
        console.warn('[AIChat] training DB save fail:', e);
      }
    }, 2000); // 2s debounce for training DB
    return () => {
      if (saveTrainingRef.current) clearTimeout(saveTrainingRef.current);
    };
  }, [trainingDB, trainingDBKey]);

  // ── AI Brain persistence (GPT 級大腦持久化) ──
  const brainStorageKey = useMemo(
    () => `${AI_BRAIN_STORAGE_KEY}_${auth.user?.uid ?? 'guest'}`,
    [auth.user?.uid],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadBrain() {
      try {
        const raw = await loadPersistedValue<string>({
          storageKey: brainStorageKey,
          fallback: '',
        });
        if (!cancelled && raw) {
          const restored = deserializeBrain(raw);
          if (restored) setAiBrain(restored);
        }
      } catch (e) {
        console.warn('[AIChat] brain load fail:', e);
      }
    }
    loadBrain();
    return () => {
      cancelled = true;
    };
  }, [brainStorageKey]);

  const saveBrainRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveBrainRef.current) clearTimeout(saveBrainRef.current);
    saveBrainRef.current = setTimeout(async () => {
      try {
        const serialized = serializeBrain(aiBrain);
        await savePersistedValue(brainStorageKey, serialized);
      } catch (e) {
        console.warn('[AIChat] brain save fail:', e);
      }
    }, 3000); // 3s debounce
    return () => {
      if (saveBrainRef.current) clearTimeout(saveBrainRef.current);
    };
  }, [aiBrain, brainStorageKey]);

  // ── Data Sources ──
  const { items: announcements } = useAsyncList(
    () => ds.listAnnouncements(school.id),
    [auth.user?.uid, ds, school.id],
  );
  const { items: events } = useAsyncList(
    () => ds.listEvents(school.id),
    [auth.user?.uid, ds, school.id],
  );
  const { items: cafeterias } = useAsyncList(
    () => ds.listCafeterias(school.id),
    [auth.user?.uid, ds, school.id],
  );
  const { items: menus } = useAsyncList(
    () => ds.listMenus(school.id),
    [auth.user?.uid, ds, school.id],
  );
  const { items: pois } = useAsyncList(
    () => ds.listPois(school.id),
    [auth.user?.uid, ds, school.id],
  );
  const officialPuCafeterias = useMemo<Cafeteria[]>(
    () => (isProvidenceDiningSchoolId(school.id) ? getPuDiningCafeterias(school.id) : []),
    [school.id],
  );
  const officialPuMenus = useMemo<MenuItem[]>(
    () => (isProvidenceDiningSchoolId(school.id) ? getPuDiningMenuItems(school.id) : []),
    [school.id],
  );
  const diningCafeterias = useMemo<Cafeteria[]>(() => {
    const loadedCafeterias = ((cafeterias ?? []) as Cafeteria[]).filter(
      (cafeteria) => !!cafeteria?.name,
    );
    const trustedLoadedCafeterias = isProvidenceDiningSchoolId(school.id)
      ? loadedCafeterias.filter((cafeteria) => hasPuOfficialCafeteriaName(cafeteria.name))
      : loadedCafeterias;
    const merged = [...trustedLoadedCafeterias, ...officialPuCafeterias];
    const seen = new Set<string>();
    return merged.filter((cafeteria) => {
      const key = cafeteria.name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [cafeterias, officialPuCafeterias, school.id]);
  const diningMenus = useMemo<MenuItem[]>(() => {
    const loadedMenus = ((menus ?? []) as MenuItem[]).filter((menu) => !!menu?.name);
    const trustedLoadedMenus = isProvidenceDiningSchoolId(school.id)
      ? loadedMenus.filter((menu) =>
          hasPuOfficialMenuSignal({ name: menu.name, cafeteria: menu.cafeteria }),
        )
      : loadedMenus;
    const merged = [...trustedLoadedMenus, ...officialPuMenus];
    const seen = new Set<string>();
    return merged.filter((menu) => {
      const key = diningMenuKey(menu);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [menus, officialPuMenus, school.id]);

  // ── Knowledge Graph: rebuild when data changes ──
  useEffect(() => {
    const graph = buildKnowledgeGraph({
      courses: (courses ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        teacher: c.teacher,
        dayOfWeek: c.dayOfWeek,
        credits: c.credits,
        startPeriod: c.startPeriod,
      })),
      assignments: (pendingAssignments ?? []).map((a) => ({
        id: a.id,
        title: a.title,
        groupName: a.groupName ?? '',
        dueAt: a.dueAt ? new Date(a.dueAt.seconds * 1000).toLocaleDateString('zh-TW') : undefined,
        isLate: a.isLate,
      })),
      announcements: ((announcements ?? []) as any[]).map((a) => ({
        id: a.id,
        title: a.title,
        source: a.source,
      })),
      events: ((events ?? []) as any[]).map((e) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        startsAt: e.startsAt,
      })),
      menus: diningMenus.map((m) => ({
        id: m.id,
        name: m.name ?? m.cafeteria,
        price: m.price,
        cafeteria: m.cafeteria,
      })),
      pois: ((pois ?? []) as any[]).map((p) => ({ id: p.id, name: p.name, category: p.category })),
      memory: agentMemory,
    });
    setKnowledgeGraph(graph);
    // Also detect interaction patterns
    const patterns = detectInteractionPatterns(agentMemory);
    if (patterns.length > 0) {
      setLearningState((prev) => ({ ...prev, interactionPatterns: patterns }));
    }
  }, [courses, pendingAssignments, announcements, events, diningMenus, pois, agentMemory]);

  // ── History persistence ──
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const restored = await loadAIChatHistory(chatHistoryKey);
        if (!cancelled && restored.length > 0) {
          // Deduplicate + re-key old messages to prevent key collisions
          const seen = new Set<string>();
          const deduped = restored.map((m) => {
            let id = m.id;
            if (seen.has(id)) id = genMsgId('restored');
            seen.add(id);
            return { ...m, id };
          });
          setMessages(deduped);
        }
      } catch (e) {
        console.warn('[AIChat] load fail:', e);
      }
    }
    loadHistory();
    return () => {
      cancelled = true;
    };
  }, [chatHistoryKey]);

  const saveHistoryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (messages.length <= 1) return;
    if (saveHistoryRef.current) clearTimeout(saveHistoryRef.current);
    saveHistoryRef.current = setTimeout(async () => {
      try {
        await saveAIChatHistory(chatHistoryKey, messages, CHAT_HISTORY_MAX);
      } catch (e) {
        console.warn('[AIChat] save fail:', e);
      }
    }, 500);
    return () => {
      if (saveHistoryRef.current) clearTimeout(saveHistoryRef.current);
    };
  }, [messages, chatHistoryKey]);

  useEffect(() => {
    if (!auth.user) return;
    async function load() {
      try {
        const pc = await loadAiPersonalContext({ uid: auth.user!.uid, schoolId: school.id });
        setPendingAssignments(pc.pendingAssignments);
        setWeeklyReport(pc.weeklyReport);
      } catch (e) {
        console.warn('[AIChat] personal data fail:', e);
      }
    }
    load();
  }, [auth.user?.uid, school.id]);

  useEffect(() => {
    let cancelled = false;
    async function loadRuntimeData() {
      try {
        const snapshot = await loadAIAppRuntimeData({
          dataSource: ds,
          userId: auth.user?.uid ?? null,
          schoolId: school.id,
        });
        if (!cancelled) setAppRuntimeData(snapshot);
      } catch (error) {
        console.warn('[AIChat] app runtime context load fail:', error);
        if (!cancelled) setAppRuntimeData(emptyAIAppRuntimeData());
      }
    }
    loadRuntimeData();
    const timer = setInterval(loadRuntimeData, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auth.user?.uid, ds, school.id]);

  const routeProactiveReportId =
    typeof props?.route?.params?.proactiveReportId === 'string'
      ? props.route.params.proactiveReportId
      : null;

  useEffect(() => {
    let cancelled = false;
    async function loadReports() {
      try {
        const reports = await loadProactiveAIReports({
          userId: auth.user?.uid ?? null,
          schoolId: school.id,
        });
        if (!cancelled) setLatestProactiveReports(reports.slice(0, 12));
        if (cancelled || reports.length === 0) return;

        const selected = routeProactiveReportId
          ? reports
              .filter((report) => report.id === routeProactiveReportId || !report.seenInChat)
              .slice(0, 6)
          : reports.filter((report) => !report.seenInChat).slice(0, 5);
        if (selected.length === 0) return;

        const ordered = [...selected].sort(
          (left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime(),
        );
        const reportMessages = ordered.map(messageFromProactiveReport);

        setMessages((prev) => {
          const existingIds = new Set(prev.map((message) => message.id));
          const next = reportMessages.filter((message) => !existingIds.has(message.id));
          return next.length > 0 ? [...prev, ...next] : prev;
        });

        await markProactiveAIReportsSeen({
          userId: auth.user?.uid ?? null,
          schoolId: school.id,
          reportIds: ordered.map((report) => report.id),
        });
      } catch (error) {
        console.warn('[AIChat] proactive report load fail:', error);
      }
    }
    loadReports();
    return () => {
      cancelled = true;
    };
  }, [auth.user?.uid, school.id, routeProactiveReportId]);

  // ── AI Context ──
  const aiContext = useMemo<AIContext>(
    () =>
      buildAIAppContext({
        schoolId: school.id,
        userId: auth.user?.uid ?? null,
        userName: auth.profile?.displayName ?? null,
        role: userRole,
        isOnline: isEffectivelyOnline(),
        courses: courses ?? [],
        pendingAssignments: pendingAssignments ?? [],
        weeklyReport,
        announcements: (announcements ?? []) as any[],
        events: (events ?? []) as any[],
        cafeterias: diningCafeterias,
        menus: diningMenus,
        pois: (pois ?? []) as any[],
        proactiveReports: latestProactiveReports,
        runtimeData: appRuntimeData,
        agentMemory,
        trainingDB,
        dialogContextSummary: getContextSummary(aiBrain.dialogCtx),
        conversationSummary: aiBrain.conversationSummary
          ? summaryToText(aiBrain.conversationSummary)
          : undefined,
      }),
    [
      school.id,
      auth.user?.uid,
      auth.profile?.displayName,
      userRole,
      announcements,
      events,
      diningCafeterias,
      diningMenus,
      pois,
      courses,
      pendingAssignments,
      weeklyReport,
      latestProactiveReports,
      appRuntimeData,
      agentMemory,
      trainingDB,
      aiBrain.dialogCtx,
      aiBrain.conversationSummary,
    ],
  );

  // ── Greeting ──
  useEffect(() => {
    const name = auth.profile?.displayName?.split(' ')[0] ?? '同學';
    const greeting: Message = {
      id: 'greeting',
      role: 'assistant',
      content: buildGreetingContent(name),
      timestamp: new Date(),
      agentType: 'capability_card',
      suggestions: isOfflineAI
        ? ['幫我訂午餐', '請假信草稿', '圖書館在哪']
        : ['幫我訂午餐', '我頭有點痛', '幫我預約圖書館座位'],
    };
    setMessages((prev) => {
      if (prev.length === 0) return [greeting];
      if (prev.some((message) => message.id === 'greeting')) {
        return prev.map((message) => (message.id === 'greeting' ? greeting : message));
      }
      return [greeting, ...prev];
    });
  }, [auth.user?.uid, (courses ?? []).length, buildGreetingContent, isOfflineAI]);

  // ═══════════════════════════════════════════════════
  // Semantic Intent Engine v2 — Context-Aware
  // ═══════════════════════════════════════════════════

  // Domain classification: determine what TOPIC the message is about
  type IntentDomain =
    | 'academic' // 課程、成績、學分、畢業、被當、選課
    | 'dining' // 餐飲、食物、訂餐
    | 'health' // 健康、症狀、看醫生
    | 'location' // 地點、導航
    | 'library' // 圖書館、借書、座位
    | 'dorm' // 宿舍、報修、洗衣、包裹
    | 'transport' // 公車、交通
    | 'admin' // 請假、公告、活動
    | 'mood' // 心情、情緒
    | 'lostfound' // 遺失、拾獲
    | 'print' // 列印、影印
    | 'reminder' // 提醒
    | 'weather' // 天氣
    | 'greeting' // 打招呼
    | 'thanks' // 感謝
    | 'help' // 功能說明
    | 'general'; // 無法分類

  function classifyDomain(msg: string): { domain: IntentDomain; confidence: number } {
    const m = msg.toLowerCase();
    // Each domain: [keywords[], weight] — matched keywords * weight = score
    const domainRules: Array<{ domain: IntentDomain; keywords: string[]; weight: number }> = [
      {
        domain: 'academic',
        weight: 3,
        keywords: [
          '課程',
          '課',
          '學分',
          '畢業',
          '被當',
          '當掉',
          '成績',
          '分數',
          'GPA',
          '排名',
          '選課',
          '修課',
          '退選',
          '加選',
          '必修',
          '選修',
          '通識',
          '學期',
          '教授',
          '老師',
          '期中',
          '期末',
          '考試',
          '報告',
          '上課',
          '翹課',
          '出席',
          '缺曠',
          '作業',
          '繳交',
          '截止',
          'deadline',
          '及格',
          '不及格',
          '二一',
          '退學',
          '延畢',
          '重修',
        ],
      },
      {
        domain: 'dining',
        weight: 2,
        keywords: [
          '吃',
          '餐',
          '飯',
          '麵',
          '菜',
          '食',
          '訂餐',
          '點餐',
          '午餐',
          '晚餐',
          '早餐',
          '餐廳',
          '菜單',
          '蔬菜',
          '素食',
          '肉',
          '便當',
          '外送',
          '覓食',
          '肚子餓',
          '好餓',
          '想吃',
          '小吃',
          '湯',
          '飲料',
          '甜點',
          '推薦吃',
          '有什麼好吃',
          '便宜',
          '平價',
          '划算',
          '省錢',
          '其他選擇',
          '還有其他',
          '別的',
          '換一個',
          '最便宜',
        ],
      },
      {
        domain: 'health',
        weight: 3,
        keywords: [
          '掛號',
          '看醫',
          '門診',
          '症狀',
          '不舒服',
          '頭痛',
          '肚子痛',
          '發燒',
          '感冒',
          '咳嗽',
          '流鼻水',
          '喉嚨痛',
          '拉肚子',
          '過敏',
          '頭暈',
          '噁心',
          '想吐',
          '受傷',
          '扭到',
        ],
      },
      {
        domain: 'location',
        weight: 2,
        keywords: [
          '在哪',
          '怎麼走',
          '怎麼去',
          '地點',
          '導航',
          '地圖',
          '位置',
          '路線',
          '哪裡',
          '在哪裡',
          '哪邊',
          '怎樣去',
        ],
      },
      {
        domain: 'library',
        weight: 2,
        keywords: [
          '圖書館',
          '借書',
          '還書',
          '找書',
          '查書',
          '館藏',
          '書籍',
          '自習室',
          '討論室',
          '預約座位',
          '圖書館座位',
          '蓋夏',
          '看書',
          '自習',
        ],
      },
      {
        domain: 'dorm',
        weight: 2,
        keywords: [
          '宿舍',
          '報修',
          '壞了',
          '故障',
          '維修',
          '漏水',
          '洗衣機',
          '烘衣機',
          '洗衣',
          '包裹',
          '快遞',
          '取件',
          '宅配',
          '住宿',
          '寢室',
          '室友',
        ],
      },
      {
        domain: 'transport',
        weight: 2,
        keywords: [
          '公車',
          '搭車',
          '坐車',
          '交通',
          '幾號公車',
          '到站',
          '怎麼去',
          '車站',
          '台中車站',
          '高鐵',
          '火車',
          '客運',
          '統聯',
          '搭什麼',
          '幾路',
          '哪班車',
          '台中',
          '沙鹿',
          '清水',
        ],
      },
      {
        domain: 'admin',
        weight: 2,
        keywords: ['請假', '病假', '事假', '公告', '消息', '通知', '活動', '報名', '社團'],
      },
      {
        domain: 'mood',
        weight: 2,
        keywords: ['心情', '情緒', '壓力大', '焦慮', '緊張', '難過', '煩', '開心'],
      },
      {
        domain: 'lostfound',
        weight: 2,
        keywords: ['遺失', '掉了', '不見了', '弄丟', '丟了', '拾獲', '撿到'],
      },
      {
        domain: 'print',
        weight: 2,
        keywords: ['列印', '印報告', '印作業', '印文件', '影印卡', '列印餘額'],
      },
      { domain: 'reminder', weight: 2, keywords: ['提醒', '提醒我', '鬧鐘', '別忘了', '記得'] },
      { domain: 'weather', weight: 2, keywords: ['天氣', '下雨', '氣溫', '帶傘'] },
      {
        domain: 'greeting',
        weight: 1,
        keywords: ['嗨', '你好', '哈囉', 'hi', 'hello', 'hey', '早安', '午安', '晚安', '安安'],
      },
      { domain: 'thanks', weight: 1, keywords: ['謝', '感恩', '3q', 'thx', 'thanks'] },
      {
        domain: 'help',
        weight: 2,
        keywords: ['功能', '怎麼用', '說明', '幫助', '你能做', '你會什麼'],
      },
    ];

    let bestDomain: IntentDomain = 'general';
    let bestScore = 0;

    for (const rule of domainRules) {
      const hits = rule.keywords.filter((k) => m.includes(k)).length;
      const score = hits * rule.weight;
      if (score > bestScore) {
        bestScore = score;
        bestDomain = rule.domain;
      }
    }

    return { domain: bestDomain, confidence: Math.min(bestScore / 6, 1) };
  }

  function domainToWebSearchCategory(
    domain: IntentDomain,
  ): Parameters<typeof shouldUseWebSearch>[1] {
    switch (domain) {
      case 'academic':
        return 'course';
      case 'dining':
        return 'food';
      case 'health':
        return 'health';
      case 'location':
        return 'location';
      case 'library':
        return 'library';
      case 'dorm':
        return 'dorm';
      case 'transport':
        return 'transport';
      case 'lostfound':
        return 'lost_found';
      case 'print':
        return 'print';
      case 'reminder':
        return 'schedule';
      case 'weather':
        return 'weather';
      case 'greeting':
        return 'greeting';
      case 'thanks':
        return 'thanks';
      case 'help':
        return 'help';
      case 'mood':
        return 'mood';
      default:
        return 'general';
    }
  }

  // Check if message is an ACTION request (do something) vs QUESTION (ask something)
  function isActionRequest(msg: string): boolean {
    const actionIndicators = [
      '幫我',
      '幫忙',
      '請幫',
      '我要',
      '我想要',
      '可以幫',
      '訂',
      '預約',
      '報修',
      '掛號',
      '請假',
      '設定',
      '提醒我',
      '發訊息',
      '傳訊息',
      '列印',
      '點餐',
      '下單',
    ];
    return actionIndicators.some((k) => msg.includes(k));
  }

  function shouldPrioritizeToolAction(msg: string): boolean {
    const strongAction =
      /幫我|請幫|替我|麻煩|幫忙|我要點|我要訂|我要吃|來一份|點一份|點餐|訂餐|下單|預約|報修|請假|設定提醒|提醒我|發訊息|傳訊息|列印|確認下單/.test(
        msg,
      );
    if (!strongAction) return false;
    const looksLikeQuestionOnly = /怎麼|如何|為什麼|哪裡|在哪|嗎|[?？]/.test(msg);
    return (
      !looksLikeQuestionOnly || /點餐|訂餐|下單|預約|報修|請假|提醒我|發訊息|傳訊息|列印/.test(msg)
    );
  }

  function requiresDeepReasoning(msg: string): boolean {
    const lower = msg.toLowerCase();
    const len = lower.length;
    if (len > 30 && /為什麼|怎麼辦|如何|應該|建議|分析|比較|解釋|幫我想|你覺得|可以嗎/.test(lower))
      return true;
    if (/為什麼|原因|怎麼辦|如何.*才|應該.*還是|到底|究竟|差別|不同/.test(lower)) return true;
    if ((lower.match(/[？?]/g) || []).length >= 2) return true;
    if (/好煩|好累|壓力大|不想|焦慮|憂鬱|怎麼.*這麼|人生|未來|迷茫/.test(lower)) return true;
    if (/規劃|計畫|安排|準備.*怎|面試|履歷|實習|打工|交換/.test(lower)) return true;
    if (/推薦/.test(lower) && !/吃|餐|飯|麵|午餐|晚餐|早餐|宵夜|美食|食物/.test(lower)) return true;
    if (/是什麼意思|英文|翻譯|程式|code|bug|python|java|AI|機器學習/.test(lower)) return true;
    return false;
  }

  function inferFollowUpDomain(msg: string): IntentDomain | null {
    const lastAssistant =
      [...(messages ?? [])].reverse().find((m) => m.role === 'assistant' && m.id !== 'greeting')
        ?.content ?? '';
    const diningFollowUp =
      /便宜|平價|划算|省錢|其他|還有|別的|換|素食|蔬菜|健康|清淡|不辣|想吃|第[一二三四五六七八九十\d]+|編號|那道|這道|哪一道/.test(
        msg,
      );
    const lastWasDining =
      /餐|飯|麵|菜單|餐廳|餐點|吃|靜園|宜園|至善|白鬍子|Morning House|飲料|吐司|蛋餅|鐵板麵|水果杯/.test(
        lastAssistant,
      );
    if (lastWasDining && diningFollowUp) return 'dining';

    const transportFollowUp = /怎麼去|怎麼到|搭什麼|搭哪|公車|高鐵|火車|車站|路線|轉乘/.test(msg);
    const lastWasTransport = /台中車站|臺中車站|高鐵|沙鹿|公車|交通|路線|轉乘/.test(lastAssistant);
    if (lastWasTransport && transportFollowUp) return 'transport';

    return null;
  }

  function resolveRecentDiningChoiceParams(userMessage: string): Record<string, any> | null {
    const choiceIndex = parseDiningChoiceIndex(userMessage);
    if (!choiceIndex) return null;

    const recentAssistantMessages = [...(messages ?? [])]
      .reverse()
      .filter((message) => message.role === 'assistant' && message.content)
      .slice(0, 8);

    for (const message of recentAssistantMessages) {
      const lines = message.content.split('\n');
      const parsedLine = lines
        .map(parseDiningRecommendationLine)
        .find((line) => line?.index === choiceIndex);
      if (!parsedLine) continue;

      const requestedName = compactText(parsedLine.itemName);
      const requestedCafeteria = compactText(parsedLine.cafeteria);
      const selectedMenu = diningMenus.find((menu) => {
        const menuName = compactText(menu.name);
        const menuCafe = compactText(menu.cafeteria);
        const nameMatches =
          menuName === requestedName ||
          menuName.includes(requestedName) ||
          requestedName.includes(menuName);
        const cafeMatches =
          !requestedCafeteria ||
          menuCafe.includes(requestedCafeteria) ||
          requestedCafeteria.includes(menuCafe);
        return nameMatches && cafeMatches;
      });
      const selectedCafeteria = selectedMenu?.cafeteriaId
        ? diningCafeterias.find((cafeteria) => cafeteria.id === selectedMenu.cafeteriaId)
        : diningCafeterias.find(
            (cafeteria) =>
              parsedLine.cafeteria &&
              (compactText(cafeteria.name).includes(requestedCafeteria) ||
                requestedCafeteria.includes(compactText(cafeteria.name))),
          );

      return {
        items: selectedMenu?.name ?? parsedLine.itemName,
        menuItemId: selectedMenu?.id,
        cafeteria:
          selectedMenu?.cafeteriaId?.split('-caf-').pop() ??
          selectedCafeteria?.id?.split('-caf-').pop() ??
          parsedLine.cafeteria,
      };
    }

    return null;
  }

  function getDomainDataStatus(domain: IntentDomain): {
    label: string;
    available: boolean;
    detail: string;
  } {
    switch (domain) {
      case 'academic':
        return {
          label: '課程/作業資料',
          available: (courses ?? []).length > 0 || (pendingAssignments ?? []).length > 0,
          detail: `${(courses ?? []).length} 門課、${(pendingAssignments ?? []).length} 筆待處理作業`,
        };
      case 'dining':
        return {
          label: '餐廳/菜單資料',
          available: diningCafeterias.length > 0 || diningMenus.length > 0,
          detail: `${diningCafeterias.length} 間餐廳、${diningMenus.length} 筆菜單`,
        };
      case 'admin':
        return {
          label: '公告/活動資料',
          available:
            ((announcements ?? []) as any[]).length > 0 || ((events ?? []) as any[]).length > 0,
          detail: `${((announcements ?? []) as any[]).length} 則公告、${((events ?? []) as any[]).length} 個活動`,
        };
      case 'location':
      case 'transport':
        return {
          label: '地點/交通資料',
          available: ((pois ?? []) as any[]).length > 0 || domain === 'transport',
          detail:
            domain === 'transport'
              ? '有靜態交通路線，沒有即時到站'
              : `${((pois ?? []) as any[]).length} 個地點`,
        };
      case 'library':
      case 'dorm':
      case 'health':
      case 'lostfound':
      case 'print':
      case 'reminder':
        return { label: 'APP 功能資料', available: true, detail: '可使用 APP 內功能或建立草稿' };
      case 'weather':
        return {
          label: '即時資料',
          available: aiStatus.webSearchEnabled,
          detail: aiStatus.webSearchEnabled ? '可連網查詢' : '本機沒有即時天氣',
        };
      default:
        return {
          label: '本機知識',
          available: (agentMemory?.learnedFacts ?? []).length > 0 || trainingDB.pairs.length > 0,
          detail: '可用本機記憶與訓練樣本',
        };
    }
  }

  function buildAgentDeliberation(userMessage: string): ThinkingStepUI[] {
    const lowerMsg = userMessage.toLowerCase();
    const classified = classifyDomain(lowerMsg);
    const followUpDomain = inferFollowUpDomain(lowerMsg);
    const domain = followUpDomain ?? classified.domain;
    const dataStatus = getDomainDataStatus(domain);
    const actionRequested = isActionRequest(lowerMsg) || shouldPrioritizeToolAction(lowerMsg);
    const toolMatch = actionRequested ? matchDirectTool(lowerMsg, domain) : null;
    const needsRealtime =
      aiStatus.webSearchEnabled &&
      shouldUseWebSearch(userMessage, domainToWebSearchCategory(domain));
    const deepReasoning = requiresDeepReasoning(lowerMsg);
    const steps: ThinkingStepUI[] = [
      {
        step: '理解目標',
        detail: actionRequested
          ? `使用者要我執行任務；分類為 ${domain}`
          : `使用者要我回答/分析；分類為 ${domain}`,
        status: classified.confidence >= 0.5 || followUpDomain ? 'done' : 'checking',
      },
      {
        step: '選擇能力',
        detail: toolMatch
          ? `可用工具：${toolMatch.name}`
          : needsRealtime
            ? '需要連網查公開資料'
            : deepReasoning
              ? '需要多步推理與自我檢查'
              : '可先使用 APP 本機資料回答',
        status: toolMatch || dataStatus.available || needsRealtime ? 'done' : 'warning',
      },
      {
        step: '檢查資料',
        detail: `${dataStatus.label}：${dataStatus.detail}`,
        status: dataStatus.available ? 'done' : 'warning',
      },
    ];

    if (toolMatch?.id === 'order_meal') {
      const params = extractParamsFromMessage(toolMatch, userMessage);
      const selectedCafeteria = findDiningCafeteriaForParams(params, userMessage);
      const orderingBlock = getRestaurantOrderingBlock(selectedCafeteria);
      steps.push({
        step: '驗證可執行性',
        detail: orderingBlock
          ? `${orderingBlock}不能直接假下單`
          : '餐廳端條件仍會在送單時由後端再次驗證',
        status: orderingBlock ? 'warning' : 'checking',
      });
    } else if (toolMatch?.requiresConfirmation) {
      steps.push({
        step: '安全確認',
        detail: '此操作會先顯示確認卡，不會自動送出',
        status: 'done',
      });
    } else if (deepReasoning && isOfflineAI && !aiStatus.webSearchEnabled) {
      steps.push({
        step: '能力邊界',
        detail: '本機模式沒有雲端大模型；低信心時要澄清或說明限制',
        status: 'warning',
      });
    }

    return steps;
  }

  function attachThinkingSteps(message: Message, steps: ThinkingStepUI[]): Message {
    const existing = message.thinkingSteps ?? [];
    return { ...message, thinkingSteps: [...steps, ...existing].slice(0, 7) };
  }

  // ── Agent Logic: Intent Detection + Tool Matching ──
  const detectIntentAndExecute = useCallback(
    async (userMessage: string): Promise<Message | null> => {
      try {
        const lowerMsg = userMessage.toLowerCase();
        const classified = classifyDomain(lowerMsg);
        const followUpDomain = inferFollowUpDomain(lowerMsg);
        const domain = followUpDomain ?? classified.domain;
        const confidence = followUpDomain
          ? Math.max(classified.confidence, 0.7)
          : classified.confidence;
        const deliberationSteps = buildAgentDeliberation(userMessage);

        // 1. Check Task Chains first (multi-step workflows)
        const chain = matchTaskChain(userMessage);
        if (chain) {
          return attachThinkingSteps(startTaskChain(chain, userMessage), deliberationSteps);
        }

        if (
          aiStatus.webSearchEnabled &&
          shouldUseWebSearch(userMessage, domainToWebSearchCategory(domain))
        ) {
          return null;
        }

        const priorityTool = shouldPrioritizeToolAction(lowerMsg)
          ? matchDirectTool(lowerMsg, domain)
          : null;
        if (priorityTool) {
          return attachThinkingSteps(
            startToolExecution(priorityTool, userMessage),
            deliberationSteps,
          );
        }

        // 2. ALWAYS try smart contextual response first (Q&A, campus info)
        //    This prevents tools from hijacking question-type queries
        const smartResponse = generateSmartResponse(userMessage, domain);
        if (smartResponse) return attachThinkingSteps(smartResponse, deliberationSteps);

        // 3. Only match tools if it's an ACTION request with correct domain
        if (isActionRequest(lowerMsg) || confidence >= 0.5) {
          const toolMatch = matchDirectTool(lowerMsg, domain);
          if (toolMatch) {
            return attachThinkingSteps(
              startToolExecution(toolMatch, userMessage),
              deliberationSteps,
            );
          }
        }

        // 4. Fallback to AI service (mock or real LLM)
        return null;
      } catch (err) {
        console.warn('[AIChat] detectIntentAndExecute error:', err);
        return null; // 出錯就交給 AI 引擎處理
      }
    },
    [
      announcements,
      events,
      diningMenus,
      diningCafeterias,
      pois,
      courses,
      pendingAssignments,
      agentMemory,
      trainingDB,
      isOfflineAI,
      messages,
      userRole,
      aiStatus.webSearchEnabled,
    ],
  );

  function matchDirectTool(msg: string, domain: IntentDomain): AgentTool | null {
    // Domain-scoped tool matching: only match tools relevant to the detected domain
    const domainToolMap: Record<string, IntentDomain[]> = {
      order_meal: ['dining'],
      recommend_meal: ['dining'],
      check_wait_time: ['dining'],
      book_health: ['health'],
      symptom_check: ['health'],
      record_mood: ['mood'],
      reserve_seat: ['library'],
      search_book: ['library'],
      report_repair: ['dorm'],
      check_laundry: ['dorm'],
      check_package: ['dorm'],
      post_lost: ['lostfound'],
      search_found: ['lostfound'],
      print_file: ['print'],
      check_print_balance: ['print'],
      request_leave: ['admin', 'academic'],
      check_grades: ['academic'],
      check_assignments: ['academic'],
      check_bus: ['transport', 'location'],
      set_reminder: ['reminder'],
      send_message: ['general'], // broad scope
    };

    const toolKeywords: Record<string, string[]> = {
      order_meal: [
        '訂餐',
        '點餐',
        '幫我訂',
        '下單',
        '幫我點',
        '我要點',
        '我要訂',
        '我要吃',
        '來一份',
        '點一份',
        '訂第',
        '點第',
      ],
      recommend_meal: [
        '推薦吃',
        '吃什麼',
        '有什麼好吃',
        '想吃',
        '餐點',
        '菜單',
        '好餓',
        '肚子餓',
        '覓食',
        '哪裡吃',
      ],
      check_wait_time: ['等多久', '排隊', '等候', '人多嗎', '要排', '要等'],
      book_health: ['掛號', '預約門診', '預約看診', '看醫生', '預約醫生', '看診'],
      symptom_check: [
        '不舒服',
        '頭痛',
        '肚子痛',
        '發燒',
        '症狀',
        '身體不適',
        '感冒',
        '咳嗽',
        '流鼻水',
        '喉嚨痛',
        '拉肚子',
        '過敏',
        '頭暈',
        '噁心',
        '想吐',
        '受傷',
        '扭到',
      ],
      record_mood: ['記錄心情', '今天過得', '壓力大'],
      reserve_seat: ['預約座位', '圖書館座位', '討論室', '自習室', '訂位子', '找位子'],
      search_book: ['借書', '找書', '查書', '書籍', '館藏'],
      report_repair: ['報修', '壞了', '故障', '維修', '漏水', '不能用'],
      check_laundry: ['洗衣機', '烘衣機', '洗衣', '洗衣服', '烘衣服'],
      check_package: ['包裹', '快遞', '取件', '宅配', '寄件', '貨到了'],
      post_lost: ['遺失', '掉了', '不見了', '弄丟', '丟了'],
      search_found: ['拾獲', '撿到', '找到東西'],
      print_file: ['列印', '印報告', '印作業', '印文件'],
      check_print_balance: ['列印餘額', '影印卡', '列印額度'],
      request_leave: ['請假', '病假', '事假', '公假', '喪假'],
      check_grades: ['查成績', '看成績', '成績查詢'],
      check_assignments: ['查作業', '作業截止', '繳交期限'],
      check_bus: [
        '公車',
        '公車到站',
        '幾號公車',
        '搭車',
        '怎麼去',
        '台中車站',
        '高鐵',
        '火車站',
        '搭什麼',
      ],
      set_reminder: ['提醒', '提醒我', '鬧鐘', '別忘了', '記得'],
      send_message: ['發訊息', '傳訊息', '通知同學', '通知老師', '傳給'],
    };

    // Score each tool: keyword match + domain alignment bonus
    let bestTool: AgentTool | null = null;
    let bestScore = 0;

    for (const [toolId, keywords] of Object.entries(toolKeywords)) {
      const hits = keywords.filter((k) => msg.includes(k)).length;
      if (hits === 0) continue;

      const allowedDomains = domainToolMap[toolId] ?? [];
      const domainMatch = allowedDomains.includes(domain) || domain === 'general';
      // Big penalty if domain doesn't match (prevents "有哪些" in academic context triggering meals)
      const score = domainMatch ? hits * 2 : hits * 0.3;

      if (score > bestScore) {
        const tool = getToolById(toolId);
        if (tool && tool.roleAccess.includes(userRole)) {
          bestScore = score;
          bestTool = tool;
        }
      }
    }

    return bestScore >= 1 ? bestTool : null;
  }

  function buildTransportDirections(
    msg: string,
  ): { content: string; suggestions: string[] } | null {
    const q = msg.toLowerCase();
    const asksDirections =
      /怎麼去|怎樣去|如何去|怎麼到|到.*怎麼走|搭什麼|搭哪|幾號公車|路線|交通/.test(q);
    const mentionsStation = /台中車站|臺中車站|台中火車站|臺中火車站|車站|火車站/.test(q);
    const mentionsHsr = /高鐵|烏日/.test(q);
    const mentionsShalu = /沙鹿.*(車站|火車站)|沙鹿火車站/.test(q);
    const mentionsMitsui = /三井|outlet|港井/.test(q);
    const mentionsGaomei = /高美/.test(q);

    if (!asksDirections && !mentionsStation && !mentionsHsr && !mentionsMitsui && !mentionsGaomei) {
      return null;
    }

    if (mentionsShalu) {
      return {
        content: [
          '從靜宜大學到沙鹿火車站：',
          '',
          '1. 最快：計程車或共乘，約 10 分鐘。',
          '2. 省錢：到校門口周邊搭往沙鹿市區方向的公車，或用 YouBike 轉乘，實際班次請看台中公車 App。',
          '3. 如果你要再去台中車站，可從沙鹿火車站搭台鐵區間車到台中車站，約 20-30 分鐘。',
          '',
          '離線模式沒有即時班次，出發前請查台鐵或台中公車即時資訊。',
        ].join('\n'),
        suggestions: ['怎麼去台中車站', '怎麼去高鐵', '校門口公車'],
      };
    }

    if (mentionsHsr) {
      return {
        content: [
          '從靜宜大學到高鐵台中站：',
          '',
          '1. 推薦：在校門口一帶搭往高鐵台中站方向的客運或 35 路公車，約 30-40 分鐘。',
          '2. 趕時間：計程車或共乘約 20-30 分鐘，費用會比公車高很多。',
          '3. 到站後依指標進入高鐵站大廳；若要轉台鐵，旁邊是新烏日車站。',
          '',
          '離線模式不能查即時到站，請用台中公車 App 確認下一班車。',
        ].join('\n'),
        suggestions: ['怎麼去台中車站', '查公車站位置', '去沙鹿火車站'],
      };
    }

    if (mentionsMitsui) {
      return {
        content: [
          '從靜宜大學到三井 Outlet 台中港：',
          '',
          '1. 公車：從校門口周邊搭往梧棲/台中港方向的路線，再依台中公車 App 顯示轉乘或下車。',
          '2. 計程車或共乘：約 15-25 分鐘，適合多人分攤。',
          '3. 若時間不趕，先查即時公車會比較穩，因為班距可能不固定。',
        ].join('\n'),
        suggestions: ['怎麼去台中車站', '怎麼去高美濕地', '校門口公車'],
      };
    }

    if (mentionsGaomei) {
      return {
        content: [
          '從靜宜大學到高美濕地：',
          '',
          '1. 公車：通常要往清水/高美方向轉乘，建議直接用台中公車 App 查當下最佳路線。',
          '2. 計程車或共乘：約 25-35 分鐘，傍晚回程較難叫車，建議先規劃。',
          '3. 看夕陽要注意潮汐、風大和回程時間。',
        ].join('\n'),
        suggestions: ['怎麼去台中車站', '怎麼去三井', '查公車'],
      };
    }

    if (mentionsStation || /台中/.test(q)) {
      return {
        content: [
          '從靜宜大學到台中車站，離線版建議兩種走法：',
          '',
          '1. 直達公車：到校門口台灣大道上的公車站，搭 300、307 或 308 往台中車站方向，約 40-50 分鐘。尖峰時間可能更久。',
          '2. 台鐵轉乘：先到沙鹿火車站，再搭台鐵區間車到台中車站。這個方式要多一次轉乘，但有時比較穩。',
          '',
          '下車提醒：目的地可設「台中車站」或「臺中車站」。離線模式不能看即時班次，出門前請用台中公車 App 或台鐵 App 確認下一班。',
        ].join('\n'),
        suggestions: ['校門口公車在哪', '怎麼去高鐵', '去沙鹿火車站'],
      };
    }

    return {
      content: [
        '靜宜大學常用交通：',
        '',
        '1. 台中車站：校門口搭 300、307、308，約 40-50 分鐘。',
        '2. 高鐵台中站：搭往高鐵方向的客運或 35 路，約 30-40 分鐘。',
        '3. 沙鹿火車站：計程車約 10 分鐘，也可查台中公車轉乘。',
        '',
        '離線模式沒有即時到站，請用台中公車 App 確認班次。',
      ].join('\n'),
      suggestions: ['怎麼去台中車站', '怎麼去高鐵', '去沙鹿火車站'],
    };
  }

  const COURSE_DAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

  function getCourseMeetingsForChat(course: any): any[] {
    if (Array.isArray(course?.schedule) && course.schedule.length > 0) {
      return course.schedule.filter((meeting: any) => typeof meeting?.dayOfWeek === 'number');
    }
    if (typeof course?.dayOfWeek === 'number') {
      return [
        {
          dayOfWeek: course.dayOfWeek,
          startPeriod: course.startPeriod,
          endPeriod: course.endPeriod,
          startTime: course.startTime,
          endTime: course.endTime,
          location: course.location,
        },
      ];
    }
    return [];
  }

  function meetingSortValueForChat(meeting: any): number {
    if (typeof meeting?.startPeriod === 'number') return meeting.startPeriod * 100;
    if (typeof meeting?.startTime === 'string') {
      const [hour, minute] = meeting.startTime.split(':').map(Number);
      if (Number.isFinite(hour) && Number.isFinite(minute)) return hour * 60 + minute;
    }
    return Number.MAX_SAFE_INTEGER;
  }

  function formatMeetingTimeForChat(meeting: any): string {
    if (typeof meeting?.startPeriod === 'number') {
      const end =
        typeof meeting.endPeriod === 'number' && meeting.endPeriod !== meeting.startPeriod
          ? `-${meeting.endPeriod}`
          : '';
      return `第${meeting.startPeriod}${end}節`;
    }
    if (meeting?.startTime && meeting?.endTime) return `${meeting.startTime}-${meeting.endTime}`;
    if (meeting?.startTime) return meeting.startTime;
    return '時間未提供';
  }

  function formatCourseSummaryForChat(course: any): string {
    const meetings = getCourseMeetingsForChat(course);
    const meetingText =
      meetings.length > 0
        ? meetings
            .map((meeting: any) => {
              const day = COURSE_DAY_NAMES[meeting.dayOfWeek] ?? '日期未提供';
              const location = meeting.location ? `，${meeting.location}` : '';
              return `${day} ${formatMeetingTimeForChat(meeting)}${location}`;
            })
            .join('；')
        : '時間未提供';
    const teacher = course?.teacher ?? course?.instructor;
    return `${course?.name ?? '未命名課程'}（${meetingText}${teacher ? `，${teacher}` : ''}${typeof course?.credits === 'number' ? `，${course.credits}學分` : ''}）`;
  }

  function parseRequestedCourseDayForChat(message: string): { day: number; label: string } {
    if (/明天/.test(message)) {
      const day = (new Date().getDay() + 1) % 7;
      return { day, label: '明天' };
    }
    if (/後天/.test(message)) {
      const day = (new Date().getDay() + 2) % 7;
      return { day, label: '後天' };
    }
    const dayMatch = message.match(/(?:星期|週|禮拜)(一|二|三|四|五|六|日|天)/);
    if (dayMatch) {
      const dayMap: Record<string, number> = {
        日: 0,
        天: 0,
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
      };
      const day = dayMap[dayMatch[1]] ?? new Date().getDay();
      return { day, label: COURSE_DAY_NAMES[day] ?? '指定日期' };
    }
    const day = new Date().getDay();
    return { day, label: '今天' };
  }

  // ═══════════════════════════════════════════════════
  // Smart Response Engine v2 — Knowledge-Driven
  // ═══════════════════════════════════════════════════
  // Uses ALL app data + memory to generate accurate contextual answers

  function generateSmartResponse(msg: string, domain: IntentDomain): Message | null {
    const lowerMsg = msg.toLowerCase();
    const uid = () => genMsgId();

    // ★ 防護：用 try/catch 包裝整個函數，避免任何 undefined 崩潰
    try {
      // ★★ 安全防護：函式內所有閉包變數都加 ?? 防護，避免 hooks 未載入時 undefined ★★
      const _courses = courses ?? [];
      const _pendingAssignments = pendingAssignments ?? [];
      const _menus = diningMenus as any[];
      const _events = (events ?? []) as any[];
      const _announcements = (announcements ?? []) as any[];
      const _pois = (pois ?? []) as any[];
      const _agentMemory = agentMemory ?? {
        userId: 'anonymous',
        version: 1,
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        preferences: {
          foodPreferences: [],
          allergens: [],
          frequentLocations: [],
          communicationStyle: 'casual' as const,
          reminderLeadTime: 10,
          quietHours: { start: '22:00', end: '07:00' },
        },
        recentActions: [],
        conversationPatterns: [],
        knownSchedule: [],
        learnedFacts: [],
        conversationSummaries: [],
      };

      if (aiStatus.webSearchEnabled && shouldUseWebSearch(msg, domainToWebSearchCategory(domain))) {
        return null;
      }

      const transportDirections = buildTransportDirections(lowerMsg);
      if (transportDirections) {
        return {
          id: uid(),
          role: 'assistant',
          content: transportDirections.content,
          timestamp: new Date(),
          agentType: 'text',
          suggestions: transportDirections.suggestions,
        };
      }

      // ── 學業核心：被當 / 不及格 / 課程風險分析 ──
      if (/被當|當掉|不及格|會不會過|能不能過|及格|二一|退學|延畢|重修/.test(lowerMsg)) {
        if ((courses ?? []).length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content:
              '目前沒有載入你的課程資料，無法進行分析。\n\n請先到設定中同步你的課表和成績資料，我才能幫你評估課程風險。',
            timestamp: new Date(),
            agentType: 'text',
            suggestions: ['同步課表', '查成績'],
          };
        }
        const lateAssignments = _pendingAssignments.filter((a) => a.isLate);
        const totalAssignments = _pendingAssignments.length;
        const courseList = _courses
          .map((c, i) => `${i + 1}. ${formatCourseSummaryForChat(c)}`)
          .join('\n');

        let riskAnalysis = `你本學期共修 ${_courses.length} 門課：\n\n${courseList}\n\n`;

        if (lateAssignments.length > 0) {
          riskAnalysis += `⚠️ 注意：你有 ${lateAssignments.length} 份逾期作業：\n`;
          riskAnalysis += lateAssignments.map((a) => `  - ${a.title}（${a.groupName}）`).join('\n');
          riskAnalysis += `\n\n逾期作業會嚴重影響平時成績，建議盡快補交。\n`;
        } else if (totalAssignments > 0) {
          riskAnalysis += `目前有 ${totalAssignments} 份待繳作業，都還沒逾期，繼續保持！\n`;
        }

        riskAnalysis +=
          '\n💡 提醒：被當的主要因素是出席率不足、作業未交、期中期末考表現差。\n建議定期檢查作業截止日、維持出席，有問題及早和老師溝通。';

        // Use memory to personalize
        const memoryFacts = _agentMemory.learnedFacts.filter((f) => f.category === 'academic');
        if (memoryFacts.length > 0) {
          riskAnalysis +=
            '\n\n根據之前的對話，我記得：' +
            memoryFacts
              .slice(0, 3)
              .map((f) => f.fact)
              .join('、');
        }

        return {
          id: uid(),
          role: 'assistant',
          content: riskAnalysis,
          timestamp: new Date(),
          agentType: 'text',
          actions: [
            {
              label: '查看作業截止',
              action: 'navigate',
              params: { screen: 'Today', nested: '作業列表' },
            },
            {
              label: '查看成績',
              action: 'navigate',
              params: { screen: '我的', nested: 'GradesStack' },
            },
          ],
          suggestions: ['哪些作業快截止', '幫我請假', '設定作業提醒'],
        };
      }

      // ── 課程查詢（多種問法）──
      if (/課程|哪些課|修了|幾門課|本學期/.test(lowerMsg) && domain === 'academic') {
        if (_courses.length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content: '目前沒有課程資料。請先同步你的課表！',
            timestamp: new Date(),
            agentType: 'text',
          };
        }
        const totalCredits = _courses.reduce((sum, c) => sum + (c.credits || 0), 0);
        const coursesByDay: Record<number, string[]> = {};
        _courses.forEach((c) => {
          getCourseMeetingsForChat(c).forEach((meeting: any) => {
            if (!coursesByDay[meeting.dayOfWeek]) coursesByDay[meeting.dayOfWeek] = [];
            coursesByDay[meeting.dayOfWeek].push(c.name);
          });
        });
        const dayNames = ['日', '一', '二', '三', '四', '五', '六'];
        let schedule = '';
        for (let d = 1; d <= 5; d++) {
          const dayCourses = coursesByDay[d];
          if (dayCourses && dayCourses.length > 0) {
            schedule += `週${dayNames[d]}：${dayCourses.join('、')}\n`;
          }
        }
        return {
          id: uid(),
          role: 'assistant',
          content: `已載入本學期 ${_courses.length} 門課（合計 ${totalCredits} 學分）：\n\n${schedule || _courses.map((c, i) => `${i + 1}. ${formatCourseSummaryForChat(c)}`).join('\n')}\n要查看詳細課表或各科成績嗎？`,
          timestamp: new Date(),
          agentType: 'text',
          actions: [
            { label: '前往課表', action: 'navigate', params: { screen: 'Today', nested: '課表' } },
          ],
          suggestions: ['今天有什麼課', '查成績', '哪些課可能被當'],
        };
      }

      // ── 畢業 / 學分相關 ──
      if (/畢業|學分|選課|修了多少/.test(lowerMsg)) {
        const totalCredits = _courses.reduce((sum, c) => sum + (c.credits || 0), 0);
        const requiredCredits = 128;
        const list =
          _courses.length > 0
            ? _courses
                .slice(0, 8)
                .map(
                  (c, i) =>
                    `${i + 1}. ${c.name}${typeof c.credits === 'number' ? `（${c.credits}學分）` : ''}`,
                )
                .join('\n')
            : '目前沒有載入本學期課程。';
        return {
          id: uid(),
          role: 'assistant',
          content: `目前我只拿得到已載入的課程資料，不會亂推歷年累計學分。\n\n已載入課程：${_courses.length} 門\n已載入課程合計：${totalCredits} 學分\n畢業門檻參考：${requiredCredits} 學分\n\n${list}\n\n要精準計算「還差多少學分」，需要同步歷年修課/學分試算資料；目前不能只用本學期課表推估。`,
          timestamp: new Date(),
          agentType: 'text',
          actions: [
            {
              label: '前往學分試算',
              action: 'navigate',
              params: { screen: '我的', nested: 'CreditAuditStack' },
            },
          ],
          suggestions: ['查成績', '查未繳作業', '選課建議'],
        };
      }

      // ── 作業 / 截止日 ──
      if (/作業|截止|期限|繳交|deadline|死線/.test(lowerMsg) && domain === 'academic') {
        if (_pendingAssignments.length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content: '目前沒有查到待繳的作業資料。\n\n如果確定有作業，可能需要老師在系統上發布。',
            timestamp: new Date(),
            agentType: 'text',
          };
        }
        const sorted = [..._pendingAssignments].sort((a, b) => {
          if (a.isLate && !b.isLate) return -1;
          if (!a.isLate && b.isLate) return 1;
          return 0;
        });
        const list = sorted
          .map(
            (a, i) =>
              `${i + 1}. ${a.isLate ? '🔴' : '🟢'} ${a.title}（${a.groupName}）${a.dueAt ? ` — 截止 ${a.dueAt}` : ''}${a.isLate ? ' ⚠️已逾期' : ''}`,
          )
          .join('\n');
        return {
          id: uid(),
          role: 'assistant',
          content: `你有 ${_pendingAssignments.length} 份待處理作業：\n\n${list}${sorted.some((a) => a.isLate) ? '\n\n⚠️ 有逾期的作業，建議盡快處理！' : ''}`,
          timestamp: new Date(),
          agentType: 'text',
          suggestions: ['設定截止提醒', '哪些可能被當', '幫我請假'],
        };
      }

      // ── 成績查詢 ──
      if (/成績|分數|gpa|排名|幾分/.test(lowerMsg)) {
        return {
          id: uid(),
          role: 'assistant',
          content: '成績資料需要從教務系統即時查詢才能確保正確。\n\n要前往成績查詢頁面嗎？',
          timestamp: new Date(),
          agentType: 'text',
          actions: [
            {
              label: '前往成績查詢',
              action: 'navigate',
              params: { screen: '我的', nested: 'GradesStack' },
            },
          ],
          suggestions: ['哪些課可能被當', '查學分', '查作業'],
        };
      }

      // ── 公告 ──
      if (/公告|消息|最新通知|學校公告/.test(lowerMsg)) {
        const recent = _announcements.slice(0, 3);
        if (recent.length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content: '目前沒有新的公告。稍後再看看吧！',
            timestamp: new Date(),
            agentType: 'text',
          };
        }
        const list = recent.map((a: any, i: number) => `${i + 1}. ${a.title}`).join('\n');
        return {
          id: uid(),
          role: 'assistant',
          content: `最近有 ${_announcements.length} 則公告：\n\n${list}\n\n想看哪一則的詳情？`,
          timestamp: new Date(),
          agentType: 'text',
          actions: recent.map((a: any) => ({
            label: `查看「${String(a.title).slice(0, 10)}…」`,
            action: 'navigate',
            params: { screen: 'Today', nested: '公告詳情', id: a.id },
          })),
        };
      }

      // ── 活動 ──
      if (/活動|報名|參加|社團/.test(lowerMsg) && domain === 'admin') {
        const upcoming = _events
          .filter((e: any) => {
            const s = toDate(e.startsAt);
            return s ? s > new Date() : false;
          })
          .slice(0, 3);
        if (upcoming.length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content: '近期沒有即將舉辦的活動。有新活動我會通知你！',
            timestamp: new Date(),
            agentType: 'text',
            suggestions: ['查公告', '推薦午餐'],
          };
        }
        const list = upcoming
          .map((e: any, i: number) => `${i + 1}. ${e.title}${e.location ? ` (${e.location})` : ''}`)
          .join('\n');
        return {
          id: uid(),
          role: 'assistant',
          content: `近期有 ${upcoming.length} 個活動：\n\n${list}\n\n想報名哪一個？`,
          timestamp: new Date(),
          agentType: 'text',
          actions: upcoming.map((e: any) => ({
            label: `報名「${String(e.title).slice(0, 8)}…」`,
            action: 'navigate',
            params: { screen: 'Today', nested: '活動詳情', id: e.id },
          })),
        };
      }

      // ── 地點 / 導航 ──
      if (/在哪|怎麼走|地點|導航|地圖|位置|路線/.test(lowerMsg)) {
        const locationKeywords = [
          '圖書館',
          '餐廳',
          '行政',
          '體育',
          '宿舍',
          '教室',
          '停車',
          '校門',
          '操場',
          '醫務',
        ];
        let keyword = locationKeywords.find((k) => lowerMsg.includes(k)) ?? '';
        const matches = keyword
          ? _pois.filter((p: any) => p.name.includes(keyword) || p.category.includes(keyword))
          : _pois.slice(0, 3);
        if (matches.length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content: '找不到這個地點，你可以直接去校園地圖搜尋！',
            timestamp: new Date(),
            agentType: 'text',
            actions: [{ label: '開啟地圖', action: 'navigate', params: { screen: '校園' } }],
          };
        }
        const poi = matches[0];
        return {
          id: uid(),
          role: 'assistant',
          content: `找到了！「${poi.name}」位於 ${poi.category} 區域。\n\n要開啟導航嗎？`,
          timestamp: new Date(),
          agentType: 'text',
          actions: [
            {
              label: '查看詳情',
              action: 'navigate',
              params: { screen: '校園', nested: 'PoiDetail', id: poi.id },
            },
            {
              label: '開始導航',
              action: 'navigate',
              params: { screen: '校園', nested: 'PoiDetail', id: poi.id },
            },
          ],
        };
      }

      // ── 課表 / 今天有什麼課 ──
      if (/課表|今天有什麼課|明天有什麼課|上什麼課/.test(lowerMsg)) {
        if (_courses.length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content: '目前沒有載入課程資料。你可以到設定中同步課表！',
            timestamp: new Date(),
            agentType: 'text',
          };
        }
        const { day: targetDay, label: dayLabel } = parseRequestedCourseDayForChat(lowerMsg);
        const dayRows = _courses
          .flatMap((course: any) =>
            getCourseMeetingsForChat(course)
              .filter((meeting: any) => meeting.dayOfWeek === targetDay)
              .map((meeting: any) => ({ course, meeting })),
          )
          .sort(
            (a: any, b: any) =>
              meetingSortValueForChat(a.meeting) - meetingSortValueForChat(b.meeting),
          );
        if (dayRows.length === 0) {
          return {
            id: uid(),
            role: 'assistant',
            content: `${dayLabel}沒有課喔！本學期共 ${_courses.length} 門課。\n\n要我幫你安排其他事嗎？`,
            timestamp: new Date(),
            agentType: 'text',
            suggestions: ['推薦午餐', '預約圖書館', '查作業截止'],
          };
        }
        const list = dayRows
          .map(
            ({ course, meeting }: any, i: number) =>
              `${i + 1}. ${course.name}（${formatMeetingTimeForChat(meeting)}${meeting.location ? `，${meeting.location}` : ''}${(course.teacher ?? course.instructor) ? `，${course.teacher ?? course.instructor}` : ''}）`,
          )
          .join('\n');
        return {
          id: uid(),
          role: 'assistant',
          content: `${dayLabel}有 ${dayRows.length} 堂課：\n\n${list}`,
          timestamp: new Date(),
          agentType: 'text',
          suggestions: ['幫我請假', '設定上課提醒'],
        };
      }

      // ── 餐飲推薦（用 domain guard 確保只在 dining context）──
      const isDiningQuery =
        /推薦|吃什麼|有什麼好吃|想吃|蔬菜|素食|便宜|平價|划算|省錢|健康|有哪些|其他|還有|別的|換|午餐|晚餐|早餐|覓食|好餓|肚子餓/.test(
          lowerMsg,
        );
      if (domain === 'dining' && isDiningQuery) {
        const menuItems = _menus;
        if (menuItems.length === 0) {
          const now = new Date();
          const hour = now.getHours();
          const mealTime = hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 17 ? '下午茶' : '晚餐';
          const cafeteriaList =
            diningCafeterias.length > 0
              ? diningCafeterias
                  .slice(0, 5)
                  .map(
                    (cafeteria, i) =>
                      `${i + 1}. ${cafeteria.name}（${cafeteria.location ?? '校內'}；${cafeteria.openingHours ?? '營業時間以現場公告為準'}）`,
                  )
                  .join('\n')
              : '目前沒有載入可驗證的校內餐廳清單。';
          const response = [
            `現在是${mealTime}時段，但目前沒有載入可驗證的單品菜單，所以我不亂編餐點或價格。`,
            '',
            '可確認的校內餐飲點：',
            cafeteriaList,
            '',
            '你可以指定餐廳或餐點，我會只用已載入的官方菜單資料幫你篩選。',
          ].join('\n');

          return {
            id: uid(),
            role: 'assistant',
            content: response,
            timestamp: new Date(),
            agentType: 'text',
            actions: [
              {
                label: '查看校園餐廳',
                action: 'navigate',
                params: { screen: '校園', nested: '餐廳總覽' },
              },
            ],
            suggestions: ['看靜園餐廳', '看宜園餐廳', '有素食嗎'],
          };
        }
        // Filter by dietary preference if mentioned
        const wantsCheap = /便宜|平價|划算|省|預算|CP/i.test(lowerMsg);
        const wantsOther = /其他|還有|別的|換/.test(lowerMsg);
        const hasAnyMenuPrice = menuItems.some((m: any) => typeof m.price === 'number');
        if (wantsCheap && !hasAnyMenuPrice) {
          return {
            id: uid(),
            role: 'assistant',
            content: [
              '目前官方餐廳資料沒有提供單品價格，所以我不能把白鬍子或 Morning House 直接排成「最便宜」。',
              '',
              '如果你想省錢，建議先看這幾類：',
              '1. 校內便利商店鮮食：飯糰、三明治、微波食品，通常比較好控預算。',
              '2. 靜園餐廳早餐/點心類：吐司、蛋餅、飲料類通常比完整套餐更適合小預算。',
              '3. 靜園或宜園的自助餐/主食櫃位：現場價格確認後通常比較有飽足感。',
              '',
              '要更準的價格，需要接校內店家菜單或讓使用者回報價格；目前離線版不亂標價。',
            ].join('\n'),
            timestamp: new Date(),
            agentType: 'text',
            suggestions: ['還有其他選擇嗎', '有素食嗎', '不想吃飯想吃麵'],
          };
        }

        let filtered = menuItems;
        let filterDesc = '';
        if (lowerMsg.includes('素食') || lowerMsg.includes('蔬菜')) {
          filtered = menuItems.filter((m: any) => /素|蔬|菜/.test(m.name ?? ''));
          filterDesc = '素食/蔬菜';
        } else if (wantsCheap) {
          filtered = [...menuItems].sort((a: any, b: any) => (a.price ?? 999) - (b.price ?? 999));
          filterDesc = '平價';
        }
        if (filtered.length === 0) filtered = menuItems;

        // Use memory for preferences
        const dietFacts = _agentMemory.learnedFacts.filter((f) => f.category === 'dietary');
        let memoryNote = '';
        if (dietFacts.length > 0) {
          memoryNote = `\n\n🧠 我記得你的偏好：${dietFacts.map((f) => f.fact).join('、')}`;
        }

        const page = wantsOther ? filtered.slice(5, 10) : filtered.slice(0, 5);
        const top = page.length > 0 ? page : filtered.slice(0, 5);
        const list = top
          .map((m: any, i: number) => {
            const priceText = typeof m.price === 'number' ? `$${m.price}` : '價格未提供';
            return `${i + 1}. ${m.name ?? '未命名'} — ${priceText}（${m.cafeteria ?? '校園餐廳'}）`;
          })
          .join('\n');
        const closing = isOfflineAI
          ? '想看哪一道的詳細資訊，或想換成便宜/素食/麵類，直接告訴我。'
          : '想直接訂哪一道？告訴我編號就好！';
        return {
          id: uid(),
          role: 'assistant',
          content: `${filterDesc ? `為你找到${filterDesc}選項` : wantsOther ? '其他餐點選擇' : '今天推薦'}：\n\n${list}${memoryNote}\n\n${closing}`,
          timestamp: new Date(),
          agentType: 'text',
          actions: [
            {
              label: '開啟 APP 點餐系統',
              action: 'navigate',
              params: { screen: '校園', nested: 'Ordering' },
              sensitivity: 'low',
            },
          ],
          suggestions: isOfflineAI
            ? ['便宜一點的', '還有其他選擇嗎', '有素食嗎']
            : ['幫我訂第1道', '還有其他選擇嗎', '便宜一點的'],
        };
      }

      // ── 天氣 ──
      if (domain === 'weather') {
        if (aiStatus.webSearchEnabled) return null;
        const month = new Date().getMonth() + 1;
        const seasonInfo =
          month >= 6 && month <= 9
            ? '夏季氣候偏熱，午後容易有雷陣雨，建議攜帶雨具'
            : month >= 10 && month <= 12
              ? '秋冬季節早晚溫差較大，建議帶件外套'
              : month >= 3 && month <= 5
                ? '春季天氣多變，建議留意氣象預報'
                : '冬季偏涼，請注意保暖';
        return {
          id: uid(),
          role: 'assistant',
          content: `靜宜大學位於台中沙鹿，${seasonInfo}。\n\n⚠️ 即時天氣資訊請查看氣象 APP 或中央氣象署網站以獲得最準確的預報。`,
          timestamp: new Date(),
          agentType: 'text',
          suggestions: ['查公車', '推薦午餐'],
        };
      }

      // ── 交通 / 公車 ──
      if (domain === 'transport') {
        return {
          id: uid(),
          role: 'assistant',
          content:
            '靜宜大學主要公車路線：\n\n• 300/307/308：往台中車站方向\n• 304：往清水方向\n• 統聯：往高鐵台中站\n\n⚠️ 即時到站資訊請查看「台中公車」APP 以獲得最準確的時間。\n\n要開啟校園地圖查看公車站位置嗎？',
          timestamp: new Date(),
          agentType: 'text',
          actions: [{ label: '查看公車站位置', action: 'navigate', params: { screen: '校園' } }],
          suggestions: ['校門在哪', '怎麼去台中車站'],
        };
      }

      // ── 功能介紹 / 幫助 ──
      if (domain === 'help') {
        const caps = getAgentCapabilitySummary(userRole);
        if (isOfflineAI) {
          return {
            id: uid(),
            role: 'assistant',
            content: `我是本機代理 AI。離線模式下不會連雲端 AI，也不會假裝學校系統或店家已接單。\n\n我能在手機內完成：\n• 拆解校園任務、收集缺少資料、顯示確認步驟\n• 餐廳已開通線上接單時，送到餐廳點餐 API\n• 校園餐飲、圖書館、宿舍、交通、健康資訊回答\n• 課表、作業、學分資料整理\n• 請假信、報修單、失物公告、群組訊息草稿\n• 課前、作業截止、逾期與重要公告的主動回報\n\n如果餐廳、學校正式系統、店家 POS 或第三方服務沒有 API，我只會建立草稿或開啟對應頁面，不會假裝已送出。`,
            timestamp: new Date(),
            agentType: 'text',
            suggestions: ['幫我訂午餐', '我不舒服', '宿舍冷氣壞了', '幫我請假'],
          };
        }
        return {
          id: uid(),
          role: 'assistant',
          content: `我是你的校園全能 AI 助理，可以幫你規劃並執行已串接的校園操作：\n\n${caps.join('\n')}\n\n餐廳已開通線上接單時，我會送到餐廳點餐 API；沒有正式 API 的項目，我會建立請假信或報修草稿，不會假裝已送出。\n試試說「幫我訂午餐」或「我想請假」。`,
          timestamp: new Date(),
          agentType: 'text',
          suggestions: ['幫我訂午餐', '我頭有點痛', '幫我查成績'],
        };
      }

      // ── 打招呼 ──
      if (domain === 'greeting' && lowerMsg.length < 10) {
        const hour = new Date().getHours();
        const timeGreet = hour < 12 ? '早安' : hour < 18 ? '午安' : '晚安';
        const name = auth.profile?.displayName?.split(' ')[0] ?? '同學';
        // Use memory to personalize
        const recentTopics = _agentMemory.recentActions.slice(-3);
        let personalized = '';
        if (recentTopics.length > 0) {
          personalized = '\n\n上次我們聊到了一些事，需要繼續處理嗎？';
        }
        return {
          id: uid(),
          role: 'assistant',
          content: `${timeGreet}，${name}！有什麼我可以幫你的嗎？${personalized}`,
          timestamp: new Date(),
          agentType: 'text',
          suggestions: ['幫我推薦午餐', '查作業截止', '今天有什麼課'],
        };
      }

      // ── 感謝 ──
      if (domain === 'thanks') {
        return {
          id: uid(),
          role: 'assistant',
          content: '不客氣！有需要隨時叫我 😊',
          timestamp: new Date(),
          agentType: 'text',
        };
      }

      // ── 知識圖譜推理：嘗試從所有 APP 資料中找到相關資訊 ──
      if (knowledgeGraph.length > 0 && lowerMsg.length >= 4) {
        const kgResult = queryKnowledgeGraph(knowledgeGraph, lowerMsg);
        if (kgResult.relevantNodes.length > 0) {
          const grouped: Record<string, string[]> = {};
          kgResult.relevantNodes.forEach((node) => {
            const typeLabel =
              node.type === 'course'
                ? '課程'
                : node.type === 'assignment'
                  ? '作業'
                  : node.type === 'menu'
                    ? '餐點'
                    : node.type === 'preference'
                      ? '你的偏好'
                      : node.type === 'event'
                        ? '活動'
                        : node.type === 'poi'
                          ? '地點'
                          : '相關';
            if (!grouped[typeLabel]) grouped[typeLabel] = [];
            grouped[typeLabel].push(node.label);
          });
          const summary = Object.entries(grouped)
            .map(
              ([type, items]) =>
                `${type}：${items.slice(0, 3).join('、')}${items.length > 3 ? ` 等 ${items.length} 項` : ''}`,
            )
            .join('\n');
          return {
            id: uid(),
            role: 'assistant',
            content: `根據 APP 中的資料，我找到以下可能相關的內容：\n\n${summary}\n\n需要我進一步查詢哪個方面嗎？`,
            timestamp: new Date(),
            agentType: 'text',
            suggestions: Object.keys(grouped)
              .slice(0, 3)
              .map((t) => `查看${t}詳情`),
          };
        }
      }

      return null; // No local match → fall through to AI service
    } catch (smartErr) {
      console.warn('[AIChat] generateSmartResponse error:', smartErr);
      return null; // 出錯就跳過本地回答，讓 AI 引擎或 Gemini 接手
    }
  }

  function isOfflineDraftOnlyTool(tool: AgentTool): boolean {
    if (!isOfflineAI) return false;
    const localInfoTools = new Set([
      'recommend_meal',
      'symptom_check',
      'check_grades',
      'check_assignments',
      'check_bus',
      'check_print_balance',
    ]);
    return tool.requiresConfirmation || !localInfoTools.has(tool.id);
  }

  function findDiningMenuForParams(
    params: Record<string, any>,
    userMessage = '',
  ): MenuItem | undefined {
    const requestedId = String(params.menuItemId ?? params.itemId ?? '').trim();
    if (requestedId) {
      const byId = diningMenus.find((menu) => menu.id === requestedId);
      if (byId) return byId;
    }

    const requestedItem = compactText(params.items || params.item || params.title || userMessage);
    const requestedCafeteria = resolveDiningCafeteriaLabel(params.cafeteria, diningCafeterias);
    const cafeteriaText = compactText(requestedCafeteria);

    const menuPool =
      cafeteriaText && cafeteriaText !== compactText('校內餐廳')
        ? diningMenus.filter(
            (menu) =>
              compactText(menu.cafeteria).includes(cafeteriaText) ||
              cafeteriaText.includes(compactText(menu.cafeteria)),
          )
        : diningMenus;

    if (!requestedItem) return menuPool[0] ?? diningMenus[0];

    const exact = menuPool.find((menu) => compactText(menu.name) === requestedItem);
    if (exact) return exact;

    return (
      menuPool.find((menu) => {
        const name = compactText(menu.name);
        return (
          name.includes(requestedItem) ||
          requestedItem.includes(name) ||
          DINING_FOOD_KEYWORDS.some(
            (keyword) =>
              requestedItem.includes(compactText(keyword)) && name.includes(compactText(keyword)),
          )
        );
      }) ??
      diningMenus.find((menu) => {
        const name = compactText(menu.name);
        return name.includes(requestedItem) || requestedItem.includes(name);
      })
    );
  }

  function findDiningCafeteriaForParams(
    params: Record<string, any>,
    userMessage = '',
  ): Cafeteria | undefined {
    const selectedMenu = findDiningMenuForParams(params, userMessage);
    if (selectedMenu?.cafeteriaId) {
      const byId = diningCafeterias.find((cafeteria) => cafeteria.id === selectedMenu.cafeteriaId);
      if (byId) return byId;
    }
    const cafeteriaName =
      selectedMenu?.cafeteria ?? resolveDiningCafeteriaLabel(params.cafeteria, diningCafeterias);
    return diningCafeterias.find(
      (cafeteria) =>
        cafeteria.name === cafeteriaName ||
        cafeteria.name.includes(cafeteriaName) ||
        cafeteriaName.includes(cafeteria.name),
    );
  }

  function buildDiningOrderParams(
    params: Record<string, any>,
    userMessage = '',
  ): Record<string, unknown> {
    const selectedMenu = findDiningMenuForParams(params, userMessage);
    const selectedCafeteria = findDiningCafeteriaForParams(params, userMessage);
    const cafeteriaName =
      selectedCafeteria?.name ??
      selectedMenu?.cafeteria ??
      resolveDiningCafeteriaLabel(params.cafeteria, diningCafeterias);
    return {
      screen: '校園',
      nested: 'Ordering',
      cafeteriaId: selectedCafeteria?.id ?? selectedMenu?.cafeteriaId,
      cafeteria: cafeteriaName,
      menuItemId: selectedMenu?.id,
      itemName: selectedMenu?.name ?? params.items ?? params.item,
      quantity: typeof params.quantity === 'number' ? params.quantity : 1,
      note: params.note,
      pickupTime: params.pickup_time,
      aiPrefill: true,
      source: 'ai_agent',
    };
  }

  function buildDiningOrderViewParams(
    params: Record<string, any>,
    userMessage = '',
  ): Record<string, unknown> {
    return {
      ...buildDiningOrderParams(params, userMessage),
      aiPrefill: false,
      initialTab: 2,
    };
  }

  function getRestaurantOrderingBlock(cafeteria?: Cafeteria): string | null {
    if (!cafeteria) return '找不到這間餐廳的點餐設定。';
    if (cafeteria.orderingEnabled !== true) return '這間餐廳尚未開通 APP 線上接單。';
    if (cafeteria.pilotStatus === 'inactive') return '這間餐廳的點餐功能目前未啟用。';
    if ((cafeteria.activeOperatorCount ?? 0) <= 0) return '這間餐廳目前沒有店員端在線接單。';
    return null;
  }

  function buildDiningOrderDraft(params: Record<string, any>, userMessage = ''): string {
    const selectedMenu = findDiningMenuForParams(params, userMessage);
    const selectedCafeteria = findDiningCafeteriaForParams(params, userMessage);
    const cafeteriaName =
      selectedCafeteria?.name ??
      selectedMenu?.cafeteria ??
      resolveDiningCafeteriaLabel(params.cafeteria, diningCafeterias);
    const itemName = selectedMenu?.name ?? params.items ?? '請補上想吃的餐點';
    const sourceLine = selectedMenu?.sourceLabel ? `\n• 資料來源：${selectedMenu.sourceLabel}` : '';
    const canUseAppOrder = Boolean(
      selectedCafeteria?.orderingEnabled &&
      (selectedCafeteria.activeOperatorCount ?? 0) > 0 &&
      selectedCafeteria.pilotStatus !== 'inactive',
    );
    const orderBoundary = canUseAppOrder
      ? '這間餐廳目前可接單；確認後會送到餐廳點餐系統，不會只寫本機紀錄。'
      : '這間餐廳目前尚未開通 APP 接單或沒有店員在線；我只能準備資料並開啟點餐頁查看狀態，不能假裝已送到店家。';
    return [
      '已準備餐廳點餐資料（未送出）。',
      '',
      '代理已完成選餐整理，下一步必須交給餐廳點餐功能處理：',
      `• 餐點：${itemName}`,
      `• 餐廳：${cafeteriaName}`,
      `• 價格：${formatDiningPrice(selectedMenu)}`,
      `• 取餐時間：${params.pickup_time || '盡快'}`,
      `• 備註：${params.note || '無'}${sourceLine}`,
      '',
      orderBoundary,
    ].join('\n');
  }

  function buildDiningWaitTimeMessage(): string {
    const cafeteriaList = (diningCafeterias.length > 0 ? diningCafeterias : [])
      .slice(0, 4)
      .map(
        (cafeteria, i) =>
          `${i + 1}. ${cafeteria.name}（${cafeteria.openingHours ?? '營業時間以現場公告為準'}）`,
      )
      .join('\n');
    return [
      '目前沒有即時排隊/取餐叫號資料，所以不能回報幾分鐘會輪到你。',
      '',
      '我能提供的可靠資訊是校內餐飲點與營業公告：',
      cafeteriaList || '目前沒有載入可驗證的校內餐飲點。',
      '',
      '要做到真正代理等候查詢，需要串接店家叫號、POS 或人流回報資料；離線模式只會給避開尖峰的建議，不會編造即時等候時間。',
    ].join('\n');
  }

  function buildToolAppActions(
    tool: AgentTool,
    params: Record<string, any>,
    userMessage = '',
  ): AssistantActionProposal[] {
    const roleAllowed = userRole === 'admin' || tool.roleAccess.includes(userRole);
    if (!roleAllowed) {
      return [
        {
          label: '查看可用功能',
          action: 'navigate',
          params: {
            screen: userRole === 'faculty' ? '教學' : userRole === 'staff' ? '服務' : 'Today',
          },
          sensitivity: 'low',
        },
      ];
    }

    switch (tool.id) {
      case 'order_meal':
        return [
          {
            label: '開啟餐廳點餐功能',
            action: 'navigate',
            params: buildDiningOrderParams(params, userMessage),
            sensitivity: 'medium',
            status: 'pending_confirmation',
          },
          {
            label: '查看餐廳總覽',
            action: 'navigate',
            params: { screen: '校園', nested: '餐廳總覽' },
            sensitivity: 'low',
          },
        ];
      case 'recommend_meal':
      case 'check_wait_time':
        return [
          {
            label: '開啟餐廳/點餐系統',
            action: 'navigate',
            params: { screen: '校園', nested: 'Ordering' },
            sensitivity: 'low',
          },
        ];
      case 'reserve_seat':
      case 'search_book':
        return [
          {
            label: '開啟圖書館功能',
            action: 'navigate',
            params: { screen: '校園', nested: 'Library' },
            sensitivity: 'low',
          },
        ];
      case 'book_health':
      case 'symptom_check':
      case 'record_mood':
        return [
          {
            label: '開啟校園健康功能',
            action: 'navigate',
            params: { screen: '校園', nested: 'Health' },
            sensitivity: 'medium',
          },
        ];
      case 'report_repair':
      case 'check_laundry':
      case 'check_package':
        return [
          {
            label: '開啟宿舍服務',
            action: 'navigate',
            params: { screen: '校園', nested: 'Dormitory' },
            sensitivity: 'medium',
          },
        ];
      case 'post_lost':
        return [
          {
            label: '開啟失物發布',
            action: 'navigate',
            params: { screen: '校園', nested: 'LostFoundPost' },
            sensitivity: 'medium',
          },
        ];
      case 'search_found':
        return [
          {
            label: '開啟失物招領',
            action: 'navigate',
            params: { screen: '校園', nested: 'LostFound' },
            sensitivity: 'low',
          },
        ];
      case 'request_leave':
      case 'check_assignments':
        return [
          {
            label: '開啟課程/作業功能',
            action: 'navigate',
            params: { screen: '課程', nested: 'CoursesHome' },
            sensitivity: 'medium',
          },
        ];
      case 'check_grades':
        return [
          {
            label: '開啟成績查詢',
            action: 'navigate',
            params: { screen: '課程', nested: 'Grades' },
            sensitivity: 'sensitive',
          },
        ];
      case 'set_reminder':
        return [
          {
            label: '開啟智慧行事曆',
            action: 'navigate',
            params: { screen: 'Today', nested: 'SmartCalendarScreen' },
            sensitivity: 'low',
          },
        ];
      case 'send_message':
        return [
          {
            label: '開啟收件匣/訊息',
            action: 'navigate',
            params: { screen: '收件匣', nested: 'MessagesHome' },
            sensitivity: 'medium',
          },
        ];
      case 'check_print_balance':
        return [
          {
            label: '開啟列印服務',
            action: 'navigate',
            params: { screen: '校園', nested: 'PrintService' },
            sensitivity: 'low',
          },
        ];
      case 'assignment_publish':
      case 'peer_review_assign':
      case 'attendance_alert':
      case 'learning_insight':
        return [
          {
            label: '開啟教學管理功能',
            action: 'navigate',
            params: { screen: '教學', nested: 'CourseHub' },
            sensitivity: 'high',
          },
        ];
      default:
        return [];
    }
  }

  function buildToolSuccessActions(
    tool: AgentTool,
    params: Record<string, any>,
    userMessage = '',
  ): AssistantActionProposal[] {
    if (tool.id === 'order_meal') {
      return [
        {
          label: '查看我的訂單',
          action: 'navigate',
          params: buildDiningOrderViewParams(params, userMessage),
          sensitivity: 'low',
          status: 'confirmed',
        },
        {
          label: '再點一份',
          action: 'navigate',
          params: buildDiningOrderParams(params, userMessage),
          sensitivity: 'low',
        },
      ];
    }
    return buildToolAppActions(tool, params, userMessage);
  }

  async function executeConfirmedToolResult(
    tool: AgentTool,
    params: Record<string, any>,
  ): Promise<AIActionExecutionResult> {
    return executeAgentToolAction({
      tool,
      params,
      userId: auth.user?.uid,
      schoolId: school.id,
      role: userRole,
      dataSource: ds,
      isOnline: isEffectivelyOnline(),
      courses: courses as any,
      cafeterias: diningCafeterias,
      menus: diningMenus,
      pendingAssignments: pendingAssignments as any,
      userMessage: String(params.__chainUserMessage ?? ''),
    });
  }

  function buildOfflineToolResult(
    tool: AgentTool,
    params: Record<string, any>,
    userMessage = '',
  ): string | null {
    if (!isOfflineAI) return null;
    const subject =
      params.items ||
      params.title ||
      params.course ||
      params.item ||
      params.query ||
      userMessage ||
      '這件事';

    switch (tool.id) {
      case 'order_meal':
        return buildDiningOrderDraft(params, userMessage);
      case 'book_health':
        return `本機代理模式不能直接送出掛號預約。\n\n我幫你整理預約資訊：\n• 類型：${params.department === 'mental' ? '心理諮商' : params.department === 'dental' ? '牙科' : '一般門診'}\n• 地點：至善樓 1F 衛保組；心理諮商在至善樓 2F\n• 時間：週一到週五 09:00-16:30\n• 症狀/需求：${params.symptom || userMessage || '請補上'}\n\n到線上預約或撥打校內分機時可以直接使用這段內容。`;
      case 'reserve_seat':
        return `本機代理模式不能直接預約圖書館座位。\n\n我幫你整理預約需求：\n• 類型：${params.type === 'group_room' ? '團體討論室' : params.type === 'quiet_zone' ? '安靜閱覽區' : '個人自習座位'}\n• 日期：${params.date || '請補上'}\n• 時段：${params.time_slot || '請補上'}\n• 樓層：${params.floor || '不限'}\n\n蓋夏圖書館開放時間：週一到週五 08:00-21:30，週六日 09:00-17:00。`;
      case 'report_repair':
        return `本機代理模式不能直接送出宿舍報修單。\n\n我幫你整理報修草稿：\n• 類別：${params.category === 'ac' ? '冷氣/空調' : params.category === 'plumbing' ? '水管/衛浴' : params.category === 'network' ? '網路' : '設施問題'}\n• 房號：${params.room || '請補上'}\n• 問題描述：${params.description || userMessage || '請補上'}\n• 急迫度：${params.urgency || '一般'}\n\n送出前請確認房號與描述，避免維修人員找不到問題。`;
      case 'post_lost':
        return `本機代理模式不能直接發布失物公告。\n\n我幫你寫好公告草稿：\n「我遺失了${params.item || subject}，可能地點是${params.location || '請補上地點'}。物品特徵：${params.features || '請補上顏色、品牌、貼紙或其他辨識點'}。若有人拾獲，請透過校園 App 或學務處聯絡我，謝謝。」`;
      case 'request_leave':
        return `本機代理模式不能直接送出請假申請。\n\n請假信草稿：\n「老師您好，我想申請${params.reason === 'sick' ? '病假' : params.reason === 'official' ? '公假' : '事假'}。課程：${params.course || '請補上課程名稱'}；日期：${params.date || '請補上日期'}；原因：${params.detail || params.description || userMessage || '請補上原因'}。若需要證明文件，我會再補上，謝謝老師。」`;
      case 'send_message':
        return `本機代理模式不能直接發送訊息。\n\n訊息草稿：\n收件人：${params.recipient || '請補上'}\n內容：${params.content || userMessage || '請補上訊息內容'}\n\n你可以複製這段到課程群組或站內訊息。`;
      case 'set_reminder':
        return `本機代理模式目前不建立系統推播。\n\n提醒草稿：\n• 內容：${params.title || userMessage || '請補上'}\n• 時間：${params.datetime || '請補上'}\n\n你可以到手機行事曆或 App 提醒功能新增。`;
      case 'check_wait_time':
        return buildDiningWaitTimeMessage();
      case 'check_laundry':
        return '離線模式不能查即時洗衣機狀態。宿舍洗衣房通常在希嘉學苑與思高學苑 1F，尖峰常在晚上 20:00-22:00。建議先到洗衣房確認機台，再設定手機倒數提醒。';
      case 'check_package':
        return '離線模式不能查即時包裹。一般領取地點是宿舍管理室，時間約 08:00-21:00，記得帶學生證。若 App 有包裹模組，請到該頁面查看最新資料。';
      case 'search_book':
        return `離線模式不能查即時館藏。\n\n你要找的是：${params.query || userMessage || '請補上書名'}\n建議到蓋夏圖書館館藏系統搜尋書名、作者或 ISBN；如果只是想找自習空間，我可以幫你整理圖書館座位資訊。`;
      case 'record_mood':
        return `我先在這次對話中記下你的狀態：${userMessage || '今天需要多照顧自己'}。\n\n如果這種狀態持續好幾天，建議找朋友聊聊，或預約至善樓 2F 諮商中心。離線模式不會把這段送到雲端。`;
      default:
        if (
          tool.requiresConfirmation ||
          /publish|assign|alert|order|invite|match|trade|message|print|leave|repair/.test(tool.id)
        ) {
          return `本機代理模式不會真的執行「${tool.name}」。\n\n我可以先幫你整理草稿或檢查資訊，但送出、通知、配對、下單這類操作需要連到正式後端後才能完成。`;
        }
        return null;
    }
  }

  function createOfflineToolDraftMessage(
    tool: AgentTool,
    params: Record<string, any>,
    userMessage: string,
  ): Message {
    return {
      id: genMsgId(),
      role: 'assistant',
      content:
        buildOfflineToolResult(tool, params, userMessage) ??
        `本機代理模式下，我只能幫你整理「${tool.name}」所需資訊，不能真的送出操作。`,
      timestamp: new Date(),
      agentType: 'text',
      actions: buildToolAppActions(tool, params, userMessage),
      suggestions: ['補充資料', '改寫草稿', '問其他問題'],
    };
  }

  // ── Start Tool Execution (with param collection) ──
  function startToolExecution(tool: AgentTool, userMessage: string) {
    const autoParams = extractParamsFromMessage(tool, userMessage);
    const requiredMissing = tool.parameters.filter((p) => p.required && !(p.name in autoParams));

    if (requiredMissing.length > 0) {
      // Need to collect params
      const nextParam = requiredMissing[0];
      setAgentContext((prev) => ({
        ...prev,
        state: 'collecting_params',
        currentTool: tool.id,
        collectedParams: autoParams,
      }));

      const collectMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content: `好的，我來幫你${tool.name}！需要一些資訊：`,
        timestamp: new Date(),
        agentType: 'param_collect',
        paramCollect: { tool, collected: autoParams, nextParam },
      };
      return collectMsg;
    }

    // All params ready — confirm or execute directly
    if (tool.requiresConfirmation) {
      return createConfirmMessage(tool, autoParams);
    }
    return executeToolImmediately(tool, autoParams);
  }

  function extractParamsFromMessage(tool: AgentTool, msg: string): Record<string, any> {
    const params: Record<string, any> = {};
    // Smart extraction based on tool type
    if (tool.id === 'order_meal' || tool.id === 'recommend_meal') {
      const compactMsg = compactText(msg);
      if (tool.id === 'order_meal') {
        const recentChoiceParams = resolveRecentDiningChoiceParams(msg);
        if (recentChoiceParams) {
          Object.assign(params, recentChoiceParams);
        }
      }
      if (
        /靜園|白鬍子|morninghouse|狠犟|川福|小林自助餐|樂亭|湯才|極壽喜燒|極咖哩|左撇子|酸菜魚|車輪餅|雞蛋糕/.test(
          compactMsg,
        )
      ) {
        params.cafeteria = 'jingyuan';
      } else if (
        /宜園|早安山丘|永和豆漿|宜園小廚|四海遊龍|王者香|炸雞大獅|咖喱大叔|yami/.test(compactMsg)
      ) {
        params.cafeteria = 'yiyuan';
      } else if (/至善.*二樓|至善2樓|至善二樓|路易莎/.test(compactMsg)) {
        params.cafeteria = 'zhishan-2f';
      } else if (/至善|全家|好吃鮮果|飯捲|拉麵/.test(compactMsg)) {
        params.cafeteria = 'zhishan-1f';
      } else if (/小木屋|鬆餅/.test(compactMsg)) {
        params.cafeteria = 'shawmu';
      } else if (/ok|便利商店|超商/.test(compactMsg)) {
        params.cafeteria = 'okmart';
      }

      const matchedMenu = diningMenus.find((menu) => {
        const name = compactText(menu.name);
        return compactMsg.includes(name) || name.includes(compactMsg);
      });
      if (matchedMenu) {
        params.menuItemId = matchedMenu.id;
        params.items = matchedMenu.name;
        params.cafeteria = matchedMenu.cafeteriaId?.split('-caf-').pop() ?? params.cafeteria;
      } else {
        for (const food of DINING_FOOD_KEYWORDS) {
          if (compactMsg.includes(compactText(food))) {
            params.items = food;
            break;
          }
        }
      }
      // Budget
      const budgetMatch = msg.match(/(\d+)\s*元/);
      if (budgetMatch) params.budget = parseInt(budgetMatch[1]);
      const quantityMatch = msg.match(
        /([1-9一二三四五六七八九十１２３４５６７８９])\s*(?:份|杯|個|碗|盒)/,
      );
      const quantity = quantityMatch ? parseSmallPositiveInt(quantityMatch[1]) : null;
      if (quantity) params.quantity = quantity;
      if (/現在|馬上|立刻|盡快|越快越好/.test(msg)) params.pickup_time = '盡快';
      const timeMatch = msg.match(/(\d{1,2})[:：點](\d{1,2})?/);
      if (timeMatch) params.pickup_time = `${timeMatch[1]}:${timeMatch[2] ?? '00'}`;
    }
    if (tool.id === 'book_health') {
      if (msg.includes('諮商') || msg.includes('心理')) params.department = 'mental';
      if (msg.includes('牙') || msg.includes('牙齒')) params.department = 'dental';
      if (msg.includes('運動傷害')) params.department = 'sports_injury';
      if (!params.department && /頭痛|肚子痛|發燒|感冒|咳嗽|不舒服|喉嚨痛|頭暈|想吐/.test(msg))
        params.department = 'general';
      if (/今天/.test(msg)) params.date = '今天';
      if (/明天/.test(msg)) params.date = '明天';
      if (/頭痛|肚子痛|發燒|感冒|咳嗽|不舒服|喉嚨痛|頭暈|想吐/.test(msg)) params.symptom = msg;
    }
    if (tool.id === 'request_leave') {
      if (msg.includes('病假')) params.reason = 'sick';
      if (msg.includes('事假')) params.reason = 'personal';
      if (msg.includes('公假')) params.reason = 'official';
      if (/生病|不舒服|頭痛|發燒|感冒/.test(msg) && !params.reason) params.reason = 'sick';
      if (/今天/.test(msg)) params.date = '今天';
      if (/明天/.test(msg)) params.date = '明天';
      if (/後天/.test(msg)) params.date = '後天';
      params.detail = msg;
      // Try to extract course name from user's courses
      for (const c of courses ?? []) {
        if (msg.includes(c.name)) {
          params.course = c.name;
          break;
        }
      }
      if (!params.course && (courses ?? []).length === 1) params.course = courses[0].name;
    }
    if (tool.id === 'report_repair') {
      if (msg.includes('冷氣') || msg.includes('空調')) params.category = 'ac';
      if (msg.includes('水管') || msg.includes('馬桶')) params.category = 'plumbing';
      if (msg.includes('電') || msg.includes('燈')) params.category = 'electrical';
      if (msg.includes('網路')) params.category = 'network';
      params.description = msg;
      const roomMatch = msg.match(/(?:房號|房間|寢室|宿舍)\s*([A-Za-z0-9\-號房]+)/);
      if (roomMatch) params.room = roomMatch[1];
      if (/緊急|很急|漏水|不能用/.test(msg)) params.urgency = 'high';
    }
    if (tool.id === 'reserve_seat') {
      if (msg.includes('討論室') || msg.includes('團體')) params.type = 'group_room';
      else if (msg.includes('安靜')) params.type = 'quiet_zone';
      else params.type = 'individual';
      if (/今天/.test(msg)) params.date = '今天';
      if (/明天/.test(msg)) params.date = '明天';
      if (/上午|早上/.test(msg)) params.time_slot = 'morning';
      if (/下午/.test(msg)) params.time_slot = 'afternoon';
      if (/晚上|晚間/.test(msg)) params.time_slot = 'evening';
    }
    if (tool.id === 'set_reminder') {
      // Extract reminder content
      const afterRemind = msg.match(/提醒[我]?(.+)/);
      if (afterRemind) params.title = afterRemind[1].trim();
      if (/今天/.test(msg)) params.datetime = '今天';
      if (/明天/.test(msg)) params.datetime = '明天';
      if (/後天/.test(msg)) params.datetime = '後天';
      const timeMatch = msg.match(/(\d{1,2})[:：點](\d{1,2})?/);
      if (timeMatch)
        params.datetime = `${params.datetime ?? ''} ${timeMatch[1]}:${timeMatch[2] ?? '00'}`.trim();
    }
    if (tool.id === 'symptom_check') {
      params.symptoms = msg;
    }
    if (tool.id === 'search_found' || tool.id === 'search_book') {
      params.keyword = msg.replace(/搜尋|查詢|找|借/g, '').trim();
      params.query = params.keyword;
    }
    return params;
  }

  function createConfirmMessage(tool: AgentTool, params: Record<string, any>): Message {
    const execId = genMsgId('exec');
    const execution: ToolExecution = {
      id: execId,
      toolId: tool.id,
      status: 'confirming',
      params,
      startedAt: new Date().toISOString(),
      confirmationMessage: `確認要${tool.name}嗎？`,
    };
    setAgentContext((prev) => ({
      ...prev,
      state: 'confirming',
      currentTool: tool.id,
      collectedParams: params,
      pendingConfirmation: execId,
    }));
    return {
      id: genMsgId(),
      role: 'assistant',
      content: `我已準備好幫你${tool.name}，請確認以下內容：`,
      timestamp: new Date(),
      agentType: 'tool_confirm',
      toolExecution: execution,
    };
  }

  function executeToolImmediately(tool: AgentTool, params: Record<string, any>): Message {
    // Simulate immediate execution
    const execId = genMsgId('exec');
    const result = simulateToolResult(tool, params);
    const execution: ToolExecution = {
      id: execId,
      toolId: tool.id,
      status: 'success',
      params,
      result,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    if (!isOfflineAI) {
      setRecentExecutions((prev) => [execution, ...prev].slice(0, 5));
    }
    setAgentContext((prev) => ({ ...prev, state: 'reporting', currentTool: undefined }));
    return {
      id: genMsgId(),
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      agentType: 'tool_result',
      toolExecution: execution,
      actions: buildToolAppActions(tool, params),
      suggestions: tool.relatedTools
        ? tool.relatedTools
            .slice(0, 2)
            .map((rid) => {
              const rt = getToolById(rid);
              return rt ? `幫我${rt.name}` : '';
            })
            .filter(Boolean)
        : undefined,
    };
  }

  function simulateToolResult(tool: AgentTool, params: Record<string, any>): string {
    const offlineResult = buildOfflineToolResult(tool, params);
    if (offlineResult) return offlineResult;

    switch (tool.id) {
      case 'order_meal':
        return buildDiningOrderDraft(params);
      case 'recommend_meal': {
        // 使用已驗證校園菜單資料，不用舊 mock 餐廳
        const menuData = diningMenus as any[];
        if (menuData.length === 0) {
          const hour = new Date().getHours();
          const mealLabel = hour < 10 ? '早餐' : hour < 14 ? '午餐' : '晚餐';
          const cafeteriaList = diningCafeterias
            .slice(0, 5)
            .map((cafeteria, i) => `${i + 1}. ${cafeteria.name}（${cafeteria.location ?? '校內'}）`)
            .join('\n');
          return `推薦${mealLabel}前，我需要先有可驗證菜單；目前沒有載入單品資料，所以不亂編餐點或價格。\n\n可確認的校內餐飲點：\n${cafeteriaList || '尚未載入'}\n\n請到餐廳頁同步資料，或指定餐廳/餐點讓我從官方 catalog 篩選。`;
        }
        const wantsVeg = /素|蔬菜|菜|沙拉|健康|清淡/.test(JSON.stringify(params));
        const wantsCheap = /便宜|划算|省/.test(JSON.stringify(params));
        let filtered = menuData;
        if (wantsVeg) filtered = menuData.filter((m: any) => /素|蔬|菜|沙拉/.test(m.name ?? ''));
        else if (wantsCheap)
          filtered = [...menuData].sort((a: any, b: any) => (a.price ?? 999) - (b.price ?? 999));
        if (filtered.length === 0) filtered = menuData;
        const top = filtered.slice(0, 5);
        const recs = top.map((m: any, i: number) => {
          const priceText = typeof m.price === 'number' ? `$${m.price}` : '價格未提供';
          return `${i + 1}. ${m.name ?? '餐點'} — ${priceText}（${m.cafeteria ?? '校園餐廳'}）`;
        });
        return `根據你的偏好，今天推薦：\n\n${recs.join('\n')}\n\n${isOfflineAI ? '想看哪一道的詳細資訊，或想換條件，直接告訴我。' : '想直接訂哪一道？告訴我編號就好！'}`;
      }
      case 'check_wait_time':
        return buildDiningWaitTimeMessage();
      case 'book_health':
        return `已預約成功！\n科別：${params.department === 'mental' ? '心理諮商' : params.department === 'dental' ? '牙科' : '一般門診'}\n時間：${params.date || '明天'} 上午 10:00\n地點：衛保組 2F\n\n請記得攜帶學生證。`;
      case 'symptom_check':
        return `根據你的描述分析：\n\n症狀嚴重度：輕度\n建議：多休息、補充水分\n如果持續超過 2 天，建議到衛保組就診。\n\n需要我幫你預約掛號嗎？`;
      case 'record_mood':
        return `已記錄今天的心情！\n情緒：${params.level === '5' ? '很好' : params.level === '4' ? '不錯' : params.level === '3' ? '普通' : '需關注'}\n\n本週心情趨勢：穩定偏好 📈\n連續記錄 ${Math.floor(Math.random() * 10) + 3} 天！`;
      case 'reserve_seat':
        return `已預約成功！\n類型：${params.type === 'group_room' ? '團體討論室 B' : params.type === 'quiet_zone' ? '安靜閱覽區' : '個人自習座位 A-23'}\n樓層：${params.floor || '3F'}\n時段：${params.time_slot === 'morning' ? '上午' : params.time_slot === 'evening' ? '晚上' : '下午'}\n\n請於預約時段開始 15 分鐘內入座。`;
      case 'search_book':
        return `查詢結果：\n\n1.「${params.query || '程式設計'}」— 館藏 3 本，可借 2 本\n   位置：2F 書庫 005.1 區\n\n2. 相關推薦：「資料結構與演算法」— 可借\n\n需要我幫你預約借閱嗎？`;
      case 'report_repair':
        return `維修單已提交！\n\n工單編號：RP-${Date.now().toString().slice(-6)}\n類別：${params.category === 'ac' ? '冷氣/暖氣' : params.category === 'plumbing' ? '水管/馬桶' : '設施維修'}\n房號：${params.room || '未指定'}\n預計處理時間：1-3 個工作天\n\n我會在維修完成時通知你。`;
      case 'check_laundry':
        return '洗衣機使用狀態：\n\n希嘉學苑：\n  1號 — 使用中（剩餘 23 分鐘）\n  2號 — 空閒 ✅\n  3號 — 空閒 ✅\n\n思高學苑：\n  1號 — 使用中（剩餘 41 分鐘）\n  2號 — 空閒 ✅';
      case 'check_package':
        return '你有 1 個待領包裹！\n\n黑貓宅急便，4/26 送達\n存放位置：宿舍管理室\n\n請攜帶學生證前往領取（開放時間 8:00-21:00）。';
      case 'post_lost':
        return `遺失公告已發布！\n\n物品：${params.item || '物品'}\n地點：${params.location || '校園'}\n\nAI 正在自動比對拾獲物資料庫...\n目前找到 ${Math.random() > 0.5 ? '1' : '0'} 筆可能的配對。`;
      case 'request_leave':
        return `請假申請已提交！\n\n課程：${params.course || '課程'}\n假別：${params.reason === 'sick' ? '病假' : '事假'}\n日期：${params.date || '今天'}\n\n狀態：待教師審核\n我會在教師回覆後通知你。`;
      case 'check_grades':
        return '成績資料需要從教務系統即時查詢才能確保正確。\n\n正在前往成績查詢頁面...';
      case 'check_assignments': {
        const _pa = pendingAssignments ?? [];
        if (_pa.length === 0)
          return '目前沒有查到待繳的作業資料。\n\n如有作業，請確認老師已在系統上發布。';
        const list = _pa
          .map(
            (a, i) =>
              `${i + 1}. ${a.isLate ? '🔴' : '🟢'} ${a.title}（${a.groupName ?? ''}）${a.dueAt ? ` — 截止 ${new Date(a.dueAt.seconds * 1000).toLocaleDateString('zh-TW')}` : ''}${a.isLate ? ' ⚠️已逾期' : ''}`,
          )
          .join('\n');
        return `你有 ${_pa.length} 份待處理作業：\n\n${list}\n\n需要我設定提醒嗎？`;
      }
      case 'check_bus':
        return '靜宜大學主要公車路線：\n\n• 300/307/308：往台中車站方向\n• 304：往清水方向\n• 統聯：往高鐵台中站\n\n⚠️ 即時到站時間請查看「台中公車」APP。';
      case 'set_reminder':
        return `已設定提醒！\n\n內容：${params.title || '提醒'}\n時間：${params.datetime || '稍後'}\n\n到時間會推播通知你 🔔`;
      case 'check_print_balance':
        return '列印餘額需要登入影印系統才能查詢。\n\n可至圖書館 1F 儲值機查看餘額及加值。';
      case 'send_message':
        return `訊息已發送！\n\n收件人：${params.recipient || '群組'}\n內容：${params.content || '（訊息內容）'}\n\n狀態：已送達 ✓`;

      // ── 同儕互動工具 ──
      case 'peer_review':
        return `互評分配完成！\n\n作業：${params.assignment || '作業'}\n每人需評 3 份同儕作業\n評分標準：${params.criteria || '完整度、邏輯性、創意度'}\n\n截止時間：原作業截止後 3 天\n已通知所有參與的同學。`;
      case 'study_group_match': {
        const purpose =
          params.purpose === 'study'
            ? '讀書會'
            : params.purpose === 'project'
              ? '專題組員'
              : params.purpose === 'exam_prep'
                ? '考前衝刺'
                : '課業輔導';
        return `AI 配對完成！\n\n目的：${purpose}${params.course ? `\n課程：${params.course}` : ''}\n\n已找到 ${params.group_size || '3'} 位合適的同學：\n1. 王○明（同課程，作業完成率高）\n2. 李○華（上學期修過，成績優秀）\n3. 陳○文（擅長整理筆記）\n\n要我發送邀約訊息嗎？`;
      }
      case 'share_notes':
        return `筆記已分享至群組！\n\n課程：${params.course || '課程'}\n主題：${params.topic || '最新章節'}\n\nAI 已自動整理重點標記，群組內 ${Math.floor(Math.random() * 10) + 5} 位同學可以看到。`;
      case 'group_order':
        return `揪團訂餐草稿已建立（待送出）。\n\n餐廳：${resolveDiningCafeteriaLabel(params.cafeteria, diningCafeterias)}\n目前成員：${params.group_size || '待確認'}\n\n我可以先統整大家的餐點與分攤金額；真正送出合併訂單會交給 APP 內點餐系統或店家接單 API。`;
      case 'tutoring_request':
        return `課業求助已送出！\n\n科目：${params.subject || '課程'}\n急迫度：${params.urgency === 'high' ? '🔴 明天要交' : params.urgency === 'medium' ? '🟡 這週內' : '🟢 不急'}\n\nAI 已在校內尋找合適的輔導人選...\n找到 2 位可能的學長姐，已發送配對請求。`;
      case 'event_invite':
        return `活動邀約已發送！\n\n活動：${params.event || '活動'}\n已邀請：${params.friends || '好友們'}\n\n等待回覆中... 已有 1 人確認參加。`;
      case 'carpool_match':
        return `共乘配對搜尋中...\n\n方向：${params.direction === 'to_school' ? '到學校' : '回家'}\n時間：${params.time || '明天早上'}\n\n找到 1 位順路的同學！\n已發送共乘邀約，對方確認後會通知你。`;
      case 'secondhand_trade':
        return `${params.action === 'sell' ? '二手物品已上架' : '購買需求已登記'}！\n\n物品：${params.item || '物品'}\n${params.price ? `期望價格：$${params.price}` : ''}\n\nAI 正在比對${params.action === 'sell' ? '潛在買家' : '賣家'}...\n${Math.random() > 0.5 ? '找到 1 位有興趣的同學，已通知對方！' : '目前還沒有配對，有新配對時會通知你。'}`;
      case 'assignment_publish':
        return `作業已發布！\n\n課程：${params.course || '課程'}\n標題：${params.title || '作業'}\n截止日：${params.deadline || '下週'}\n\n已通知全班 ${Math.floor(Math.random() * 20) + 25} 位學生。`;
      case 'peer_review_assign':
        return `互評配對完成！\n\n作業：${params.assignment || '作業'}\n每人需評：${params.reviews_per_student || '3'} 份\n分配方式：AI 隨機配對（確保匿名且公平）\n\n已通知所有學生開始互評。`;
      case 'attendance_alert':
        return `出席警示已發送！\n\n課程：${params.course || '課程'}\n門檻：缺曠 ${params.threshold || '3'} 次\n\n偵測到 ${Math.floor(Math.random() * 3) + 1} 位學生達到警示標準\n已分別發送提醒，並通知導師。`;
      case 'learning_insight':
        return `全班學習分析報告已生成！\n\n課程：${params.course || '課程'}\n\n📊 關鍵數據：\n• 平均作業���成率：${Math.floor(Math.random() * 15) + 80}%\n• 需要關注的學生：${Math.floor(Math.random() * 3) + 1} 位\n• 最常見困難：期中範圍第 3-4 章\n\n已產生個別化建議，可分別發送給學生。`;

      default:
        return `${tool.name} 執行完成！`;
    }
  }

  // ── Task Chain Execution ──
  function startTaskChain(chain: TaskChain, userMessage: string) {
    setAgentContext((prev) => ({
      ...prev,
      state: 'executing',
      currentChain: chain.id,
      currentChainStep: 1,
      collectedParams: { __chainUserMessage: userMessage },
    }));

    const progressMsg: Message = {
      id: genMsgId(),
      role: 'assistant',
      content: `好的，我啟動「${chain.name}」流程，共 ${chain.steps.length} 個步驟：`,
      timestamp: new Date(),
      agentType: 'chain_progress',
      chainProgress: { chain, currentStep: 1, completedSteps: [] },
    };
    return progressMsg;
  }

  // ── Handle Confirm / Cancel ──
  const handleConfirmTool = useCallback(
    async (executionId: string) => {
      const originalExecMsg = messages.find((m) => m.toolExecution?.id === executionId);
      const originalExecution = originalExecMsg?.toolExecution;
      const tool = originalExecution ? getToolById(originalExecution.toolId) : null;
      if (!originalExecution || !tool) return;

      const params = originalExecution.params;
      const chainId = params.__chainId;
      const chainStep = Number(params.__chainStep);
      const isChainConfirm = Boolean(chainId);

      setMessages((prev) =>
        prev.map((m) => {
          if (m.toolExecution?.id !== executionId) return m;
          return {
            ...m,
            agentType: 'tool_executing' as AgentMessageType,
            toolExecution: {
              ...m.toolExecution,
              status: 'executing' as ToolExecutionStatus,
            },
          };
        }),
      );

      let status: ToolExecutionStatus = 'success';
      let result = '';
      let resultActions: AssistantActionProposal[] | undefined;
      try {
        const executionResult = await executeConfirmedToolResult(tool, params);
        status = executionResult.kind === 'blocked' ? 'failed' : 'success';
        result = executionResult.message;
        resultActions = executionResult.actions;
      } catch (error: any) {
        status = 'failed';
        result = `執行失敗：${error?.message ?? '無法完成這項操作'}`;
      }

      setMessages((prev) => {
        const updated = prev.map((m) => {
          if (m.toolExecution?.id !== executionId) return m;
          const updatedExec: ToolExecution = {
            ...m.toolExecution,
            status,
            result,
            completedAt: new Date().toISOString(),
          };
          if (status === 'success' && !isOfflineAI) {
            setRecentExecutions((r) => [updatedExec, ...r].slice(0, 5));
          }
          return {
            ...m,
            agentType: 'tool_result' as AgentMessageType,
            toolExecution: updatedExec,
            actions:
              resultActions ??
              (status === 'success'
                ? buildToolSuccessActions(tool, updatedExec.params)
                : buildToolAppActions(tool, updatedExec.params)),
          };
        });

        if (isChainConfirm && chainId && Number.isFinite(chainStep)) {
          const chain = TASK_CHAINS.find((c) => c.id === chainId);
          const step = chain?.steps.find((s) => s.order === chainStep);
          const lastChainIdx = updated
            .map((m, i) => (m.agentType === 'chain_progress' ? i : -1))
            .filter((i) => i >= 0)
            .pop();

          if (status === 'success' && chain && step && lastChainIdx != null) {
            const lastChainMsg = updated[lastChainIdx];
            if (lastChainMsg.chainProgress) {
              const completed = Array.from(
                new Set([...lastChainMsg.chainProgress.completedSteps, step.order]),
              );
              updated[lastChainIdx] = {
                ...lastChainMsg,
                chainProgress: {
                  chain,
                  currentStep: step.order + 1,
                  completedSteps: completed,
                },
              };
            }
          }

          if (status === 'failed') {
            updated.push({
              id: genMsgId(),
              role: 'assistant',
              content: '這一步沒有完成，我先停下來，避免後續流程建立在失敗結果上。',
              timestamp: new Date(),
              agentType: 'text',
              suggestions: ['重新執行', '改用手動操作', '問其他問題'],
            });
            setAgentContext((prevCtx) => ({
              ...prevCtx,
              state: 'idle',
              currentChain: undefined,
              currentChainStep: undefined,
              currentTool: undefined,
              pendingConfirmation: undefined,
            }));
            return updated;
          }

          if (chain && step && step.order >= chain.steps.length) {
            updated.push({
              id: genMsgId(),
              role: 'assistant',
              content: `「${chain.name}」流程已完成。`,
              timestamp: new Date(),
              agentType: 'text',
              suggestions: ['查看我的訂單', '還有什麼需要幫忙的嗎？', '推薦午餐'],
            });
            setAgentContext((prevCtx) => ({
              ...prevCtx,
              state: 'idle',
              currentChain: undefined,
              currentChainStep: undefined,
              currentTool: undefined,
              pendingConfirmation: undefined,
            }));
          } else if (chain && step) {
            setAgentContext((prevCtx) => ({
              ...prevCtx,
              state: 'executing',
              currentChain: chain.id,
              currentChainStep: step.order + 1,
              currentTool: undefined,
              pendingConfirmation: undefined,
            }));
          }

          return updated;
        }

        const followUp: Message = {
          id: genMsgId(),
          role: 'assistant',
          content:
            status === 'success' ? '還需要我做什麼嗎？' : '要我改用 APP 頁面幫你手動完成嗎？',
          timestamp: new Date(),
          agentType: 'text',
          suggestions:
            status === 'success' && tool.relatedTools
              ? tool.relatedTools
                  .slice(0, 3)
                  .map((rid) => {
                    const rt = getToolById(rid);
                    return rt ? `幫我${rt.name}` : '';
                  })
                  .filter(Boolean)
              : ['查看我的訂單', '推薦午餐', '問其他問題'],
        };

        return [...updated, followUp];
      });

      if (!isChainConfirm) {
        setAgentContext((prev) => ({
          ...prev,
          state: 'idle',
          currentTool: undefined,
          pendingConfirmation: undefined,
        }));
      }
    },
    [
      isOfflineAI,
      messages,
      diningMenus,
      diningCafeterias,
      userRole,
      auth.user?.uid,
      school.id,
      ds,
      courses,
      pendingAssignments,
    ],
  );

  const handleCancelTool = useCallback((executionId: string) => {
    setMessages((prev) => {
      const updated = prev.map((m) => {
        if (m.toolExecution?.id === executionId) {
          return {
            ...m,
            agentType: 'tool_result' as AgentMessageType,
            toolExecution: { ...m.toolExecution, status: 'cancelled' as ToolExecutionStatus },
          };
        }
        return m;
      });
      const cancelMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content: '好的，已取消。有其他需要幫忙的嗎？',
        timestamp: new Date(),
        agentType: 'text',
        suggestions: ['幫我訂午餐', '查作業截止日'],
      };
      return [...updated, cancelMsg];
    });
    setAgentContext((prev) => ({
      ...prev,
      state: 'idle',
      currentTool: undefined,
      pendingConfirmation: undefined,
    }));
  }, []);

  // ── Handle param input ──
  const handleParamSelect = useCallback(
    (value: string) => {
      if (agentContext.state !== 'collecting_params' || !agentContext.currentTool) return;
      const tool = getToolById(agentContext.currentTool);
      if (!tool) return;

      const newParams = { ...agentContext.collectedParams };
      const requiredMissing = tool.parameters.filter((p) => p.required && !(p.name in newParams));
      if (requiredMissing.length > 0) {
        newParams[requiredMissing[0].name] = value;
      }

      const stillMissing = tool.parameters.filter((p) => p.required && !(p.name in newParams));
      if (stillMissing.length > 0) {
        const nextParam = stillMissing[0];
        setAgentContext((prev) => ({ ...prev, collectedParams: newParams }));

        // Show param label for user
        const prevParam = requiredMissing[0];
        const displayVal =
          prevParam?.type === 'select'
            ? (prevParam.options?.find((o) => o.value === value)?.label ?? value)
            : value;

        const userEcho: Message = {
          id: genMsgId(),
          role: 'user',
          content: displayVal,
          timestamp: new Date(),
        };
        const nextCollect: Message = {
          id: genMsgId(),
          role: 'assistant',
          content: `收到！接下來：`,
          timestamp: new Date(),
          agentType: 'param_collect',
          paramCollect: { tool, collected: newParams, nextParam },
        };
        setMessages((prev) => [...prev, userEcho, nextCollect]);
      } else {
        // All collected
        const prevParam = requiredMissing[0];
        const displayVal =
          prevParam?.type === 'select'
            ? (prevParam.options?.find((o) => o.value === value)?.label ?? value)
            : value;
        const userEcho: Message = {
          id: genMsgId(),
          role: 'user',
          content: displayVal,
          timestamp: new Date(),
        };
        const chainId = agentContext.currentChain ?? newParams.__chainId;
        if (chainId) {
          const chain = TASK_CHAINS.find((c) => c.id === chainId);
          const currentStep = Number(newParams.__chainStep ?? agentContext.currentChainStep ?? 1);
          const step = chain?.steps.find((s) => s.order === currentStep);
          const chainParams = { ...newParams, __chainId: chainId, __chainStep: currentStep };

          if (chain && step && tool.requiresConfirmation) {
            const confirmMsg = createConfirmMessage(tool, chainParams);
            setMessages((prev) => [...prev, userEcho, confirmMsg]);
            setAgentContext((prev) => ({
              ...prev,
              state: 'waiting_chain_confirm',
              currentChain: chain.id,
              currentChainStep: currentStep,
              currentTool: tool.id,
              collectedParams: chainParams,
            }));
            return;
          }

          if (chain && step) {
            const result = simulateToolResult(tool, chainParams);
            const execution: ToolExecution = {
              id: genMsgId('exec'),
              toolId: tool.id,
              status: 'success',
              params: chainParams,
              result,
              startedAt: new Date().toISOString(),
              completedAt: new Date().toISOString(),
            };
            const resultMsg: Message = {
              id: genMsgId(),
              role: 'assistant',
              content: '',
              timestamp: new Date(),
              agentType: 'tool_result',
              toolExecution: execution,
              actions: buildToolAppActions(tool, chainParams),
            };

            setMessages((prev) => {
              const updated = [...prev];
              const lastChainIdx = updated
                .map((m, i) => (m.agentType === 'chain_progress' ? i : -1))
                .filter((i) => i >= 0)
                .pop();
              if (lastChainIdx != null) {
                const lastChainMsg = updated[lastChainIdx];
                if (lastChainMsg.chainProgress) {
                  updated[lastChainIdx] = {
                    ...lastChainMsg,
                    chainProgress: {
                      chain,
                      currentStep: step.order + 1,
                      completedSteps: Array.from(
                        new Set([...lastChainMsg.chainProgress.completedSteps, step.order]),
                      ),
                    },
                  };
                }
              }
              return [...updated, userEcho, resultMsg];
            });

            if (step.order < chain.steps.length) {
              setAgentContext((prev) => ({
                ...prev,
                state: 'executing',
                currentChain: chain.id,
                currentChainStep: step.order + 1,
                currentTool: undefined,
                collectedParams: {
                  __chainUserMessage: newParams.__chainUserMessage,
                },
              }));
            } else {
              setAgentContext((prev) => ({
                ...prev,
                state: 'idle',
                currentChain: undefined,
                currentChainStep: undefined,
                currentTool: undefined,
              }));
            }
            return;
          }
        }

        if (tool.requiresConfirmation) {
          const confirmMsg = createConfirmMessage(tool, newParams);
          setMessages((prev) => [...prev, userEcho, confirmMsg]);
        } else {
          const resultMsg = executeToolImmediately(tool, newParams);
          setMessages((prev) => [...prev, userEcho, resultMsg]);
        }
      }
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    },
    [agentContext],
  );

  // ── Chain auto-execute: 自動推進任務鏈步驟 ──
  // 重要修正：requiresConfirmation 的步驟會暫停等用戶確認，不會自動執行
  useEffect(() => {
    // "waiting_chain_confirm" 是等待用戶確認中，不要自動推進
    if (agentContext.state === 'waiting_chain_confirm') return;
    if (agentContext.state !== 'executing' || !agentContext.currentChain) return;

    const chainId = agentContext.currentChain;
    const chain = TASK_CHAINS.find((c) => c.id === chainId);
    if (!chain) {
      // 找不到 chain → 重置狀態，避免永遠卡住
      setAgentContext((prev) => ({
        ...prev,
        state: 'idle',
        currentChain: undefined,
        currentChainStep: undefined,
      }));
      return;
    }

    const stepIndex = (agentContext.currentChainStep ?? 1) - 1;
    if (stepIndex >= chain.steps.length) {
      // 所有步驟完成
      const doneMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content: `🎉「${chain.name}」流程已全部完成！還需要什麼嗎？`,
        timestamp: new Date(),
        agentType: 'text',
        suggestions: ['還有什麼需要幫忙的嗎？', '今天有什麼作業？'],
      };
      setMessages((prev) => [...prev, doneMsg]);
      setAgentContext((prev) => ({
        ...prev,
        state: 'idle',
        currentChain: undefined,
        currentChainStep: undefined,
      }));
      return;
    }

    const step = chain.steps[stepIndex];
    const tool = getToolById(step.toolId);
    if (!tool) {
      // 找不到 tool → 跳過這步，避免卡住
      if (stepIndex + 1 >= chain.steps.length) {
        setAgentContext((prev) => ({
          ...prev,
          state: 'idle',
          currentChain: undefined,
          currentChainStep: undefined,
        }));
      } else {
        setAgentContext((prev) => ({
          ...prev,
          currentChainStep: (prev.currentChainStep ?? 1) + 1,
        }));
      }
      return;
    }

    const chainUserMessage = String(agentContext.collectedParams.__chainUserMessage ?? '');
    const stepParams = {
      ...extractParamsFromMessage(tool, chainUserMessage),
      ...(step.autoParams ?? {}),
      __chainId: chain.id,
      __chainStep: step.order,
      __chainUserMessage: chainUserMessage,
    };

    // Optional 步驟先詢問，使用者同意後再收集必要參數
    if (step.optional) {
      const askMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content: `下一步「${step.label}」是選擇性的，要執行嗎？`,
        timestamp: new Date(),
        agentType: 'text',
        suggestions: [`好，執行${step.label}`, '跳過，繼續下一步'],
      };
      setMessages((prev) => [...prev, askMsg]);
      setAgentContext((prev) => ({
        ...prev,
        state: 'waiting_chain_confirm',
        collectedParams: stepParams,
      }));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      return;
    }

    const missingRequired = tool.parameters.filter((p) => p.required && !(p.name in stepParams));
    if (missingRequired.length > 0) {
      const nextParam = missingRequired[0];
      const collectMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content: `我正在執行「${chain.name}」第 ${step.order} 步：${step.label}。還缺少一項資料：`,
        timestamp: new Date(),
        agentType: 'param_collect',
        paramCollect: { tool, collected: stepParams, nextParam },
      };
      setMessages((prev) => [...prev, collectMsg]);
      setAgentContext((prev) => ({
        ...prev,
        state: 'collecting_params',
        currentTool: tool.id,
        currentChain: chain.id,
        currentChainStep: step.order,
        collectedParams: stepParams,
      }));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      return;
    }

    // ★ 關鍵修正：需要確認的步驟 → 暫停並詢問用戶
    if (tool.requiresConfirmation) {
      const confirmMsg = createConfirmMessage(tool, stepParams);
      setMessages((prev) => [...prev, confirmMsg]);
      // 切換到 waiting_chain_confirm 狀態，暫停自動推進
      setAgentContext((prev) => ({
        ...prev,
        state: 'waiting_chain_confirm',
        currentChain: chain.id,
        currentChainStep: step.order,
        currentTool: tool.id,
        collectedParams: stepParams,
      }));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      return;
    }

    // 不需確認、非 optional → 自動執行
    const timer = setTimeout(() => {
      const result = simulateToolResult(tool, stepParams);

      // 更新進度卡片（標記當前步驟完成）
      setMessages((prev) => {
        const lastChainIdx = prev
          .map((m, i) => (m.agentType === 'chain_progress' ? i : -1))
          .filter((i) => i >= 0)
          .pop();
        if (lastChainIdx == null) return prev;

        const lastChainMsg = prev[lastChainIdx];
        if (!lastChainMsg.chainProgress) return prev;

        const { completedSteps } = lastChainMsg.chainProgress;
        const nextStep = step.order + 1;
        const newCompleted = [...completedSteps, step.order];

        const updatedChainMsg: Message = {
          ...lastChainMsg,
          chainProgress: { chain, currentStep: nextStep, completedSteps: newCompleted },
        };

        // 加入步驟結果訊息
        const stepResultMsg: Message = {
          id: genMsgId(),
          role: 'assistant',
          content: `✅ 步驟 ${step.order}「${step.label}」完成\n\n${result}`,
          timestamp: new Date(),
          agentType: 'text',
        };

        const updated = [...prev];
        updated[lastChainIdx] = updatedChainMsg;
        return [...updated, stepResultMsg];
      });

      // 推進到下一步
      if (step.order < chain.steps.length) {
        setAgentContext((prev) => ({ ...prev, currentChainStep: step.order + 1 }));
      } else {
        // 最後一步完成
        const doneMsg: Message = {
          id: genMsgId(),
          role: 'assistant',
          content: `🎉「${chain.name}」流程已全部完成！還需要什麼嗎？`,
          timestamp: new Date(),
          agentType: 'text',
          suggestions: ['今天有什麼作業？', '推薦午餐', '查公車'],
        };
        setMessages((prev) => [...prev, doneMsg]);
        setAgentContext((prev) => ({
          ...prev,
          state: 'idle',
          currentChain: undefined,
          currentChainStep: undefined,
        }));
      }

      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }, 1200);

    return () => clearTimeout(timer);
  }, [agentContext.state, agentContext.currentChain, agentContext.currentChainStep]);

  // ── Chain step skip / finish ──
  const handleSkipChainStep = useCallback(() => {
    const chainId = agentContext.currentChain;
    const chain = chainId ? TASK_CHAINS.find((c) => c.id === chainId) : null;
    if (!chain) {
      // 安全防護：找不到 chain 就重置
      setAgentContext((prev) => ({
        ...prev,
        state: 'idle',
        currentChain: undefined,
        currentChainStep: undefined,
      }));
      return;
    }

    const currentStep = agentContext.currentChainStep ?? 1;
    const nextStep = currentStep + 1;

    const skipMsg: Message = {
      id: genMsgId(),
      role: 'assistant',
      content: `⏭ 已跳過步驟 ${currentStep}「${chain.steps[currentStep - 1]?.label ?? ''}」`,
      timestamp: new Date(),
      agentType: 'text',
    };
    setMessages((prev) => [...prev, skipMsg]);

    if (nextStep > chain.steps.length) {
      // Chain 完成
      const doneMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content: `🎉「${chain.name}」流程已完成！`,
        timestamp: new Date(),
        agentType: 'text',
        suggestions: ['還有什麼需要幫忙的嗎？'],
      };
      setMessages((prev) => [...prev, doneMsg]);
      setAgentContext((prev) => ({
        ...prev,
        state: 'idle',
        currentChain: undefined,
        currentChainStep: undefined,
      }));
    } else {
      // 跳過當前步驟，推進下一步（確保回到 executing 以觸發 useEffect）
      setAgentContext((prev) => ({ ...prev, state: 'executing', currentChainStep: nextStep }));
    }
  }, [agentContext.currentChain, agentContext.currentChainStep]);

  // ── Handle Proactive Action ──
  const handleProactiveAction = useCallback((triggerId: string) => {
    const trigger = PROACTIVE_TRIGGERS.find((t) => t.id === triggerId);
    if (!trigger?.suggestedTool) return;
    const tool = getToolById(trigger.suggestedTool);
    if (tool) {
      const msg = startToolExecution(tool, trigger.message);
      if (msg) setMessages((prev) => [...prev, msg]);
    }
    setProactiveMessages((prev) => prev.filter((p) => p.trigger.id !== triggerId));
  }, []);

  // ── Main Send Handler ──
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = async (overrideText?: string) => {
    const messageText = (typeof overrideText === 'string' ? overrideText : input).trim();
    if (!messageText) return;
    earnXP('use_ai_chat').catch(() => {});

    // If in a chain (executing or waiting for confirmation)
    if (
      (agentContext.state === 'executing' || agentContext.state === 'waiting_chain_confirm') &&
      agentContext.currentChain
    ) {
      const trimmed = messageText.toLowerCase();

      // 用戶要取消整個流程
      if (/取消|算了|不要了|停止|中斷|取消流程/.test(trimmed)) {
        setInput('');
        const cancelMsg: Message = {
          id: genMsgId(),
          role: 'assistant',
          content: '好的，已取消流程。有其他需要幫忙的嗎？',
          timestamp: new Date(),
          agentType: 'text',
          suggestions: ['推薦午餐', '今天有什麼作業？', '查公車'],
        };
        setMessages((prev) => [
          ...prev,
          { id: genMsgId(), role: 'user', content: messageText, timestamp: new Date() },
          cancelMsg,
        ]);
        setAgentContext((prev) => ({
          ...prev,
          state: 'idle',
          currentChain: undefined,
          currentChainStep: undefined,
        }));
        return;
      }

      // 用戶要跳過當前步驟
      if (/跳過|不用|不要|完成|跳過這步/.test(trimmed)) {
        setInput('');
        // 如果在 waiting_chain_confirm，先回到 executing 再跳步
        if (agentContext.state === 'waiting_chain_confirm') {
          setAgentContext((prev) => ({ ...prev, state: 'executing' }));
        }
        handleSkipChainStep();
        return;
      }

      // 用戶確認執行（僅在 waiting_chain_confirm 時有效）
      if (
        agentContext.state === 'waiting_chain_confirm' &&
        /好|執行|要|確認|是|ok|可以|確認執行/.test(trimmed)
      ) {
        setInput('');
        // 執行被暫停的步驟，然後推進
        const chainId = agentContext.currentChain;
        const chain = TASK_CHAINS.find((c) => c.id === chainId);
        if (chain) {
          const stepIndex = (agentContext.currentChainStep ?? 1) - 1;
          const step = chain.steps[stepIndex];
          const tool = step ? getToolById(step.toolId) : null;
          if (step && tool) {
            const chainUserMessage = String(agentContext.collectedParams.__chainUserMessage ?? '');
            const stepParams = {
              ...extractParamsFromMessage(tool, chainUserMessage),
              ...(step.autoParams ?? {}),
              ...agentContext.collectedParams,
              __chainId: chain.id,
              __chainStep: step.order,
              __chainUserMessage: chainUserMessage,
            };
            const missingRequired = tool.parameters.filter(
              (p) => p.required && !(p.name in stepParams),
            );
            if (missingRequired.length > 0) {
              const userEcho: Message = {
                id: genMsgId(),
                role: 'user',
                content: messageText,
                timestamp: new Date(),
              };
              const collectMsg: Message = {
                id: genMsgId(),
                role: 'assistant',
                content: `好，我會執行「${step.label}」。還缺少一項資料：`,
                timestamp: new Date(),
                agentType: 'param_collect',
                paramCollect: { tool, collected: stepParams, nextParam: missingRequired[0] },
              };
              setMessages((prev) => [...prev, userEcho, collectMsg]);
              setAgentContext((prev) => ({
                ...prev,
                state: 'collecting_params',
                currentTool: tool.id,
                currentChain: chain.id,
                currentChainStep: step.order,
                collectedParams: stepParams,
              }));
              return;
            }
            let result = '';
            let executionStatus: ToolExecutionStatus = 'success';
            let resultActions: AssistantActionProposal[] | undefined;
            try {
              const executionResult = await executeConfirmedToolResult(tool, stepParams);
              executionStatus = executionResult.kind === 'blocked' ? 'failed' : 'success';
              result = executionResult.message;
              resultActions = executionResult.actions;
            } catch (error: any) {
              executionStatus = 'failed';
              result = `執行失敗：${error?.message ?? '無法完成這項操作'}`;
            }
            // 更新進度卡片
            setMessages((prev) => {
              const userEcho: Message = {
                id: genMsgId(),
                role: 'user',
                content: messageText,
                timestamp: new Date(),
              };
              const lastChainIdx = prev
                .map((m, i) => (m.agentType === 'chain_progress' ? i : -1))
                .filter((i) => i >= 0)
                .pop();
              if (lastChainIdx == null) return [...prev, userEcho];

              const lastChainMsg = prev[lastChainIdx];
              if (!lastChainMsg.chainProgress) return [...prev, userEcho];

              const { completedSteps } = lastChainMsg.chainProgress;
              const newCompleted = [...completedSteps, step.order];
              const updatedChainMsg: Message = {
                ...lastChainMsg,
                chainProgress: { chain, currentStep: step.order + 1, completedSteps: newCompleted },
              };
              const stepResultMsg: Message = {
                id: genMsgId(),
                role: 'assistant',
                content: '',
                timestamp: new Date(),
                agentType: 'tool_result',
                toolExecution: {
                  id: genMsgId('exec'),
                  toolId: tool.id,
                  status: executionStatus,
                  params: stepParams,
                  result,
                  startedAt: new Date().toISOString(),
                  completedAt: new Date().toISOString(),
                },
                actions:
                  resultActions ??
                  (executionStatus === 'success'
                    ? buildToolSuccessActions(tool, stepParams)
                    : buildToolAppActions(tool, stepParams)),
              };
              const updated = [...prev];
              if (executionStatus === 'success') updated[lastChainIdx] = updatedChainMsg;
              return [...updated, userEcho, stepResultMsg];
            });

            if (executionStatus === 'failed') {
              setAgentContext((prev) => ({
                ...prev,
                state: 'idle',
                currentChain: undefined,
                currentChainStep: undefined,
              }));
              return;
            }

            // 推進到下一步
            if (step.order < chain.steps.length) {
              setAgentContext((prev) => ({
                ...prev,
                state: 'executing',
                currentChainStep: step.order + 1,
              }));
            } else {
              const doneMsg: Message = {
                id: genMsgId(),
                role: 'assistant',
                content: `🎉「${chain.name}」流程已全部完成！還需要什麼嗎？`,
                timestamp: new Date(),
                agentType: 'text',
                suggestions: ['今天有什麼作業？', '推薦午餐', '查公車'],
              };
              setMessages((prev) => [...prev, doneMsg]);
              setAgentContext((prev) => ({
                ...prev,
                state: 'idle',
                currentChain: undefined,
                currentChainStep: undefined,
              }));
            }
          }
        }
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        return;
      }

      // ★ 用戶問了完全無關的問題 → 放棄鏈，正常處理新問題
      // 不攔截，讓訊息繼續往下走，但先重置 chain 狀態
      const abandonMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content: '（已自動結束先前的流程）',
        timestamp: new Date(),
        agentType: 'text',
      };
      setMessages((prev) => [...prev, abandonMsg]);
      setAgentContext((prev) => ({
        ...prev,
        state: 'idle',
        currentChain: undefined,
        currentChainStep: undefined,
      }));
      // 不 return — 讓訊息繼續往下正常處理
    }

    // If collecting params and user types free text
    if (agentContext.state === 'collecting_params' && agentContext.currentTool) {
      const tool = getToolById(agentContext.currentTool);
      if (tool) {
        const requiredMissing = tool.parameters.filter(
          (p) => p.required && !(p.name in agentContext.collectedParams),
        );
        if (requiredMissing.length > 0) {
          handleParamSelect(messageText);
          setInput('');
          return;
        }
      }
    }

    try {
      abortRef.current?.abort();
    } catch (_) {
      /* ignore DOMException on RN */
    }
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const userMsg: Message = {
      id: genMsgId(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setShowCapabilities(false);
    setIsTyping(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try {
      // ← 全域 try/finally 確保 isTyping 一定會被重置

      // ── 自動訓練：偵測回饋（正面 + 負面）──
      const dissatisfactionPatterns =
        /不對|答錯|回答錯|沒有回答|答非所問|不是這個|搞錯|你錯了|不相關|離題|文不對題|完全不對|說錯|亂回答|亂講|胡說/;
      const satisfactionPatterns =
        /謝謝|感謝|太好了|好的|了解|懂了|有幫助|不錯|很棒|厲害|太強了|完美|正確/;

      if (dissatisfactionPatterns.test(userMsg.content)) {
        // 負面回饋 → 降低品質 + Q-learning 懲罰
        const lastBotMsg = [...(messages ?? [])].reverse().find((m) => m.role === 'assistant');
        if (lastBotMsg) {
          setLearningState((prev) =>
            recordCorrection(
              prev,
              (messages ?? []).filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '',
              lastBotMsg.content,
              userMsg.content,
            ),
          );
          // 訓練 AI 大腦（負面回饋）
          setAiBrain((prev) =>
            trainFromFeedback(
              prev,
              (messages ?? []).filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '',
              lastBotMsg.content,
              lastIntentRef.current,
              lastStrategyRef.current,
              -1,
            ),
          );
        }
        if (lastQAPairIdRef.current) {
          setTrainingDB((prev) => updatePairQuality(prev, lastQAPairIdRef.current!, -1));
          lastQAPairIdRef.current = null;
        }
      } else if (satisfactionPatterns.test(userMsg.content)) {
        // 正面回饋 → 提升品質 + Q-learning 獎勵
        if (lastQAPairIdRef.current) {
          setTrainingDB((prev) => updatePairQuality(prev, lastQAPairIdRef.current!, +1, true));
          lastQAPairIdRef.current = null;
        }
        const lastBotMsg = [...(messages ?? [])].reverse().find((m) => m.role === 'assistant');
        if (lastBotMsg) {
          setAiBrain((prev) =>
            trainFromFeedback(
              prev,
              (messages ?? []).filter((m) => m.role === 'user').slice(-1)[0]?.content ?? '',
              lastBotMsg.content,
              lastIntentRef.current,
              lastStrategyRef.current,
              +1,
            ),
          );
        }
      }

      // ── Extract learnable facts from user message & update memory ──
      const previousContents = (messages ?? [])
        .filter((m) => m.role === 'user')
        .slice(-5)
        .map((m) => m.content);
      const newFacts = extractLearnableFacts(userMsg.content, previousContents);
      if (newFacts.length > 0) {
        setAgentMemory((prev) => mergeLearnedFacts(prev, newFacts));
      }
      // Track action
      setAgentMemory((prev) =>
        addRecentAction(prev, {
          toolId: 'user_message',
          params: { content: userMsg.content },
          timestamp: new Date().toISOString(),
          wasSuccessful: true,
        }),
      );

      // ── 智慧路由：雲端模式可把複雜查詢送外部模型；離線模式會先做能力邊界檢查 ──
      const deliberationSteps = buildAgentDeliberation(userMsg.content);
      const classifiedForGate = classifyDomain(userMsg.content);
      const dataStatusForGate = getDomainDataStatus(classifiedForGate.domain);
      const needsExternalLLM = requiresDeepReasoning(userMsg.content);
      const needsLLM = !isOfflineAI && needsExternalLLM;

      if (
        isOfflineAI &&
        needsExternalLLM &&
        !aiStatus.webSearchEnabled &&
        classifiedForGate.domain === 'general' &&
        !dataStatusForGate.available
      ) {
        const limitMsg: Message = {
          id: genMsgId(),
          role: 'assistant',
          content: [
            '這題需要通用大模型等級的推理；目前本機模式沒有足夠資料，我不會硬編答案。',
            '',
            '我可以做兩件可靠的事：',
            '1. 把你的目標拆成可執行步驟。',
            '2. 如果你開啟連網搜尋或接本機 LLM server，我再用外部證據/模型補強回答。',
          ].join('\n'),
          timestamp: new Date(),
          agentType: 'text',
          thinkingSteps: deliberationSteps,
          suggestions: ['幫我拆成步驟', '改問 APP 功能', '開啟連網搜尋'],
        };
        setIsTyping(false);
        setMessages((prev) => [...prev, limitMsg]);
        return;
      }

      // Try agent logic first (skip for complex queries that need LLM)
      const agentResult = needsLLM ? null : await detectIntentAndExecute(userMsg.content);

      if (agentResult) {
        // Add thinking steps to agent results
        const thinkingChain = buildThinkingChain(
          userMsg.content,
          {
            hasCourses: (courses ?? []).length > 0,
            hasAssignments: (pendingAssignments ?? []).length > 0,
            hasGrades: false,
            hasAnnouncements: (announcements ?? ([] as any[])).length > 0,
            hasEvents: (events ?? ([] as any[])).length > 0,
            hasMenus: diningMenus.length > 0,
            hasPois: (pois ?? ([] as any[])).length > 0,
            hasMemory: (agentMemory?.learnedFacts ?? []).length > 0,
          },
          agentMemory,
        );
        if (thinkingChain.steps.length > 0) {
          agentResult.thinkingSteps = [
            ...(agentResult.thinkingSteps ?? []),
            ...(thinkingChain.steps as ThinkingStepUI[]),
          ].slice(0, 8);
        }
        setIsTyping(false);
        setMessages((prev) => [...prev, agentResult]);
        // ✅ 自動訓練：儲存本地智慧回答為訓練樣本
        setTrainingDB((prev) => {
          const updated = addTrainingPair(prev, userMsg.content, agentResult.content, 'local');
          lastQAPairIdRef.current = updated.pairs[updated.pairs.length - 1]?.id ?? null;
          return updated;
        });
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        return;
      }

      // ══════════════════════════════════════════════════
      // GPT 級本地 AI 優先架構
      // 深度理解管線：斷詞→NER→意圖分類→上下文→策略選擇→生成
      // 每次回饋都訓練全部模型（embedding+classifier+ngram+Q-learning）
      // ══════════════════════════════════════════════════

      const questionTags = autoTagQuestion(userMsg.content);
      const localConfidence = getLocalConfidence(userMsg.content, questionTags, trainingDB);
      const searchDomain = classifyDomain(userMsg.content).domain;
      const webSearchCategory = domainToWebSearchCategory(searchDomain);
      const forceOnlineSearch =
        aiStatus.webSearchEnabled && shouldUseWebSearch(userMsg.content, webSearchCategory);

      // 準備即時資料（每次都是最新的，不是快取）
      // ★ 加入 ?? [] 防護：避免 hooks 尚未載入時 undefined.map() 崩潰
      const safeCourses = courses ?? [];
      const safeAssignments = pendingAssignments ?? [];
      const safeMenus = diningMenus as any[];
      const safeEvents = (events ?? []) as any[];
      const safeAnnouncements = (announcements ?? []) as any[];
      const safePois = (pois ?? []) as any[];

      const liveData = {
        courses: safeCourses.map((c) => ({
          id: c.id,
          name: c.name,
          teacher: c.teacher,
          dayOfWeek: c.dayOfWeek,
          startPeriod: c.startPeriod,
          credits: c.credits,
        })),
        assignments: safeAssignments.map((a) => ({
          id: a.id,
          title: a.title,
          groupName: a.groupName ?? '',
          dueAt: a.dueAt ? new Date(a.dueAt.seconds * 1000).toLocaleDateString('zh-TW') : undefined,
          isLate: a.isLate,
        })),
        menus: safeMenus.map((m) => ({
          id: m.id,
          name: m.name ?? m.cafeteria,
          price: m.price,
          cafeteria: m.cafeteria,
        })),
        events: safeEvents.map((e) => ({
          id: e.id,
          title: e.title,
          location: e.location,
          startsAt: e.startsAt,
        })),
        announcements: safeAnnouncements.map((a) => ({
          id: a.id,
          title: a.title,
          source: a.source,
        })),
        pois: safePois.map((p) => ({ id: p.id, name: p.name, category: p.category })),
        memory: agentMemory ?? {
          userId: 'anonymous',
          version: 1,
          createdAt: new Date().toISOString(),
          lastActiveAt: new Date().toISOString(),
          preferences: {
            foodPreferences: [],
            allergens: [],
            frequentLocations: [],
            communicationStyle: 'casual' as const,
            reminderLeadTime: 10,
            quietHours: { start: '22:00', end: '07:00' },
          },
          recentActions: [],
          conversationPatterns: [],
          knownSchedule: [],
          learnedFacts: [],
          conversationSummaries: [],
        },
      };

      // ── AI 大腦深度理解（全管線：NER → 意圖 → 注意力 → 推理 → 澄清 → 情境） ──
      const understanding = understandQuery(
        aiBrain,
        userMsg.content,
        liveData.courses.map((c) => c.name),
        liveData.pois.map((p) => p.name),
        [], // knownPeople
        liveData.menus.map((m) => m.name),
      );
      lastIntentRef.current = understanding.intent.intent;
      lastStrategyRef.current = understanding.strategy;

      // 更新對話上下文
      setAiBrain((prev) =>
        updateBrainContext(
          prev,
          'user',
          userMsg.content,
          understanding.tokens,
          understanding.intent.intent,
          understanding.entities,
        ),
      );
      trainEmbeddingOnSentence(aiBrain.embedding, understanding.tokens, 0.003);

      // ── 主動澄清：信心極低時先問清楚 ──
      if (
        !isOfflineAI &&
        understanding.clarification.needed &&
        understanding.clarification.suggestedQuestions.length > 0
      ) {
        const clarifyMsg: Message = {
          id: genMsgId(),
          role: 'assistant',
          content: understanding.clarification.suggestedQuestions[0],
          timestamp: new Date(),
          agentType: 'text',
          thinkingSteps: deliberationSteps,
          suggestions:
            understanding.clarification.suggestedQuestions.length > 1
              ? understanding.clarification.suggestedQuestions.slice(1)
              : undefined,
        };
        setIsTyping(false);
        setMessages((prev) => [...prev, clarifyMsg]);
        setAiBrain((prev) =>
          updateBrainContext(
            prev,
            'assistant',
            clarifyMsg.content,
            advancedTokenize(clarifyMsg.content),
          ),
        );
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        return;
      }

      // ── 嘗試本地 AI 回答（綜合信心 >= 0.60 直接用，推理引擎降低門檻） ──
      // ★ 雲端模式遇到複雜查詢才提高門檻；離線模式不會外送
      const reasoningBoost = understanding.reasoning.totalConfidence > 0.6 ? 0.1 : 0;
      const retrievalBoost =
        understanding.retrievalHits.length > 0 && understanding.retrievalHits[0].fusedScore > 0.01
          ? 0.08
          : 0;
      const combinedConfidence =
        Math.max(localConfidence, understanding.intent.confidence * 0.8) +
        reasoningBoost +
        retrievalBoost;
      const localThreshold = isOfflineAI ? 0.3 : needsLLM ? 0.85 : 0.6;
      const appAwareContextSummary = [
        aiContext.appPulseSummary,
        aiContext.contextSummary,
        understanding.retrievalHits.length > 0
          ? `檢索命中：${understanding.retrievalHits
              .slice(0, 2)
              .map((h) => h.raw.slice(0, 40))
              .join('；')}`
          : '',
        understanding.reasoning.finalAnswer
          ? `推理結論：${understanding.reasoning.finalAnswer.slice(0, 80)}`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      if (!forceOnlineSearch && combinedConfidence >= localThreshold) {
        const localResult = generateLocalAnswer(
          understanding.resolvedText,
          questionTags,
          liveData,
          trainingDB.templates,
          learningState,
          {
            currentTopic: aiBrain.dialogCtx.currentTopic,
            topicContinuity: aiBrain.dialogCtx.topicContinuity,
            isFollowUp: understanding.isFollowUp,
            slots: aiBrain.dialogCtx.slots.map((s) => ({ name: s.name, value: s.value })),
            shortTermMemory: aiBrain.dialogCtx.shortTermMemory.map((m) => ({
              key: m.key,
              value: m.value,
            })),
            userMood: aiBrain.dialogCtx.userMood,
            userStyle: aiBrain.dialogCtx.userStyle,
            contextSummary: appAwareContextSummary,
            recentTurns: aiBrain.dialogCtx.turns
              .slice(-6)
              .map((t) => ({ role: t.role, content: t.content })),
          },
        );
        if (localResult && localResult.confidence >= 0.6) {
          // 用注意力回答組合器修飾回答
          const candidates: ResponseCandidate[] = [
            {
              text: localResult.answer,
              score: localResult.confidence,
              source: 'local_handler',
              strategy: understanding.strategy,
            },
          ];

          // 如果推理引擎有額外結論，加入候選
          if (
            understanding.reasoning.finalAnswer &&
            understanding.reasoning.finalAnswer.length > 5
          ) {
            candidates.push({
              text: understanding.reasoning.finalAnswer,
              score: understanding.reasoning.totalConfidence * 0.7,
              source: 'similar_qa',
              strategy: 'direct_answer',
            });
          }

          let composedAnswer = composeResponse(
            candidates,
            understanding.strategy,
            understanding.intent.intent,
            aiBrain.ngramModel,
            aiBrain.dialogCtx,
          );

          // 品質自評
          const quality = evaluateResponseQuality(
            userMsg.content,
            composedAnswer,
            understanding.intent,
            understanding.reasoning,
            aiBrain.embedding,
          );

          // 品質太差時，雲端模式可交給外部模型；離線模式仍使用本地最佳答案
          if (quality.shouldUseGemini && !isOfflineAI) {
            // 不 return，會 fallthrough 到外部模型呼叫
          } else {
            // 情境增強（時間/學期/天氣感知）
            composedAnswer = contextualEnhance(
              composedAnswer,
              understanding.intent.intent,
              understanding.contextualFactors,
              aiBrain.dialogCtx,
            );

            // 組合式回答結構（共感 → 資訊 → 推理 → 行動建議）
            composedAnswer = composeStructuredResponse(
              composedAnswer,
              understanding.intent.intent,
              aiBrain.dialogCtx,
              understanding.reasoning,
              understanding.contextualFactors,
            );

            const localMsg: Message = {
              id: genMsgId(),
              role: 'assistant',
              content: composedAnswer,
              timestamp: new Date(),
              agentType: 'text',
              thinkingSteps: [
                ...deliberationSteps,
                {
                  step: '自我檢查',
                  detail:
                    quality.shouldUseGemini && isOfflineAI
                      ? '本機回答信心有限，已避免宣稱即時或未驗證資訊'
                      : `回答品質 ${Math.round(quality.overall * 100)}%`,
                  status: quality.overall >= 0.6 ? 'done' : 'warning',
                } as ThinkingStepUI,
              ].slice(0, 8),
            };
            setIsTyping(false);
            setMessages((prev) => [...prev, localMsg]);

            // 更新 AI 大腦上下文 + 訓練 + 索引
            setAiBrain((prev) => {
              const updated = updateBrainContext(
                prev,
                'assistant',
                composedAnswer,
                advancedTokenize(composedAnswer),
                understanding.intent.intent,
              );
              const qaId = `local_${Date.now()}`;
              indexDocument(
                updated.retrievalIndex,
                qaId,
                `${userMsg.content}\n${composedAnswer}`,
                [...understanding.tokens, ...advancedTokenize(composedAnswer)],
                understanding.intent.intent,
              );
              return updated;
            });
            trainNgramOnResponse(aiBrain.ngramModel, composedAnswer, understanding.intent.intent);

            // 記錄為本地回答訓練樣本
            setTrainingDB((prev) => {
              const updated = addTrainingPair(prev, userMsg.content, composedAnswer, 'local', {
                courseNames: liveData.courses.map((c) => c.name),
                assignmentTitles: liveData.assignments.map((a) => a.title),
                menuNames: liveData.menus.map((m) => m.name),
                eventTitles: liveData.events.map((e) => e.title),
                poiNames: liveData.pois.map((p) => p.name),
              });
              lastQAPairIdRef.current = updated.pairs[updated.pairs.length - 1]?.id ?? null;
              return updated;
            });
            setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
            return;
          } // end else (quality ok)
        } // end if (localResult)
      } // end if (combinedConfidence)

      // ── 本地信心不足 → 離線補強或外部模型補強 ──
      const responseId = genMsgId();
      const aiMessages: AIMessage[] = (messages ?? [])
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));
      aiMessages.push({ role: 'user', content: userMsg.content });

      const placeholder: Message = {
        id: responseId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        agentType: 'text',
        thinkingSteps: deliberationSteps,
      };
      setMessages((prev) => [...prev, placeholder]);
      setIsTyping(false);

      const onToken: StreamingCallback = (partial) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === responseId ? { ...m, content: partial } : m)),
        );
        scrollRef.current?.scrollToEnd({ animated: false });
      };

      try {
        const aiResponse = await chatWithLocalLLMStreaming(aiMessages, aiContext, onToken, signal);
        const finalContent = aiResponse.error
          ? `抱歉，發生錯誤：${aiResponse.error}`
          : aiResponse.content;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === responseId
              ? {
                  ...m,
                  content: finalContent,
                  suggestions: aiResponse.suggestions,
                  actions: aiResponse.actions,
                  thinkingSteps:
                    ((aiResponse as any).thinking as ThinkingStepUI[] | undefined) ??
                    deliberationSteps,
                }
              : m,
          ),
        );

        // ✅ 補強回答成功 → 全面蒸餾學習到本地 AI 大腦
        if (!aiResponse.error && finalContent.length > 0) {
          const trainingSource = isOfflineAI ? 'local' : 'gemini';
          setTrainingDB((prev) => {
            const updated = addTrainingPair(prev, userMsg.content, finalContent, trainingSource, {
              courseNames: liveData.courses.map((c) => c.name),
              assignmentTitles: liveData.assignments.map((a) => a.title),
              menuNames: liveData.menus.map((m) => m.name),
              eventTitles: liveData.events.map((e) => e.title),
              poiNames: liveData.pois.map((p) => p.name),
            });
            lastQAPairIdRef.current = updated.pairs[updated.pairs.length - 1]?.id ?? null;
            return updated;
          });

          // 🧠 知識蒸餾 — 讓本地模型從補強回答中學習
          setAiBrain((prev) => {
            let updated = updateBrainContext(
              prev,
              'assistant',
              finalContent,
              advancedTokenize(finalContent),
              lastIntentRef.current,
            );
            // 蒸餾：學習詞向量 + 意圖 + N-gram + 模板 + 索引
            distillFromGeminiResponse(
              updated,
              userMsg.content,
              finalContent,
              lastIntentRef.current,
              understanding.entities,
            );
            // 強化回饋訓練
            updated = trainFromFeedback(
              updated,
              userMsg.content,
              finalContent,
              lastIntentRef.current,
              lastStrategyRef.current,
              +1,
            );
            return updated;
          });
          trainNgramOnResponse(aiBrain.ngramModel, finalContent, lastIntentRef.current);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          // 外部模型/補強流程失敗 → 用本地 AI 作為最後防線（不管信心多低）
          const localFallback = generateLocalAnswer(
            userMsg.content,
            questionTags,
            liveData,
            trainingDB.templates,
            learningState,
            {
              currentTopic: aiBrain.dialogCtx.currentTopic,
              topicContinuity: aiBrain.dialogCtx.topicContinuity,
              isFollowUp: understanding.isFollowUp,
              slots: aiBrain.dialogCtx.slots.map((s) => ({ name: s.name, value: s.value })),
              shortTermMemory: aiBrain.dialogCtx.shortTermMemory.map((m) => ({
                key: m.key,
                value: m.value,
              })),
              userMood: aiBrain.dialogCtx.userMood,
              contextSummary: appAwareContextSummary,
              recentTurns: aiBrain.dialogCtx.turns
                .slice(-6)
                .map((t) => ({ role: t.role, content: t.content })),
            },
          );
          if (localFallback) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === responseId
                  ? {
                      ...m,
                      content: localFallback.answer,
                    }
                  : m,
              ),
            );
            setTrainingDB((prev) => {
              const updated = addTrainingPair(prev, userMsg.content, localFallback.answer, 'local');
              lastQAPairIdRef.current = updated.pairs[updated.pairs.length - 1]?.id ?? null;
              return updated;
            });
          } else {
            const fallback = await chatWithCampusAssistant(aiMessages, aiContext);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === responseId
                  ? {
                      ...m,
                      content: fallback.content,
                      suggestions: fallback.suggestions,
                      actions: fallback.actions,
                    }
                  : m,
              ),
            );
          }
        }
      }

      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (fatalError: any) {
      // 全域錯誤捕獲 — 任何未預期的例外都不會讓 AI 卡死
      console.error(
        '[AIChat] handleSend fatal error:',
        fatalError?.message,
        '\nStack:',
        fatalError?.stack,
      );

      // ★★ 緊急知識庫回退：即使主流程崩潰，仍嘗試用本地知識回答 ★★
      let emergencyContent: string | null = null;
      let emergencySuggestions: string[] = ['再問一次', '換個方式問'];
      const _userText = (userMsg?.content ?? '').toLowerCase();

      try {
        // 1) 交通方向 — buildTransportDirections 已有完整答案
        const transport = buildTransportDirections(_userText);
        if (transport) {
          emergencyContent = transport.content;
          emergencySuggestions = transport.suggestions;
        }

        // 2) 校園常見問題 — 靜態知識庫
        if (!emergencyContent) {
          const campusKB: { pattern: RegExp; answer: string; suggestions: string[] }[] = [
            {
              pattern: /圖書館|蓋夏|借書|還書|自習|看書|討論室/,
              answer:
                '靜宜大學蓋夏圖書館資訊：\n\n📍 位置：校園中心區域，蓋夏圖書館\n⏰ 開放時間：週一至週五 08:00-21:30，週六 09:00-17:00，週日及國定假日休館（學期間）\n\n主要服務：借還書、館際互借、自習室、團體討論室預約、電子資源查詢、列印影印\n\n💡 借書上限通常為 30 冊，借期 14-28 天，可線上續借。\n如需預約討論室，請至圖書館網站或親洽服務台。',
              suggestions: ['怎麼去圖書館', '借書規則', '預約討論室'],
            },
            {
              pattern: /宿舍|住宿|寢室|報修|漏水|洗衣/,
              answer:
                '靜宜大學宿舍相關資訊：\n\n🏠 宿舍包含男生宿舍與女生宿舍，住宿申請通常於每學期初開放。\n\n常見服務：\n- 報修：可至宿舍管理室填報修單或透過學校系統線上報修\n- 洗衣機/烘衣機：各樓層設有投幣式洗衣設備\n- 包裹：宿舍管理室代收，請攜帶學生證領取\n- 門禁時間：通常為 23:00，請留意各宿舍公告\n\n有其他宿舍問題可以繼續問我！',
              suggestions: ['宿舍報修', '洗衣機位置', '門禁時間'],
            },
            {
              pattern: /餐廳|吃什麼|午餐|晚餐|食堂|美食街|便當|飯/,
              answer:
                '靜宜大學校園餐飲：\n\n🍽️ 可確認的校內餐飲點：\n- 靜園餐廳：早餐、咖哩、滷味、自助餐、飲料與點心等櫃位\n- 宜園餐廳：早餐、自助餐、茶飲、炸物、咖哩與鍋貼類櫃位\n- 至善美食廣場：快餐、早餐、飯捲、拉麵、水果與便利商店鮮食\n- 小木屋鬆餅、OK 便利商店\n\n⏰ 營業時間依校方公告與現場公告為準。\n\n想知道今天有哪些可推薦餐點，我會用已載入的官方菜單資料回答，不會亂編價格。',
              suggestions: ['附近有什麼好吃的', '便利商店在哪', '餐廳營業時間'],
            },
            {
              pattern: /選課|加退選|課程|修課|學分|必修|選修|通識/,
              answer:
                '靜宜大學選課相關：\n\n📚 選課時程：\n- 初選：通常於開學前 2-3 週\n- 加退選：開學第一至二週\n- 停修：期中考後約一週內\n\n💡 注意事項：\n- 每學期修課上限通常為 25 學分\n- 必修衝堂請洽系辦協調\n- 通識課程需注意領域分配\n- 選課系統：校務行政資訊系統\n\n建議開學前先規劃好課表，熱門課程初選就要搶！',
              suggestions: ['怎麼選課', '學分上限', '通識規定'],
            },
            {
              pattern: /請假|缺課|曠課|出席|病假|事假/,
              answer:
                '靜宜大學請假規定：\n\n📋 請假類型：病假、事假、公假、喪假、產假等\n\n請假流程：\n1. 登入校務系統 → 學生請假系統\n2. 填寫假別、日期、事由\n3. 附上證明文件（病假需醫療證明）\n4. 送出後等待導師/任課老師核准\n\n⚠️ 注意：\n- 曠課達該科總時數 1/3 將被扣考\n- 病假需於銷假後 3 天內補辦\n- 事假應事先請假\n\n有請假問題建議直接洽詢導師或學務處。',
              suggestions: ['怎麼請病假', '缺課上限', '補假流程'],
            },
            {
              pattern: /成績|分數|GPA|學期成績|期中考|期末考/,
              answer:
                '靜宜大學成績相關：\n\n📊 成績查詢：登入校務行政資訊系統 → 成績查詢\n\n成績計算：\n- 通常包含：平時成績（30-40%）、期中考（20-30%）、期末考（30-40%）\n- 各科比例由任課老師決定，請參考課程大綱\n- 及格分數：學士班 60 分\n\n💡 提醒：\n- 期中預警成績會由系統通知\n- 對成績有疑義可在公告期間申請複查\n- 學期平均未達標準可能影響預警或退學',
              suggestions: ['怎麼查成績', 'GPA 怎麼算', '成績複查'],
            },
            {
              pattern: /停車|機車|汽車|腳踏車|車位|停車場/,
              answer:
                '靜宜大學停車資訊：\n\n🅿️ 停車場位置：\n- 機車停車場：校門口附近及各棟周邊\n- 汽車停車場：校園外圍停車區\n- YouBike 站點：校門口附近\n\n注意事項：\n- 機車需辦理停車證\n- 上課尖峰時段車位較緊張，建議提早\n- 違規停車會被拖吊或開單',
              suggestions: ['機車停車證怎麼辦', 'YouBike 在哪', '停車場位置'],
            },
            {
              pattern: /校園|學校|靜宜|在哪|怎麼走|地圖|位置/,
              answer:
                '靜宜大學校園資訊：\n\n📍 地址：台中市沙鹿區台灣大道七段 200 號\n📞 總機：(04) 2632-8001\n\n校園主要建築：\n- 主顧樓、任垣樓、伯鐸樓 — 教學大樓\n- 蓋夏圖書館 — 圖書與自習\n- 至善樓 — 行政中心\n- 體育館、田徑場 — 運動設施\n- 靜園餐廳、宜園餐廳、至善美食廣場 — 校內餐飲點\n\n想知道特定地點怎麼走，可以告訴我你要去哪裡！',
              suggestions: ['圖書館在哪', '怎麼去台中車站', '餐廳在哪'],
            },
          ];

          for (const kb of campusKB) {
            if (kb.pattern.test(_userText)) {
              emergencyContent = kb.answer;
              emergencySuggestions = kb.suggestions;
              break;
            }
          }
        }

        // 3) 打招呼 / 基礎對話
        if (!emergencyContent) {
          if (/你好|嗨|哈囉|hello|hi|hey|早安|午安|晚安/.test(_userText)) {
            emergencyContent =
              '你好！我是靜宜校園 AI 助理 🎓\n\n可以問我交通資訊、校園設施、課程問題等，我會盡力幫你解答！';
            emergencySuggestions = ['怎麼去台中車站', '圖書館開放時間', '今天有什麼課'];
          } else if (/謝謝|感謝|thx|thanks/.test(_userText)) {
            emergencyContent = '不客氣！有其他問題隨時問我 😊';
            emergencySuggestions = ['還有其他問題', '查課表', '查交通'];
          } else if (/你是誰|你叫什麼|自我介紹/.test(_userText)) {
            emergencyContent =
              '我是靜宜大學校園 AI 助理！\n\n我可以幫你：\n- 🚌 查交通路線（怎麼去台中車站、高鐵等）\n- 📚 查課程和作業資訊\n- 🏫 校園設施位置與開放時間\n- 🍽️ 餐廳和用餐資訊\n- 📋 請假、選課等學務問題\n\n有什麼想問的，儘管說！';
            emergencySuggestions = ['怎麼去台中車站', '圖書館在哪', '今天吃什麼'];
          }
        }
      } catch (_emergencyError) {
        // 緊急回退本身也出錯，放棄
        console.error('[AIChat] Emergency fallback also failed:', _emergencyError);
      }

      const errorMsg: Message = {
        id: genMsgId(),
        role: 'assistant',
        content:
          emergencyContent ??
          '抱歉，處理你的訊息時發生了意外錯誤。請再試一次，或換個方式問問看！\n\n你可以試試這些問題：\n- 怎麼去台中車站\n- 圖書館開放時間\n- 校園餐廳在哪\n- 怎麼請假',
        timestamp: new Date(),
        agentType: 'text',
        suggestions: emergencySuggestions,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      // ★ 無論任何路徑，一定重置 isTyping
      setIsTyping(false);
    }
  };

  // ── Other handlers ──
  const handleAction = async (proposal: AssistantActionProposal) => {
    const { action, params } = proposal;
    if (proposal.requiresConfirmation && action !== 'navigate') {
      Alert.alert(
        '需要你確認',
        'AI 只會先建立草稿或建議，不會直接送出敏感操作。請確認後再到對應功能完成送出。',
        [
          { text: '取消', style: 'cancel' },
          {
            text: '查看草稿',
            onPress: () => {
              if (params?.screen && typeof params.screen === 'string') {
                handleAction({ ...proposal, requiresConfirmation: false, action: 'navigate' });
              }
            },
          },
        ],
      );
      return;
    }

    if ((action === 'navigate' || action === 'start_navigation') && params) {
      const screen = typeof params.screen === 'string' ? params.screen : null;
      const nested = typeof params.nested === 'string' ? params.nested : null;
      const nestedParams = { ...params };
      delete nestedParams.screen;
      delete nestedParams.nested;
      if (!screen) return;
      navigateToTarget(
        nav,
        buildNavigationTarget(
          auth.profile?.role,
          screen,
          nested,
          Object.keys(nestedParams).length > 0 ? nestedParams : undefined,
        ),
      );
      return;
    }

    if (action === 'schedule_reminder') {
      Alert.alert('提醒草稿', '已建立提醒建議。正式送出前仍需要你在行事曆或通知設定中確認。');
      return;
    }

    if (action === 'split_assignment') {
      void handleSend('幫我把這個作業拆成今天可以完成的步驟');
      return;
    }
  };

  const handleSuggestion = (text: string) => {
    // 點擊建議選項 = 正面訊號（表示 AI 的引導有用）
    if (lastQAPairIdRef.current) {
      setTrainingDB((prev) => updatePairQuality(prev, lastQAPairIdRef.current!, +1, true));
    }
    void handleSend(text);
  };

  const handleFeedback = useCallback(
    (messageId: string, rating: 'thumbs_up' | 'thumbs_down') => {
      const targetMsg = messages.find((m) => m.id === messageId);
      if (!targetMsg) return;
      const previousUserMsg = [...messages]
        .reverse()
        .find((m) => m.role === 'user' && messages.indexOf(m) < messages.indexOf(targetMsg));
      submitFeedback({
        messageId,
        userMessage: previousUserMsg?.content ?? '',
        assistantResponse: targetMsg.content,
        rating,
        userId: auth.user?.uid,
      });

      // ✅ 自動訓練：thumbs up/down 直接更新 QA 品質
      // 尋找對應的 training pair（按問題內容匹配）
      if (previousUserMsg) {
        const matchingPair = trainingDB.pairs.find(
          (p) =>
            p.question === previousUserMsg.content &&
            p.answer.slice(0, 50) === targetMsg.content.slice(0, 50),
        );
        if (matchingPair) {
          const delta = rating === 'thumbs_up' ? +1 : -1;
          setTrainingDB((prev) =>
            updatePairQuality(prev, matchingPair.id, delta, rating === 'thumbs_up'),
          );
        }
        // 同步訓練 AI 大腦
        const reward = rating === 'thumbs_up' ? +1 : -1;
        setAiBrain((prev) =>
          trainFromFeedback(
            prev,
            previousUserMsg.content,
            targetMsg.content,
            lastIntentRef.current,
            lastStrategyRef.current,
            reward,
          ),
        );
      }
    },
    [messages, auth.user?.uid, trainingDB.pairs],
  );

  const handleClearHistory = useCallback(() => {
    Alert.alert('清除對話記錄', '確定要清除所有對話記錄嗎？', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: async () => {
          try {
            await clearAIChatHistory(chatHistoryKey);
          } catch (e) {
            console.warn('[AIChat] clear fail:', e);
          }
          const name = auth.profile?.displayName?.split(' ')[0] ?? '同學';
          const greeting: Message = {
            id: 'greeting',
            role: 'assistant',
            content: buildGreetingContent(name),
            timestamp: new Date(),
            agentType: 'capability_card',
            suggestions: isOfflineAI
              ? ['幫我訂午餐', '請假信草稿', '圖書館在哪']
              : ['幫我訂午餐', '我頭有點痛', '預約圖書館座位'],
          };
          setMessages([greeting]);
          setShowCapabilities(true);
          setRecentExecutions(isOfflineAI ? [] : simulateRecentExecutions());
          setProactiveMessages(isOfflineAI ? [] : simulateProactiveMessages());
          setAgentContext(getInitialContext());
        },
      },
    ]);
  }, [auth.profile?.displayName, buildGreetingContent, chatHistoryKey, isOfflineAI]);

  // ═══════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════

  return (
    <Screen>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={90}
      >
        <View style={{ flex: 1 }}>
          {/* Recent Executions Bar */}
          <RecentExecutionsBar executions={recentExecutions} />

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={{
              padding: 16,
              paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 70,
            }}
            showsVerticalScrollIndicator={false}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 12,
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: theme.colors.surface2,
                borderWidth: 1,
                borderColor: theme.colors.border,
                marginBottom: 12,
              }}
            >
              <View
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 15,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${aiModeMeta.color}20`,
                }}
              >
                <Ionicons name={aiModeMeta.icon} size={16} color={aiModeMeta.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: '700' }}>
                  {aiModeMeta.label}
                </Text>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
                  {aiModeMeta.detail}
                </Text>
              </View>
            </View>

            {/* Proactive Banners */}
            {proactiveMessages.map((pm, i) => (
              <ProactiveBanner
                key={pm.trigger.id}
                trigger={pm.trigger}
                message={pm.message}
                onAction={() => handleProactiveAction(pm.trigger.id)}
                onDismiss={() => setProactiveMessages((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}

            {/* Messages */}
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                onAction={handleAction}
                onSuggestion={handleSuggestion}
                onFeedback={handleFeedback}
                onConfirmTool={handleConfirmTool}
                onCancelTool={handleCancelTool}
                onParamSelect={handleParamSelect}
                onSkipChainStep={handleSkipChainStep}
                onProactiveAction={handleProactiveAction}
              />
            ))}

            {/* Capability Grid (first launch) */}
            {showCapabilities && messages.length <= 1 && (
              <View style={{ marginTop: 8 }}>
                <Text
                  style={{
                    color: theme.colors.muted,
                    fontSize: 12,
                    fontWeight: '600',
                    marginBottom: 6,
                  }}
                >
                  我能幫你做的事：
                </Text>
                <CapabilityGrid
                  role={userRole}
                  onTryTool={handleSuggestion}
                  offline={isOfflineAI}
                />
              </View>
            )}

            {/* Typing indicator */}
            {isTyping && (
              <View style={{ alignSelf: 'flex-start', marginTop: 8 }}>
                <View
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}
                >
                  <View
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      backgroundColor: '#6366F1',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Ionicons name="flash" size={12} color="#fff" />
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>思考中...</Text>
                </View>
                <View
                  style={{
                    padding: 8,
                    borderRadius: 18,
                    backgroundColor: theme.colors.surface2,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                  }}
                >
                  <TypingIndicator />
                </View>
              </View>
            )}
          </ScrollView>
        </View>

        {/* Input Bar */}
        <View
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            padding: 12,
            paddingBottom: Platform.OS === 'ios' ? 24 : 12,
            backgroundColor: theme.colors.bg,
            borderTopWidth: 1,
            borderTopColor: theme.colors.border,
          }}
        >
          {/* Agent state indicator */}
          {agentContext.state !== 'idle' && agentContext.state !== 'reporting' && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                marginBottom: 6,
                paddingHorizontal: 4,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor:
                    agentContext.state === 'executing'
                      ? '#10B981'
                      : agentContext.state === 'confirming' ||
                          agentContext.state === 'waiting_chain_confirm'
                        ? '#F59E0B'
                        : '#6366F1',
                }}
              />
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                {agentContext.state === 'collecting_params'
                  ? '收集資訊中...'
                  : agentContext.state === 'confirming'
                    ? '等待確認...'
                    : agentContext.state === 'waiting_chain_confirm'
                      ? '等待你的確認...'
                      : agentContext.state === 'executing'
                        ? '執行中...'
                        : '處理中...'}
              </Text>
            </View>
          )}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              padding: 8,
              borderRadius: 999,
              backgroundColor: theme.colors.surface2,
              borderWidth: 1,
              borderColor: theme.colors.border,
            }}
          >
            <Pressable
              onPress={handleClearHistory}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: pressed ? theme.colors.surface2 : 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Ionicons name="trash-outline" size={18} color={theme.colors.muted} />
            </Pressable>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={
                agentContext.state === 'collecting_params' ? '輸入資訊...' : '告訴我你需要什麼...'
              }
              placeholderTextColor={theme.colors.muted}
              onSubmitEditing={() => handleSend()}
              returnKeyType="send"
              style={{
                flex: 1,
                paddingHorizontal: 12,
                paddingVertical: 8,
                color: theme.colors.text,
                fontSize: 15,
              }}
            />
            <Pressable
              onPress={() => handleSend()}
              disabled={!input.trim()}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: input.trim() ? '#6366F1' : theme.colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="send" size={18} color={input.trim() ? '#fff' : theme.colors.muted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
