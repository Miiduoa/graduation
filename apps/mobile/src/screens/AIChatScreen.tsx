/* eslint-disable */
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";
import { Screen } from "../ui/components";
import { TAB_BAR_CONTENT_BOTTOM_PADDING } from "../ui/navigationTheme";
import { theme } from "../ui/theme";
import { useSchool } from "../state/school";
import { useAuth } from "../state/auth";
import { useDataSource } from "../hooks/useDataSource";
import { useAsyncList } from "../hooks/useAsyncList";
import { useSchedule } from "../state/schedule";
import {
  chatWithCampusAssistant,
  chatWithLocalLLMStreaming,
  getAIStatus,
  submitFeedback,
  type AIMessage,
  type AIContext,
  type StreamingCallback,
} from "../services/ai";
import { toDate } from "../utils/format";
import {
  clearAIChatHistory,
  getAIChatHistoryStorageKey,
  loadAIChatHistory,
  loadAiPersonalContext,
  saveAIChatHistory,
  type AiPersonalContext,
} from "../features/ai";
import { loadPersistedValue, savePersistedValue } from "../services/persistedStorage";
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
} from "../services/localAIEngine";
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
  type LocalTrainingDB,
} from "../data/puAIAgentData";

// ═══════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════

const CHAT_HISTORY_MAX = 50;

// Unique message ID generator — prevents React key collisions
let _msgIdSeq = 0;
function genMsgId(prefix = "msg"): string {
  _msgIdSeq += 1;
  return `${prefix}-${Date.now()}-${_msgIdSeq}-${Math.random().toString(36).slice(2, 5)}`;
}

type MessageRole = "user" | "assistant" | "system";

type AgentMessageType =
  | "text"                // 純文字
  | "thinking"            // 思考過程
  | "tool_confirm"        // 確認執行工具
  | "tool_executing"      // 執行中
  | "tool_result"         // 執行結果
  | "chain_progress"      // 任務鏈進度
  | "param_collect"       // 收集參數
  | "proactive"           // 主動推播
  | "capability_card";    // 能力展示卡

type ThinkingStepUI = { step: string; detail: string; status: "done" | "checking" | "warning" | "info" };

type Message = {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: Date;
  suggestions?: string[];
  actions?: Array<{ label: string; action: string; params?: Record<string, unknown> }>;
  agentType?: AgentMessageType;
  toolExecution?: ToolExecution;
  chainProgress?: { chain: TaskChain; currentStep: number; completedSteps: number[] };
  paramCollect?: { tool: AgentTool; collected: Record<string, any>; nextParam: ToolParameter };
  proactiveTrigger?: ProactiveTrigger;
  thinkingSteps?: ThinkingStepUI[];
};

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
        ])
      );
    const a1 = createAnimation(dot1, 0);
    const a2 = createAnimation(dot2, 150);
    const a3 = createAnimation(dot3, 300);
    animationsRef.current = [a1, a2, a3];
    a1.start(); a2.start(); a3.start();
    return () => { animationsRef.current.forEach(a => a.stop()); dot1.setValue(0); dot2.setValue(0); dot3.setValue(0); };
  }, [dot1, dot2, dot3]);

  return (
    <View style={{ flexDirection: "row", gap: 4, padding: 12 }}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent, opacity: dot }} />
      ))}
    </View>
  );
}

// ── Thinking Bubble ──
function ThinkingBubble(props: { steps: ThinkingStepUI[]; collapsed?: boolean }) {
  const { steps, collapsed } = props;
  const [isExpanded, setIsExpanded] = useState(!collapsed);
  const statusIcon: Record<string, { icon: string; color: string }> = {
    done: { icon: "checkmark-circle", color: "#10B981" },
    checking: { icon: "sync-outline", color: "#6366F1" },
    warning: { icon: "alert-circle", color: "#F59E0B" },
    info: { icon: "information-circle", color: "#3B82F6" },
  };

  return (
    <Pressable onPress={() => setIsExpanded(e => !e)} style={{
      backgroundColor: `${theme.colors.accent}08`, borderRadius: 12, padding: 10,
      borderWidth: 1, borderColor: `${theme.colors.accent}15`, marginBottom: 6,
    }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name="bulb-outline" size={14} color={theme.colors.accent} />
        <Text style={{ color: theme.colors.accent, fontSize: 12, fontWeight: "600", flex: 1 }}>思考過程</Text>
        <Ionicons name={isExpanded ? "chevron-up" : "chevron-down"} size={14} color={theme.colors.muted} />
      </View>
      {isExpanded && (
        <View style={{ marginTop: 8, gap: 4 }}>
          {steps.map((s, i) => {
            const si = statusIcon[s.status] ?? statusIcon.info;
            return (
              <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, paddingLeft: 4 }}>
                <Text style={{ color: theme.colors.muted, fontSize: 11, marginTop: 1 }}>
                  {i < steps.length - 1 ? "├" : "└"}
                </Text>
                <Ionicons name={si.icon as any} size={12} color={si.color} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.colors.text, fontSize: 12 }}>
                    <Text style={{ fontWeight: "600" }}>{s.step}</Text>
                    <Text style={{ color: theme.colors.muted }}>  {s.detail}</Text>
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
    <View style={{ backgroundColor: theme.colors.surface2, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: `${tool.color}30`, marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${tool.color}20`, alignItems: "center", justifyContent: "center" }}>
          <Ionicons name={tool.icon as any} size={18} color={tool.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15 }}>{tool.name}</Text>
          <Text style={{ color: theme.colors.muted, fontSize: 12 }}>{tool.description}</Text>
        </View>
      </View>
      {/* Parameters */}
      <View style={{ backgroundColor: `${tool.color}08`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
        {Object.entries(execution.params).map(([key, val]) => {
          const paramDef = tool.parameters.find(p => p.name === key);
          return (
            <View key={key} style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 }}>
              <Text style={{ color: theme.colors.muted, fontSize: 13 }}>{paramDef?.label ?? key}</Text>
              <Text style={{ color: theme.colors.text, fontSize: 13, fontWeight: "600" }}>
                {paramDef?.type === "select"
                  ? paramDef.options?.find(o => o.value === val)?.label ?? String(val)
                  : String(val)}
              </Text>
            </View>
          );
        })}
      </View>
      {execution.confirmationMessage && (
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 10, fontStyle: "italic" }}>
          {execution.confirmationMessage}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Pressable onPress={onCancel} style={{ flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border, alignItems: "center" }}>
          <Text style={{ color: theme.colors.muted, fontWeight: "600" }}>取消</Text>
        </Pressable>
        <Pressable onPress={onConfirm} style={{ flex: 2, paddingVertical: 10, borderRadius: 10, backgroundColor: tool.color, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontWeight: "700" }}>確認執行</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Tool Execution Status Card ──
function ToolStatusCard(props: { execution: ToolExecution; tool: AgentTool | undefined }) {
  const { execution, tool } = props;
  if (!tool) return null;
  const statusConfig: Record<ToolExecutionStatus, { icon: string; color: string; label: string }> = {
    pending: { icon: "hourglass-outline", color: "#F59E0B", label: "等待中" },
    confirming: { icon: "help-circle-outline", color: "#3B82F6", label: "待確認" },
    executing: { icon: "sync-outline", color: "#6366F1", label: "執行中" },
    success: { icon: "checkmark-circle", color: "#10B981", label: "完成" },
    failed: { icon: "close-circle", color: "#EF4444", label: "失敗" },
    cancelled: { icon: "ban-outline", color: "#6B7280", label: "已取消" },
  };
  const sc = statusConfig[execution.status];
  return (
    <View style={{ backgroundColor: theme.colors.surface2, borderRadius: 14, padding: 14, borderLeftWidth: 3, borderLeftColor: sc.color, marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 }}>
        {execution.status === "executing" ? (
          <ActivityIndicator size="small" color={sc.color} />
        ) : (
          <Ionicons name={sc.icon as any} size={18} color={sc.color} />
        )}
        <Text style={{ color: sc.color, fontWeight: "700", fontSize: 14 }}>{tool.name} — {sc.label}</Text>
      </View>
      {execution.result && (
        <Text style={{ color: theme.colors.text, fontSize: 13, lineHeight: 20, marginTop: 2 }}>{execution.result}</Text>
      )}
      {execution.error && (
        <Text style={{ color: "#EF4444", fontSize: 13, lineHeight: 20, marginTop: 2 }}>{execution.error}</Text>
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
    <View style={{ backgroundColor: theme.colors.surface2, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: `${chain.color}30`, marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Ionicons name={chain.icon as any} size={20} color={chain.color} />
        <Text style={{ color: theme.colors.text, fontWeight: "700", fontSize: 15, flex: 1 }}>{chain.name}</Text>
        <Text style={{ color: theme.colors.muted, fontSize: 11 }}>{completedSteps.length}/{chain.steps.length}</Text>
      </View>
      {chain.steps.map((step) => {
        const isDone = completedSteps.includes(step.order);
        const isCurrent = step.order === currentStep;
        const tool = getToolById(step.toolId);
        return (
          <View key={step.order} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6 }}>
            <View style={{
              width: 24, height: 24, borderRadius: 12,
              backgroundColor: isDone ? "#10B981" : isCurrent ? chain.color : theme.colors.surface2,
              borderWidth: isCurrent ? 0 : 1, borderColor: theme.colors.border,
              alignItems: "center", justifyContent: "center",
            }}>
              {isDone ? (
                <Ionicons name="checkmark" size={14} color="#fff" />
              ) : isCurrent ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={{ color: theme.colors.muted, fontSize: 10, fontWeight: "700" }}>{step.order}</Text>
              )}
            </View>
            <Text style={{
              color: isDone ? "#10B981" : isCurrent ? theme.colors.text : theme.colors.muted,
              fontSize: 13, fontWeight: isCurrent ? "700" : "400", flex: 1,
              textDecorationLine: isDone ? "line-through" : "none",
            }}>
              {step.label}
            </Text>
            {step.optional && isCurrent && (
              <Pressable onPress={onSkipStep} style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
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
    <Pressable onPress={onAction} style={{
      flexDirection: "row", alignItems: "center", gap: 10, padding: 12,
      backgroundColor: `${trigger.color}12`, borderRadius: 12, borderWidth: 1, borderColor: `${trigger.color}25`,
      marginBottom: 8,
    }}>
      <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: `${trigger.color}20`, alignItems: "center", justifyContent: "center" }}>
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
function ParamCollectRow(props: {
  param: ToolParameter;
  onSelect: (value: string) => void;
}) {
  const { param, onSelect } = props;
  if (param.type === "select" && param.options) {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>{param.label}：</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {param.options.map(opt => (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.colors.accentSoft, borderWidth: 1, borderColor: `${theme.colors.accent}40` }}
            >
              <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{opt.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    );
  }
  if (param.type === "multi_select" && param.options) {
    return (
      <View style={{ marginTop: 8 }}>
        <Text style={{ color: theme.colors.muted, fontSize: 12, marginBottom: 6 }}>{param.label}（可多選，選完輸入任意文字繼續）：</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {param.options.map(opt => (
            <Pressable
              key={opt.value}
              onPress={() => onSelect(opt.value)}
              style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}
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
        請輸入 {param.label}{param.hint ? `（${param.hint}）` : ""}：
      </Text>
    </View>
  );
}

// ── Capability Showcase (shows on first launch) ──
function CapabilityGrid(props: { role: AgentRole; onTryTool: (prompt: string) => void }) {
  const { role, onTryTool } = props;
  const capabilities = getAgentCapabilitySummary(role);
  const quickPrompts: Record<string, string> = {
    "cafeteria": "幫我推薦今天午餐",
    "health": "我有點頭痛，幫我評估",
    "library": "幫我預約圖書館座位",
    "dorm": "宿舍冷氣壞了，幫我報修",
    "lost_found": "我在圖書館掉了學生證",
    "print": "查詢列印餘額",
    "course": "幫我請明天的病假",
    "transport": "查公車到站時間",
    "calendar": "提醒我明天下午交作業",
    "social": "發訊息給我的課程群組",
  };
  const tools = AGENT_TOOLS.filter(t => t.roleAccess.includes(role));
  const categories = Array.from(new Set(tools.map(t => t.category)));

  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      {categories.slice(0, 5).map(cat => {
        const catTools = tools.filter(t => t.category === cat);
        const firstTool = catTools[0];
        if (!firstTool) return null;
        return (
          <Pressable
            key={cat}
            onPress={() => onTryTool(quickPrompts[cat] ?? `幫我${firstTool.name}`)}
            style={{
              flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: 12,
              backgroundColor: `${firstTool.color}08`, borderRadius: 10, borderWidth: 1, borderColor: `${firstTool.color}15`,
            }}
          >
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: `${firstTool.color}18`, alignItems: "center", justifyContent: "center" }}>
              <Ionicons name={firstTool.icon as any} size={14} color={firstTool.color} />
            </View>
            <Text style={{ color: theme.colors.text, fontSize: 13, flex: 1 }}>
              {catTools.map(t => t.name).join(" / ")}
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
      <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "600", marginBottom: 6 }}>最近操作</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {executions.map(exec => {
          const tool = getToolById(exec.toolId);
          if (!tool) return null;
          const isSuccess = exec.status === "success";
          return (
            <View key={exec.id} style={{
              flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6,
              borderRadius: 999, backgroundColor: isSuccess ? "#10B98115" : "#EF444415",
              borderWidth: 1, borderColor: isSuccess ? "#10B98125" : "#EF444425",
            }}>
              <Ionicons name={isSuccess ? "checkmark-circle" : "close-circle"} size={14} color={isSuccess ? "#10B981" : "#EF4444"} />
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
  onAction?: (action: string, params?: Record<string, unknown>) => void;
  onSuggestion?: (text: string) => void;
  onFeedback?: (messageId: string, rating: "thumbs_up" | "thumbs_down") => void;
  onConfirmTool?: (executionId: string) => void;
  onCancelTool?: (executionId: string) => void;
  onParamSelect?: (value: string) => void;
  onSkipChainStep?: () => void;
  onProactiveAction?: (triggerId: string) => void;
}) {
  const { message, onAction, onSuggestion, onFeedback, onConfirmTool, onCancelTool, onParamSelect, onSkipChainStep, onProactiveAction } = props;
  const isUser = message.role === "user";
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(isUser ? 20 : -20)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    animRef.current = Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 300, useNativeDriver: true, easing: Easing.out(Easing.cubic) }),
    ]);
    animRef.current.start();
    return () => { animRef.current?.stop(); };
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateX: slideAnim }], alignSelf: isUser ? "flex-end" : "flex-start", maxWidth: isUser ? "85%" : "92%", marginVertical: 4 }}>
      {/* Agent avatar for non-user messages */}
      {!isUser && (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#6366F1", alignItems: "center", justifyContent: "center" }}>
            <Ionicons name="flash" size={12} color="#fff" />
          </View>
          <Text style={{ color: theme.colors.muted, fontSize: 11, fontWeight: "600" }}>AI Agent</Text>
          {message.agentType && message.agentType !== "text" && (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: "#6366F115" }}>
              <Text style={{ color: "#6366F1", fontSize: 9, fontWeight: "600" }}>
                {message.agentType === "tool_confirm" ? "確認" : message.agentType === "tool_executing" ? "執行中" : message.agentType === "tool_result" ? "結果" : message.agentType === "chain_progress" ? "任務鏈" : message.agentType === "param_collect" ? "收集資訊" : message.agentType === "proactive" ? "主動建議" : ""}
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Thinking Steps */}
      {!isUser && message.thinkingSteps && message.thinkingSteps.length > 0 && (
        <ThinkingBubble steps={message.thinkingSteps} collapsed={message.agentType !== "thinking"} />
      )}

      {/* Main bubble */}
      {message.content.length > 0 && (
        <View style={{
          padding: 14, borderRadius: 18,
          borderBottomRightRadius: isUser ? 4 : 18,
          borderBottomLeftRadius: isUser ? 18 : 4,
          backgroundColor: isUser ? theme.colors.accent : theme.colors.surface2,
          borderWidth: isUser ? 0 : 1, borderColor: theme.colors.border,
        }}>
          <Text style={{ color: isUser ? "#fff" : theme.colors.text, lineHeight: 22, fontSize: 14 }}>{message.content}</Text>
        </View>
      )}

      {/* Tool Confirm Card */}
      {message.agentType === "tool_confirm" && message.toolExecution && (
        <ToolConfirmCard
          execution={message.toolExecution}
          tool={getToolById(message.toolExecution.toolId)}
          onConfirm={() => onConfirmTool?.(message.toolExecution!.id)}
          onCancel={() => onCancelTool?.(message.toolExecution!.id)}
        />
      )}

      {/* Tool Status Card */}
      {(message.agentType === "tool_executing" || message.agentType === "tool_result") && message.toolExecution && (
        <ToolStatusCard execution={message.toolExecution} tool={getToolById(message.toolExecution.toolId)} />
      )}

      {/* Chain Progress */}
      {message.agentType === "chain_progress" && message.chainProgress && (
        <ChainProgressCard
          chain={message.chainProgress.chain}
          currentStep={message.chainProgress.currentStep}
          completedSteps={message.chainProgress.completedSteps}
          onSkipStep={onSkipChainStep}
        />
      )}

      {/* Param Collection */}
      {message.agentType === "param_collect" && message.paramCollect && (
        <ParamCollectRow param={message.paramCollect.nextParam} onSelect={v => onParamSelect?.(v)} />
      )}

      {/* Suggestions */}
      {message.suggestions && message.suggestions.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {message.suggestions.map((s, i) => (
            <Pressable key={i} onPress={() => onSuggestion?.(s)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: theme.colors.accentSoft, borderWidth: 1, borderColor: `${theme.colors.accent}40` }}>
              <Text style={{ color: theme.colors.accent, fontSize: 13 }}>{s}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Action buttons */}
      {message.actions && message.actions.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {message.actions.map((a, i) => (
            <Pressable key={i} onPress={() => onAction?.(a.action, a.params)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: theme.radius.md, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
              <Ionicons name="open-outline" size={14} color={theme.colors.accent} />
              <Text style={{ color: theme.colors.text, fontSize: 13 }}>{a.label}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Timestamp + Feedback */}
      <View style={{ flexDirection: "row", alignItems: "center", marginTop: 4, marginLeft: 4, gap: 8 }}>
        <Text style={{ color: theme.colors.muted, fontSize: 10 }}>
          {message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </Text>
        {!isUser && message.id !== "greeting" && (
          <View style={{ flexDirection: "row", gap: 4 }}>
            <Pressable onPress={() => { setFeedbackGiven("thumbs_up"); onFeedback?.(message.id, "thumbs_up"); }} style={{ padding: 4, opacity: feedbackGiven === "thumbs_down" ? 0.3 : 1 }} disabled={!!feedbackGiven}>
              <Ionicons name={feedbackGiven === "thumbs_up" ? "thumbs-up" : "thumbs-up-outline"} size={14} color={feedbackGiven === "thumbs_up" ? theme.colors.accent : theme.colors.muted} />
            </Pressable>
            <Pressable onPress={() => { setFeedbackGiven("thumbs_down"); onFeedback?.(message.id, "thumbs_down"); }} style={{ padding: 4, opacity: feedbackGiven === "thumbs_up" ? 0.3 : 1 }} disabled={!!feedbackGiven}>
              <Ionicons name={feedbackGiven === "thumbs_down" ? "thumbs-down" : "thumbs-down-outline"} size={14} color={feedbackGiven === "thumbs_down" ? "#e74c3c" : theme.colors.muted} />
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
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [aiStatus] = useState(() => getAIStatus());
  const [pendingAssignments, setPendingAssignments] = useState<AiPersonalContext["pendingAssignments"]>([]);
  const [weeklyReport, setWeeklyReport] = useState<AiPersonalContext["weeklyReport"]>(null);
  const [showCapabilities, setShowCapabilities] = useState(true);
  const [recentExecutions, setRecentExecutions] = useState<ToolExecution[]>(() => simulateRecentExecutions());
  const [proactiveMessages, setProactiveMessages] = useState(() => simulateProactiveMessages());
  const [agentContext, setAgentContext] = useState<ConversationContext>(() => getInitialContext());
  const [agentMemory, setAgentMemory] = useState<AgentMemory>(() => getDefaultMemory(auth.user?.uid ?? "guest"));
  const [learningState, setLearningState] = useState<ActiveLearningState>(() => getDefaultLearningState());
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeNode[]>([]);
  const [trainingDB, setTrainingDB] = useState<LocalTrainingDB>(() => getDefaultTrainingDB());
  const lastQAPairIdRef = useRef<string | null>(null); // 追蹤最近的 QA pair，用於回饋評分
  // ── GPT 級本地 AI 大腦 ──
  const [aiBrain, setAiBrain] = useState<LocalAIBrain>(() => createAIBrain());
  const lastStrategyRef = useRef<ResponseStrategy>("direct_answer");
  const lastIntentRef = useRef<IntentLabel>("general");
  const userRole: AgentRole = "student"; // from auth in real app

  const memoryStorageKey = useMemo(
    () => getMemoryStorageKey(auth.user?.uid ?? "guest"),
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
          fallback: getDefaultMemory(auth.user?.uid ?? "guest"),
        });
        if (!cancelled) setAgentMemory(restored);
      } catch (e) { console.warn("[AIChat] memory load fail:", e); }
    }
    loadMemory();
    return () => { cancelled = true; };
  }, [memoryStorageKey, auth.user?.uid]);

  const saveMemoryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveMemoryRef.current) clearTimeout(saveMemoryRef.current);
    saveMemoryRef.current = setTimeout(async () => {
      try { await savePersistedValue(memoryStorageKey, agentMemory); }
      catch (e) { console.warn("[AIChat] memory save fail:", e); }
    }, 1000);
    return () => { if (saveMemoryRef.current) clearTimeout(saveMemoryRef.current); };
  }, [agentMemory, memoryStorageKey]);

  // ── Training DB persistence (自動訓練資料庫) ──
  const trainingDBKey = useMemo(
    () => getTrainingDBStorageKey(auth.user?.uid ?? "guest"),
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
        if (!cancelled) setTrainingDB(restored);
      } catch (e) { console.warn("[AIChat] training DB load fail:", e); }
    }
    loadTrainingData();
    return () => { cancelled = true; };
  }, [trainingDBKey]);

  const saveTrainingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTrainingRef.current) clearTimeout(saveTrainingRef.current);
    saveTrainingRef.current = setTimeout(async () => {
      try { await savePersistedValue(trainingDBKey, trainingDB); }
      catch (e) { console.warn("[AIChat] training DB save fail:", e); }
    }, 2000); // 2s debounce for training DB
    return () => { if (saveTrainingRef.current) clearTimeout(saveTrainingRef.current); };
  }, [trainingDB, trainingDBKey]);

  // ── AI Brain persistence (GPT 級大腦持久化) ──
  const brainStorageKey = useMemo(
    () => `${AI_BRAIN_STORAGE_KEY}_${auth.user?.uid ?? "guest"}`,
    [auth.user?.uid],
  );

  useEffect(() => {
    let cancelled = false;
    async function loadBrain() {
      try {
        const raw = await loadPersistedValue<string>({
          storageKey: brainStorageKey,
          fallback: "",
        });
        if (!cancelled && raw) {
          const restored = deserializeBrain(raw);
          if (restored) setAiBrain(restored);
        }
      } catch (e) { console.warn("[AIChat] brain load fail:", e); }
    }
    loadBrain();
    return () => { cancelled = true; };
  }, [brainStorageKey]);

  const saveBrainRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveBrainRef.current) clearTimeout(saveBrainRef.current);
    saveBrainRef.current = setTimeout(async () => {
      try {
        const serialized = serializeBrain(aiBrain);
        await savePersistedValue(brainStorageKey, serialized);
      } catch (e) { console.warn("[AIChat] brain save fail:", e); }
    }, 3000); // 3s debounce
    return () => { if (saveBrainRef.current) clearTimeout(saveBrainRef.current); };
  }, [aiBrain, brainStorageKey]);

  // ── Data Sources ──
  const { items: announcements } = useAsyncList(() => ds.listAnnouncements(school.id), [auth.user?.uid, ds, school.id]);
  const { items: events } = useAsyncList(() => ds.listEvents(school.id), [auth.user?.uid, ds, school.id]);
  const { items: menus } = useAsyncList(() => ds.listMenus(school.id), [auth.user?.uid, ds, school.id]);
  const { items: pois } = useAsyncList(() => ds.listPois(school.id), [auth.user?.uid, ds, school.id]);

  // ── Knowledge Graph: rebuild when data changes ──
  useEffect(() => {
    const graph = buildKnowledgeGraph({
      courses: courses.map(c => ({ id: c.id, name: c.name, teacher: c.teacher, dayOfWeek: c.dayOfWeek, credits: c.credits, startPeriod: c.startPeriod })),
      assignments: pendingAssignments.map(a => ({ id: a.id, title: a.title, groupName: a.groupName ?? "", dueAt: a.dueAt ? new Date(a.dueAt.seconds * 1000).toLocaleDateString("zh-TW") : undefined, isLate: a.isLate })),
      announcements: (announcements as any[]).map(a => ({ id: a.id, title: a.title, source: a.source })),
      events: (events as any[]).map(e => ({ id: e.id, title: e.title, location: e.location, startsAt: e.startsAt })),
      menus: (menus as any[]).map(m => ({ id: m.id, name: m.name ?? m.cafeteria, price: m.price, cafeteria: m.cafeteria })),
      pois: (pois as any[]).map(p => ({ id: p.id, name: p.name, category: p.category })),
      memory: agentMemory,
    });
    setKnowledgeGraph(graph);
    // Also detect interaction patterns
    const patterns = detectInteractionPatterns(agentMemory);
    if (patterns.length > 0) {
      setLearningState(prev => ({ ...prev, interactionPatterns: patterns }));
    }
  }, [courses, pendingAssignments, announcements, events, menus, pois, agentMemory]);

  // ── History persistence ──
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      try {
        const restored = await loadAIChatHistory(chatHistoryKey);
        if (!cancelled && restored.length > 0) {
          // Deduplicate + re-key old messages to prevent key collisions
          const seen = new Set<string>();
          const deduped = restored.map(m => {
            let id = m.id;
            if (seen.has(id)) id = genMsgId("restored");
            seen.add(id);
            return { ...m, id };
          });
          setMessages(deduped);
        }
      } catch (e) { console.warn("[AIChat] load fail:", e); }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, [chatHistoryKey]);

  const saveHistoryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (messages.length <= 1) return;
    if (saveHistoryRef.current) clearTimeout(saveHistoryRef.current);
    saveHistoryRef.current = setTimeout(async () => {
      try { await saveAIChatHistory(chatHistoryKey, messages, CHAT_HISTORY_MAX); }
      catch (e) { console.warn("[AIChat] save fail:", e); }
    }, 500);
    return () => { if (saveHistoryRef.current) clearTimeout(saveHistoryRef.current); };
  }, [messages, chatHistoryKey]);

  useEffect(() => {
    if (!auth.user) return;
    async function load() {
      try {
        const pc = await loadAiPersonalContext({ uid: auth.user!.uid, schoolId: school.id });
        setPendingAssignments(pc.pendingAssignments);
        setWeeklyReport(pc.weeklyReport);
      } catch (e) { console.warn("[AIChat] personal data fail:", e); }
    }
    load();
  }, [auth.user?.uid, school.id]);

  // ── AI Context ──
  const aiContext = useMemo<AIContext>(() => ({
    schoolId: school.id,
    userId: auth.user?.uid,
    userName: auth.profile?.displayName ?? undefined,
    announcements: (announcements as any[]).map(a => ({ id: a.id, title: a.title, source: a.source })),
    events: (events as any[]).map(e => ({ id: e.id, title: e.title, location: e.location, startsAt: e.startsAt })),
    menus: (menus as any[]).map(m => ({ id: m.id, name: m.name ?? m.cafeteria, price: m.price, cafeteria: m.cafeteria })),
    pois: (pois as any[]).map(p => ({ id: p.id, name: p.name, category: p.category })),
    courses: courses.map(c => ({ id: c.id, name: c.name, teacher: c.teacher, dayOfWeek: c.dayOfWeek, startPeriod: c.startPeriod, credits: c.credits })),
    pendingAssignments: pendingAssignments.map(a => ({ id: a.id, title: a.title, groupName: a.groupName ?? "", dueAt: a.dueAt ? new Date(a.dueAt.seconds * 1000).toLocaleDateString("zh-TW") : undefined, isLate: a.isLate })),
    weeklyReport: weeklyReport ? { summary: typeof weeklyReport.summary === "string" ? weeklyReport.summary : "", stats: { onTimeRate: typeof weeklyReport.stats?.onTimeRate === "number" ? weeklyReport.stats.onTimeRate : 100, totalSubmissions: typeof weeklyReport.stats?.totalSubmissions === "number" ? weeklyReport.stats.totalSubmissions : 0, newAchievements: typeof weeklyReport.stats?.newAchievements === "number" ? weeklyReport.stats.newAchievements : 0 } } : undefined,
    // 自動訓練洞察：從歷史對話學習的模式注入 LLM
    trainingInsights: exportTrainingInsights(trainingDB),
    // 對話上下文摘要：讓 Gemini 也知道目前的對話狀態
    contextSummary: getContextSummary(aiBrain.dialogCtx) +
      (aiBrain.conversationSummary ? " " + summaryToText(aiBrain.conversationSummary) : ""),
  }), [school.id, auth.user?.uid, auth.profile?.displayName, announcements, events, menus, pois, courses, pendingAssignments, weeklyReport, trainingDB, aiBrain.dialogCtx, aiBrain.conversationSummary]);

  // ── Greeting ──
  useEffect(() => {
    const name = auth.profile?.displayName?.split(" ")[0] ?? "同學";
    const greetingContent = simulateAgentGreeting(name, userRole);
    const greeting: Message = {
      id: "greeting",
      role: "assistant",
      content: greetingContent,
      timestamp: new Date(),
      agentType: "capability_card",
      suggestions: ["幫我訂午餐", "我頭有點痛", "幫我預約圖書館座位"],
    };
    setMessages([greeting]);
  }, [auth.user?.uid, courses.length]);

  // ═══════════════════════════════════════════════════
  // Semantic Intent Engine v2 — Context-Aware
  // ═══════════════════════════════════════════════════

  // Domain classification: determine what TOPIC the message is about
  type IntentDomain =
    | "academic"     // 課程、成績、學分、畢業、被當、選課
    | "dining"       // 餐飲、食物、訂餐
    | "health"       // 健康、症狀、看醫生
    | "location"     // 地點、導航
    | "library"      // 圖書館、借書、座位
    | "dorm"         // 宿舍、報修、洗衣、包裹
    | "transport"    // 公車、交通
    | "admin"        // 請假、公告、活動
    | "mood"         // 心情、情緒
    | "lostfound"    // 遺失、拾獲
    | "print"        // 列印、影印
    | "reminder"     // 提醒
    | "weather"      // 天氣
    | "greeting"     // 打招呼
    | "thanks"       // 感謝
    | "help"         // 功能說明
    | "general";     // 無法分類

  function classifyDomain(msg: string): { domain: IntentDomain; confidence: number } {
    const m = msg.toLowerCase();
    // Each domain: [keywords[], weight] — matched keywords * weight = score
    const domainRules: Array<{ domain: IntentDomain; keywords: string[]; weight: number }> = [
      { domain: "academic", weight: 3, keywords: [
        "課程", "課", "學分", "畢業", "被當", "當掉", "成績", "分數", "GPA", "排名",
        "選課", "修課", "退選", "加選", "必修", "選修", "通識", "學期", "教授", "老師",
        "期中", "期末", "考試", "報告", "上課", "翹課", "出席", "缺曠", "作業", "繳交",
        "截止", "deadline", "及格", "不及格", "二一", "退學", "延畢", "重修",
      ]},
      { domain: "dining", weight: 2, keywords: [
        "吃", "餐", "飯", "麵", "菜", "食", "訂餐", "點餐", "午餐", "晚餐", "早餐",
        "餐廳", "菜單", "蔬菜", "素食", "肉", "便當", "外送", "覓食", "肚子餓", "好餓",
        "想吃", "小吃", "湯", "飲料", "甜點", "推薦吃", "有什麼好吃",
      ]},
      { domain: "health", weight: 3, keywords: [
        "掛號", "看醫", "門診", "症狀", "不舒服", "頭痛", "肚子痛", "發燒", "感冒",
        "咳嗽", "流鼻水", "喉嚨痛", "拉肚子", "過敏", "頭暈", "噁心", "想吐", "受傷", "扭到",
      ]},
      { domain: "location", weight: 2, keywords: ["在哪", "怎麼走", "地點", "導航", "地圖", "位置", "路線"] },
      { domain: "library", weight: 2, keywords: ["圖書館", "借書", "還書", "找書", "查書", "館藏", "書籍", "自習室", "討論室", "預約座位", "圖書館座位"] },
      { domain: "dorm", weight: 2, keywords: ["宿舍", "報修", "壞了", "故障", "維修", "漏水", "洗衣機", "烘衣機", "洗衣", "包裹", "快遞", "取件", "宅配"] },
      { domain: "transport", weight: 2, keywords: ["公車", "搭車", "坐車", "交通", "幾號公車", "到站"] },
      { domain: "admin", weight: 2, keywords: ["請假", "病假", "事假", "公告", "消息", "通知", "活動", "報名", "社團"] },
      { domain: "mood", weight: 2, keywords: ["心情", "情緒", "壓力大", "焦慮", "緊張", "難過", "煩", "開心"] },
      { domain: "lostfound", weight: 2, keywords: ["遺失", "掉了", "不見了", "弄丟", "丟了", "拾獲", "撿到"] },
      { domain: "print", weight: 2, keywords: ["列印", "印報告", "印作業", "印文件", "影印卡", "列印餘額"] },
      { domain: "reminder", weight: 2, keywords: ["提醒", "提醒我", "鬧鐘", "別忘了", "記得"] },
      { domain: "weather", weight: 2, keywords: ["天氣", "下雨", "氣溫", "帶傘"] },
      { domain: "greeting", weight: 1, keywords: ["嗨", "你好", "哈囉", "hi", "hello", "hey", "早安", "午安", "晚安", "安安"] },
      { domain: "thanks", weight: 1, keywords: ["謝", "感恩", "3q", "thx", "thanks"] },
      { domain: "help", weight: 2, keywords: ["功能", "怎麼用", "說明", "幫助", "你能做", "你會什麼"] },
    ];

    let bestDomain: IntentDomain = "general";
    let bestScore = 0;

    for (const rule of domainRules) {
      const hits = rule.keywords.filter(k => m.includes(k)).length;
      const score = hits * rule.weight;
      if (score > bestScore) {
        bestScore = score;
        bestDomain = rule.domain;
      }
    }

    return { domain: bestDomain, confidence: Math.min(bestScore / 6, 1) };
  }

  // Check if message is an ACTION request (do something) vs QUESTION (ask something)
  function isActionRequest(msg: string): boolean {
    const actionIndicators = ["幫我", "幫忙", "請幫", "我要", "我想要", "可以幫", "訂", "預約",
      "報修", "掛號", "請假", "設定", "提醒我", "發訊息", "傳訊息", "列印", "點餐", "下單"];
    return actionIndicators.some(k => msg.includes(k));
  }

  // ── Agent Logic: Intent Detection + Tool Matching ──
  const detectIntentAndExecute = useCallback(async (userMessage: string) => {
    try {
      const lowerMsg = userMessage.toLowerCase();
      const { domain, confidence } = classifyDomain(lowerMsg);

      // 1. Check Task Chains first (multi-step workflows)
      const chain = matchTaskChain(userMessage);
      if (chain) {
        return startTaskChain(chain, userMessage);
      }

      // 2. ALWAYS try smart contextual response first (Q&A, campus info)
      //    This prevents tools from hijacking question-type queries
      const smartResponse = generateSmartResponse(userMessage, domain);
      if (smartResponse) return smartResponse;

      // 3. Only match tools if it's an ACTION request with correct domain
      if (isActionRequest(lowerMsg) || confidence >= 0.5) {
        const toolMatch = matchDirectTool(lowerMsg, domain);
        if (toolMatch) {
          return startToolExecution(toolMatch, userMessage);
        }
      }

      // 4. Fallback to AI service (mock or real LLM)
      return null;
    } catch (err) {
      console.warn("[AIChat] detectIntentAndExecute error:", err);
      return null; // 出錯就交給 AI 引擎處理
    }
  }, [announcements, events, menus, pois, courses, pendingAssignments, agentMemory]);

  function matchDirectTool(msg: string, domain: IntentDomain): AgentTool | null {
    // Domain-scoped tool matching: only match tools relevant to the detected domain
    const domainToolMap: Record<string, IntentDomain[]> = {
      order_meal: ["dining"],
      recommend_meal: ["dining"],
      check_wait_time: ["dining"],
      book_health: ["health"],
      symptom_check: ["health"],
      record_mood: ["mood"],
      reserve_seat: ["library"],
      search_book: ["library"],
      report_repair: ["dorm"],
      check_laundry: ["dorm"],
      check_package: ["dorm"],
      post_lost: ["lostfound"],
      search_found: ["lostfound"],
      print_file: ["print"],
      check_print_balance: ["print"],
      request_leave: ["admin", "academic"],
      check_grades: ["academic"],
      check_assignments: ["academic"],
      check_bus: ["transport", "location"],
      set_reminder: ["reminder"],
      send_message: ["general"], // broad scope
    };

    const toolKeywords: Record<string, string[]> = {
      order_meal: ["訂餐", "點餐", "幫我訂", "下單", "幫我點", "我要點"],
      recommend_meal: ["推薦吃", "吃什麼", "有什麼好吃", "想吃", "餐點", "菜單", "好餓", "肚子餓", "覓食", "哪裡吃"],
      check_wait_time: ["等多久", "排隊", "等候", "人多嗎", "要排", "要等"],
      book_health: ["掛號", "預約門診", "預約看診", "看醫生", "預約醫生", "看診"],
      symptom_check: ["不舒服", "頭痛", "肚子痛", "發燒", "症狀", "身體不適", "感冒", "咳嗽",
        "流鼻水", "喉嚨痛", "拉肚子", "過敏", "頭暈", "噁心", "想吐", "受傷", "扭到"],
      record_mood: ["記錄心情", "今天過得", "壓力大"],
      reserve_seat: ["預約座位", "圖書館座位", "討論室", "自習室", "訂位子", "找位子"],
      search_book: ["借書", "找書", "查書", "書籍", "館藏"],
      report_repair: ["報修", "壞了", "故障", "維修", "漏水", "不能用"],
      check_laundry: ["洗衣機", "烘衣機", "洗衣", "洗衣服", "烘衣服"],
      check_package: ["包裹", "快遞", "取件", "宅配", "寄件", "貨到了"],
      post_lost: ["遺失", "掉了", "不見了", "弄丟", "丟了"],
      search_found: ["拾獲", "撿到", "找到東西"],
      print_file: ["列印", "印報告", "印作業", "印文件"],
      check_print_balance: ["列印餘額", "影印卡", "列印額度"],
      request_leave: ["請假", "病假", "事假", "公假", "喪假"],
      check_grades: ["查成績", "看成績", "成績查詢"],
      check_assignments: ["查作業", "作業截止", "繳交期限"],
      check_bus: ["公車", "公車到站", "幾號公車", "搭車"],
      set_reminder: ["提醒", "提醒我", "鬧鐘", "別忘了", "記得"],
      send_message: ["發訊息", "傳訊息", "通知同學", "通知老師", "傳給"],
    };

    // Score each tool: keyword match + domain alignment bonus
    let bestTool: AgentTool | null = null;
    let bestScore = 0;

    for (const [toolId, keywords] of Object.entries(toolKeywords)) {
      const hits = keywords.filter(k => msg.includes(k)).length;
      if (hits === 0) continue;

      const allowedDomains = domainToolMap[toolId] ?? [];
      const domainMatch = allowedDomains.includes(domain) || domain === "general";
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

  // ═══════════════════════════════════════════════════
  // Smart Response Engine v2 — Knowledge-Driven
  // ═══════════════════════════════════════════════════
  // Uses ALL app data + memory to generate accurate contextual answers

  function generateSmartResponse(msg: string, domain: IntentDomain): Message | null {
    const lowerMsg = msg.toLowerCase();
    const uid = () => genMsgId();

    // ★ 防護：用 try/catch 包裝整個函數，避免任何 undefined 崩潰
    try {

    // ── 學業核心：被當 / 不及格 / 課程風險分析 ──
    if (/被當|當掉|不及格|會不會過|能不能過|及格|二一|退學|延畢|重修/.test(lowerMsg)) {
      if ((courses ?? []).length === 0) {
        return { id: uid(), role: "assistant", content: "目前沒有載入你的課程資料，無法進行分析。\n\n請先到設定中同步你的課表和成績資料，我才能幫你評估課程風險。", timestamp: new Date(), agentType: "text", suggestions: ["同步課表", "查成績"] };
      }
      const lateAssignments = pendingAssignments.filter(a => a.isLate);
      const totalAssignments = pendingAssignments.length;
      const courseList = courses.map((c, i) => `${i + 1}. ${c.name}（${c.teacher}，${c.credits} 學分）`).join("\n");

      let riskAnalysis = `你本學期共修 ${courses.length} 門課：\n\n${courseList}\n\n`;

      if (lateAssignments.length > 0) {
        riskAnalysis += `⚠️ 注意：你有 ${lateAssignments.length} 份逾期作業：\n`;
        riskAnalysis += lateAssignments.map(a => `  - ${a.title}（${a.groupName}）`).join("\n");
        riskAnalysis += `\n\n逾期作業會嚴重影響平時成績，建議盡快補交。\n`;
      } else if (totalAssignments > 0) {
        riskAnalysis += `目前有 ${totalAssignments} 份待繳作業，都還沒逾期，繼續保持！\n`;
      }

      riskAnalysis += "\n💡 提醒：被當的主要因素是出席率不足、作業未交、期中期末考表現差。\n建議定期檢查作業截止日、維持出席，有問題及早和老師溝通。";

      // Use memory to personalize
      const memoryFacts = agentMemory.learnedFacts.filter(f => f.category === "academic");
      if (memoryFacts.length > 0) {
        riskAnalysis += "\n\n根據之前的對話，我記得：" + memoryFacts.slice(0, 3).map(f => f.fact).join("、");
      }

      return {
        id: uid(), role: "assistant", content: riskAnalysis, timestamp: new Date(), agentType: "text",
        actions: [
          { label: "查看作業截止", action: "navigate", params: { screen: "Today", nested: "作業列表" } },
          { label: "查看成績", action: "navigate", params: { screen: "我的", nested: "GradesStack" } },
        ],
        suggestions: ["哪些作業快截止", "幫我請假", "設定作業提醒"],
      };
    }

    // ── 課程查詢（多種問法）──
    if (/課程|哪些課|修了|幾門課|本學期/.test(lowerMsg) && domain === "academic") {
      if (courses.length === 0) {
        return { id: uid(), role: "assistant", content: "目前沒有課程資料。請先同步你的課表！", timestamp: new Date(), agentType: "text" };
      }
      const totalCredits = courses.reduce((sum, c) => sum + (c.credits || 0), 0);
      const coursesByDay: Record<number, typeof courses> = {};
      courses.forEach(c => {
        if (!coursesByDay[c.dayOfWeek]) coursesByDay[c.dayOfWeek] = [];
        coursesByDay[c.dayOfWeek].push(c);
      });
      const dayNames = ["日", "一", "二", "三", "四", "五", "六"];
      let schedule = "";
      for (let d = 1; d <= 5; d++) {
        const dayCourses = coursesByDay[d];
        if (dayCourses && dayCourses.length > 0) {
          schedule += `週${dayNames[d]}：${dayCourses.map(c => c.name).join("、")}\n`;
        }
      }
      return {
        id: uid(), role: "assistant",
        content: `本學期共 ${courses.length} 門課（${totalCredits} 學分）：\n\n${schedule}\n要查看詳細課表或各科成績嗎？`,
        timestamp: new Date(), agentType: "text",
        actions: [{ label: "前往課表", action: "navigate", params: { screen: "Today", nested: "課表" } }],
        suggestions: ["今天有什麼課", "查成績", "哪些課可能被當"],
      };
    }

    // ── 畢業 / 學分相關 ──
    if (/畢業|學分|選課|修了多少/.test(lowerMsg)) {
      const totalCredits = courses.reduce((sum, c) => sum + (c.credits || 0), 0);
      const requiredCredits = 128;
      const remaining = Math.max(0, requiredCredits - totalCredits);
      const semestersLeft = remaining > 0 ? Math.ceil(remaining / 20) : 0;
      return {
        id: uid(), role: "assistant",
        content: `根據你目前的修課紀錄：\n\n已修學分：${totalCredits} 學分\n畢業門檻：${requiredCredits} 學分\n尚缺：${remaining} 學分\n\n本學期修 ${courses.length} 門課（共 ${totalCredits} 學分）。\n${remaining > 0 ? `預估還需約 ${semestersLeft} 個學期可畢業。` : "恭喜！學分已達標！"}\n\n要查看詳細的學分試算嗎？`,
        timestamp: new Date(), agentType: "text",
        actions: [{ label: "前往學分試算", action: "navigate", params: { screen: "我的", nested: "CreditAuditStack" } }],
        suggestions: ["查成績", "查未繳作業", "選課建議"],
      };
    }

    // ── 作業 / 截止日 ──
    if (/作業|截止|期限|繳交|deadline|死線/.test(lowerMsg) && domain === "academic") {
      if (pendingAssignments.length === 0) {
        return { id: uid(), role: "assistant", content: "目前沒有查到待繳的作業資料。\n\n如果確定有作業，可能需要老師在系統上發布。", timestamp: new Date(), agentType: "text" };
      }
      const sorted = [...pendingAssignments].sort((a, b) => {
        if (a.isLate && !b.isLate) return -1;
        if (!a.isLate && b.isLate) return 1;
        return 0;
      });
      const list = sorted.map((a, i) => `${i + 1}. ${a.isLate ? "🔴" : "🟢"} ${a.title}（${a.groupName}）${a.dueAt ? ` — 截止 ${a.dueAt}` : ""}${a.isLate ? " ⚠️已逾期" : ""}`).join("\n");
      return {
        id: uid(), role: "assistant",
        content: `你有 ${pendingAssignments.length} 份待處理作業：\n\n${list}${sorted.some(a => a.isLate) ? "\n\n⚠️ 有逾期的作業，建議盡快處理！" : ""}`,
        timestamp: new Date(), agentType: "text",
        suggestions: ["設定截止提醒", "哪些可能被當", "幫我請假"],
      };
    }

    // ── 成績查詢 ──
    if (/成績|分數|GPA|排名/.test(lowerMsg)) {
      return {
        id: uid(), role: "assistant",
        content: "成績資料需要從教務系統即時查詢才能確保正確。\n\n要前往成績查詢頁面嗎？",
        timestamp: new Date(), agentType: "text",
        actions: [{ label: "前往成績查詢", action: "navigate", params: { screen: "我的", nested: "GradesStack" } }],
        suggestions: ["哪些課可能被當", "查學分", "查作業"],
      };
    }

    // ── 公告 ──
    if (/公告|消息|最新通知|學校公告/.test(lowerMsg)) {
      const recent = (announcements as any[]).slice(0, 3);
      if (recent.length === 0) {
        return { id: uid(), role: "assistant", content: "目前沒有新的公告。稍後再看看吧！", timestamp: new Date(), agentType: "text" };
      }
      const list = recent.map((a: any, i: number) => `${i + 1}. ${a.title}`).join("\n");
      return {
        id: uid(), role: "assistant",
        content: `最近有 ${announcements.length} 則公告：\n\n${list}\n\n想看哪一則的詳情？`,
        timestamp: new Date(), agentType: "text",
        actions: recent.map((a: any) => ({ label: `查看「${String(a.title).slice(0, 10)}…」`, action: "navigate", params: { screen: "Today", nested: "公告詳情", id: a.id } })),
      };
    }

    // ── 活動 ──
    if (/活動|報名|參加|社團/.test(lowerMsg) && domain === "admin") {
      const upcoming = (events as any[]).filter((e: any) => { const s = toDate(e.startsAt); return s ? s > new Date() : false; }).slice(0, 3);
      if (upcoming.length === 0) {
        return { id: uid(), role: "assistant", content: "近期沒有即將舉辦的活動。有新活動我會通知你！", timestamp: new Date(), agentType: "text", suggestions: ["查公告", "推薦午餐"] };
      }
      const list = upcoming.map((e: any, i: number) => `${i + 1}. ${e.title}${e.location ? ` (${e.location})` : ""}`).join("\n");
      return {
        id: uid(), role: "assistant",
        content: `近期有 ${upcoming.length} 個活動：\n\n${list}\n\n想報名哪一個？`,
        timestamp: new Date(), agentType: "text",
        actions: upcoming.map((e: any) => ({ label: `報名「${String(e.title).slice(0, 8)}…」`, action: "navigate", params: { screen: "Today", nested: "活動詳情", id: e.id } })),
      };
    }

    // ── 地點 / 導航 ──
    if (/在哪|怎麼走|地點|導航|地圖|位置|路線/.test(lowerMsg)) {
      const locationKeywords = ["圖書館", "餐廳", "行政", "體育", "宿舍", "教室", "停車", "校門", "操場", "醫務"];
      let keyword = locationKeywords.find(k => lowerMsg.includes(k)) ?? "";
      const matches = keyword ? (pois as any[]).filter((p: any) => p.name.includes(keyword) || p.category.includes(keyword)) : (pois as any[]).slice(0, 3);
      if (matches.length === 0) {
        return { id: uid(), role: "assistant", content: "找不到這個地點，你可以直接去校園地圖搜尋！", timestamp: new Date(), agentType: "text", actions: [{ label: "開啟地圖", action: "navigate", params: { screen: "校園" } }] };
      }
      const poi = matches[0];
      return {
        id: uid(), role: "assistant",
        content: `找到了！「${poi.name}」位於 ${poi.category} 區域。\n\n要開啟導航嗎？`,
        timestamp: new Date(), agentType: "text",
        actions: [
          { label: "查看詳情", action: "navigate", params: { screen: "校園", nested: "PoiDetail", id: poi.id } },
          { label: "開始導航", action: "navigate", params: { screen: "校園", nested: "PoiDetail", id: poi.id } },
        ],
      };
    }

    // ── 課表 / 今天有什麼課 ──
    if (/課表|今天有什麼課|明天有什麼課|上什麼課/.test(lowerMsg)) {
      if (courses.length === 0) {
        return { id: uid(), role: "assistant", content: "目前沒有載入課程資料。你可以到設定中同步課表！", timestamp: new Date(), agentType: "text" };
      }
      const isAskingTomorrow = lowerMsg.includes("明天");
      const targetDay = isAskingTomorrow ? (new Date().getDay() + 1) % 7 : new Date().getDay();
      const dayLabel = isAskingTomorrow ? "明天" : "今天";
      const dayCourses = courses.filter(c => c.dayOfWeek === targetDay);
      if (dayCourses.length === 0) {
        return { id: uid(), role: "assistant", content: `${dayLabel}沒有課喔！本學期共 ${courses.length} 門課。\n\n要我幫你安排其他事嗎？`, timestamp: new Date(), agentType: "text", suggestions: ["推薦午餐", "預約圖書館", "查作業截止"] };
      }
      const list = dayCourses.map((c, i) => `${i + 1}. ${c.name}（${c.teacher}）`).join("\n");
      return { id: uid(), role: "assistant", content: `${dayLabel}有 ${dayCourses.length} 堂課：\n\n${list}`, timestamp: new Date(), agentType: "text", suggestions: ["幫我請假", "設定上課提醒"] };
    }

    // ── 餐飲推薦（用 domain guard 確保只在 dining context）──
    if (domain === "dining" && /推薦|吃什麼|有什麼好吃|想吃|蔬菜|素食|便宜|健康|有哪些|午餐|晚餐|早餐|覓食|好餓|肚子餓/.test(lowerMsg)) {
      const menuItems = menus as any[];
      if (menuItems.length === 0) {
        // ── 靜宜大學校園餐廳硬編碼資料（即使 Firebase 無資料也能推薦）──
        const now = new Date();
        const hour = now.getHours();
        const mealTime = hour < 10 ? "早餐" : hour < 14 ? "午餐" : hour < 17 ? "下午茶" : "晚餐";
        const wantsVeg = /素|蔬菜|沙拉|健康|清淡/.test(lowerMsg);
        const wantsCheap = /便宜|划算|省|CP/.test(lowerMsg);

        const campusDining = [
          { name: "濟時樓學生餐廳", location: "濟時樓 1F", hours: "07:00-19:30", highlights: ["自助餐 $55起", "滷肉飯 $40", "雞腿飯 $65", "排骨飯 $60", "素食便當 $50"], cheap: true, hasVeg: true },
          { name: "伯鐸樓美食街", location: "伯鐸樓 B1", hours: "10:30-19:00", highlights: ["牛肉麵 $75", "鍋燒麵 $60", "咖哩飯 $65", "韓式拌飯 $70"], cheap: true, hasVeg: false },
          { name: "思源樓輕食區", location: "思源樓 1F", hours: "08:00-17:00", highlights: ["三明治 $35", "飯糰 $30", "沙拉 $50", "果汁 $40"], cheap: true, hasVeg: true },
          { name: "主顧咖啡", location: "主顧樓 1F", hours: "08:30-18:00", highlights: ["拿鐵 $55", "鬆餅 $60", "輕食套餐 $85"], cheap: false, hasVeg: true },
          { name: "全家便利商店", location: "濟時樓 1F", hours: "07:00-22:00", highlights: ["微波便當 $65", "御飯糰 $28", "沙拉 $49"], cheap: true, hasVeg: true },
          { name: "校門口周邊", location: "大門口沙鹿區", hours: "各店不同", highlights: ["沙鹿肉圓 $40", "米糕 $35", "豆花 $30", "鹹酥雞 $50"], cheap: true, hasVeg: false },
        ];

        let recommendations = campusDining;
        if (wantsVeg) recommendations = recommendations.filter(r => r.hasVeg);
        if (wantsCheap) recommendations = recommendations.filter(r => r.cheap);

        // 隨機挑選 3 間推薦
        const shuffled = [...recommendations].sort(() => Math.random() - 0.5);
        const top3 = shuffled.slice(0, 3);

        let response = `現在是${mealTime}時段，幫你推薦幾個校園用餐好選擇：\n\n`;
        top3.forEach((r, i) => {
          response += `${i + 1}. **${r.name}**（${r.location}）\n`;
          response += `   營業時間：${r.hours}\n`;
          response += `   推薦：${r.highlights.slice(0, 3).join("、")}\n\n`;
        });

        if (wantsVeg) response += "以上都有素食選項喔！";
        else if (wantsCheap) response += "以上都是平價選擇，學生荷包友善！";
        else response += "想知道更多細節或有特別想吃的類型，都可以跟我說！";

        return {
          id: uid(), role: "assistant", content: response, timestamp: new Date(), agentType: "text",
          actions: [{ label: "查看校園餐廳", action: "navigate", params: { screen: "Explore", nested: "DiningStack" } }],
          suggestions: ["有素食嗎", "最便宜的", "不想吃飯想吃麵", "校門口有什麼"],
        };
      }
      // Filter by dietary preference if mentioned
      let filtered = menuItems;
      let filterDesc = "";
      if (lowerMsg.includes("素食") || lowerMsg.includes("蔬菜")) { filtered = menuItems.filter((m: any) => /素|蔬|菜/.test(m.name ?? "")); filterDesc = "素食/蔬菜"; }
      else if (lowerMsg.includes("便宜")) { filtered = [...menuItems].sort((a: any, b: any) => (a.price ?? 999) - (b.price ?? 999)); filterDesc = "平價"; }
      if (filtered.length === 0) filtered = menuItems;

      // Use memory for preferences
      const dietFacts = agentMemory.learnedFacts.filter(f => f.category === "dietary");
      let memoryNote = "";
      if (dietFacts.length > 0) {
        memoryNote = `\n\n🧠 我記得你的偏好：${dietFacts.map(f => f.fact).join("、")}`;
      }

      const top = filtered.slice(0, 5);
      const list = top.map((m: any, i: number) => `${i + 1}. ${m.name ?? "未命名"} $${m.price ?? "?"} (${m.cafeteria ?? "校園餐廳"})`).join("\n");
      return {
        id: uid(), role: "assistant",
        content: `${filterDesc ? `為你找到${filterDesc}選項` : "今天推薦"}：\n\n${list}${memoryNote}\n\n想直接訂哪一道？告訴我編號就好！`,
        timestamp: new Date(), agentType: "text",
        suggestions: ["幫我訂第1道", "還有其他選擇嗎", "便宜一點的"],
      };
    }

    // ── 天氣 ──
    if (domain === "weather") {
      const month = new Date().getMonth() + 1;
      const seasonInfo = month >= 6 && month <= 9 ? "夏季氣候偏熱，午後容易有雷陣雨，建議攜帶雨具" :
        month >= 10 && month <= 12 ? "秋冬季節早晚溫差較大，建議帶件外套" :
        month >= 3 && month <= 5 ? "春季天氣多變，建議留意氣象預報" :
        "冬季偏涼，請注意保暖";
      return {
        id: uid(), role: "assistant",
        content: `靜宜大學位於台中沙鹿，${seasonInfo}。\n\n⚠️ 即時天氣資訊請查看氣象 APP 或中央氣象署網站以獲得最準確的預報。`,
        timestamp: new Date(), agentType: "text",
        suggestions: ["查公車", "推薦午餐"],
      };
    }

    // ── 交通 / 公車 ──
    if (domain === "transport") {
      return {
        id: uid(), role: "assistant",
        content: "靜宜大學主要公車路線：\n\n• 300/307/308：往台中車站方向\n• 304：往清水方向\n• 統聯：往高鐵台中站\n\n⚠️ 即時到站資訊請查看「台中公車」APP 以獲得最準確的時間。\n\n要開啟校園地圖查看公車站位置嗎？",
        timestamp: new Date(), agentType: "text",
        actions: [{ label: "查看公車站位置", action: "navigate", params: { screen: "校園" } }],
        suggestions: ["校門在哪", "怎麼去台中車站"],
      };
    }

    // ── 功能介紹 / 幫助 ──
    if (domain === "help") {
      const caps = getAgentCapabilitySummary(userRole);
      return {
        id: uid(), role: "assistant",
        content: `我是你的校園全能 AI 助理，可以直接幫你完成操作：\n\n${caps.join("\n")}\n\n不只是回答問題，我能直接幫你訂餐、掛號、報修、請假！\n試試說「幫我訂午餐」或「我想請假」。`,
        timestamp: new Date(), agentType: "text",
        suggestions: ["幫我訂午餐", "我頭有點痛", "幫我查成績"],
      };
    }

    // ── 打招呼 ──
    if (domain === "greeting" && lowerMsg.length < 10) {
      const hour = new Date().getHours();
      const timeGreet = hour < 12 ? "早安" : hour < 18 ? "午安" : "晚安";
      const name = auth.profile?.displayName?.split(" ")[0] ?? "同學";
      // Use memory to personalize
      const recentTopics = agentMemory.recentActions.slice(-3);
      let personalized = "";
      if (recentTopics.length > 0) {
        personalized = "\n\n上次我們聊到了一些事，需要繼續處理嗎？";
      }
      return {
        id: uid(), role: "assistant",
        content: `${timeGreet}，${name}！有什麼我可以幫你的嗎？${personalized}`,
        timestamp: new Date(), agentType: "text",
        suggestions: ["幫我推薦午餐", "查作業截止", "今天有什麼課"],
      };
    }

    // ── 感謝 ──
    if (domain === "thanks") {
      return { id: uid(), role: "assistant", content: "不客氣！有需要隨時叫我 😊", timestamp: new Date(), agentType: "text" };
    }

    // ── 知識圖譜推理：嘗試從所有 APP 資料中找到相關資訊 ──
    if (knowledgeGraph.length > 0 && lowerMsg.length >= 4) {
      const kgResult = queryKnowledgeGraph(knowledgeGraph, lowerMsg);
      if (kgResult.relevantNodes.length > 0) {
        const grouped: Record<string, string[]> = {};
        kgResult.relevantNodes.forEach(node => {
          const typeLabel = node.type === "course" ? "課程" : node.type === "assignment" ? "作業" :
            node.type === "menu" ? "餐點" : node.type === "preference" ? "你的偏好" :
            node.type === "event" ? "活動" : node.type === "poi" ? "地點" : "相關";
          if (!grouped[typeLabel]) grouped[typeLabel] = [];
          grouped[typeLabel].push(node.label);
        });
        const summary = Object.entries(grouped)
          .map(([type, items]) => `${type}：${items.slice(0, 3).join("、")}${items.length > 3 ? ` 等 ${items.length} 項` : ""}`)
          .join("\n");
        return {
          id: uid(), role: "assistant",
          content: `根據 APP 中的資料，我找到以下可能相關的內容：\n\n${summary}\n\n需要我進一步查詢哪個方面嗎？`,
          timestamp: new Date(), agentType: "text",
          suggestions: Object.keys(grouped).slice(0, 3).map(t => `查看${t}詳情`),
        };
      }
    }

    return null; // No local match → fall through to AI service

    } catch (smartErr) {
      console.warn("[AIChat] generateSmartResponse error:", smartErr);
      return null; // 出錯就跳過本地回答，讓 AI 引擎或 Gemini 接手
    }
  }

  // ── Start Tool Execution (with param collection) ──
  function startToolExecution(tool: AgentTool, userMessage: string) {
    const autoParams = extractParamsFromMessage(tool, userMessage);
    const requiredMissing = tool.parameters.filter(p => p.required && !(p.name in autoParams));

    if (requiredMissing.length > 0) {
      // Need to collect params
      const nextParam = requiredMissing[0];
      setAgentContext(prev => ({
        ...prev,
        state: "collecting_params",
        currentTool: tool.id,
        collectedParams: autoParams,
      }));

      const collectMsg: Message = {
        id: genMsgId(),
        role: "assistant",
        content: `好的，我來幫你${tool.name}！需要一些資訊：`,
        timestamp: new Date(),
        agentType: "param_collect",
        paramCollect: { tool, collected: autoParams, nextParam },
      };
      return collectMsg;
    }

    // All params ready — confirm or execute directly
    if (tool.requiresConfirmation) {
      return createConfirmMessage(tool, autoParams);
    } else {
      return executeToolImmediately(tool, autoParams);
    }
  }

  function extractParamsFromMessage(tool: AgentTool, msg: string): Record<string, any> {
    const params: Record<string, any> = {};
    // Smart extraction based on tool type
    if (tool.id === "order_meal" || tool.id === "recommend_meal") {
      // Extract cafeteria
      if (msg.includes("學生餐廳") || msg.includes("濟時")) params.cafeteria = "main_cafeteria";
      if (msg.includes("教職員")) params.cafeteria = "faculty_dining";
      if (msg.includes("便利商店")) params.cafeteria = "convenience";
      // Extract food items
      const foodPatterns = ["排骨飯", "滷肉飯", "雞腿飯", "牛肉麵", "便當", "飯糰"];
      for (const fp of foodPatterns) {
        if (msg.includes(fp)) { params.items = fp; break; }
      }
      // Budget
      const budgetMatch = msg.match(/(\d+)\s*元/);
      if (budgetMatch) params.budget = parseInt(budgetMatch[1]);
    }
    if (tool.id === "book_health") {
      if (msg.includes("諮商") || msg.includes("心理")) params.department = "mental";
      if (msg.includes("牙") || msg.includes("牙齒")) params.department = "dental";
      if (msg.includes("運動傷害")) params.department = "sports_injury";
    }
    if (tool.id === "request_leave") {
      if (msg.includes("病假")) params.reason = "sick";
      if (msg.includes("事假")) params.reason = "personal";
      // Try to extract course name from user's courses
      for (const c of courses) {
        if (msg.includes(c.name)) { params.course = c.name; break; }
      }
    }
    if (tool.id === "report_repair") {
      if (msg.includes("冷氣") || msg.includes("空調")) params.category = "ac";
      if (msg.includes("水管") || msg.includes("馬桶")) params.category = "plumbing";
      if (msg.includes("電") || msg.includes("燈")) params.category = "electrical";
      if (msg.includes("網路")) params.category = "network";
    }
    if (tool.id === "reserve_seat") {
      if (msg.includes("討論室") || msg.includes("團體")) params.type = "group_room";
      else if (msg.includes("安靜")) params.type = "quiet_zone";
      else params.type = "individual";
    }
    if (tool.id === "set_reminder") {
      // Extract reminder content
      const afterRemind = msg.match(/提醒[我]?(.+)/);
      if (afterRemind) params.title = afterRemind[1].trim();
    }
    if (tool.id === "symptom_check") {
      params.symptoms = msg;
    }
    if (tool.id === "search_found" || tool.id === "search_book") {
      params.keyword = msg.replace(/搜尋|查詢|找|借/g, "").trim();
      params.query = params.keyword;
    }
    return params;
  }

  function createConfirmMessage(tool: AgentTool, params: Record<string, any>): Message {
    const execId = genMsgId("exec");
    const execution: ToolExecution = {
      id: execId,
      toolId: tool.id,
      status: "confirming",
      params,
      startedAt: new Date().toISOString(),
      confirmationMessage: `確認要${tool.name}嗎？`,
    };
    setAgentContext(prev => ({
      ...prev,
      state: "confirming",
      currentTool: tool.id,
      collectedParams: params,
      pendingConfirmation: execId,
    }));
    return {
      id: genMsgId(),
      role: "assistant",
      content: `我已準備好幫你${tool.name}，請確認以下內容：`,
      timestamp: new Date(),
      agentType: "tool_confirm",
      toolExecution: execution,
    };
  }

  function executeToolImmediately(tool: AgentTool, params: Record<string, any>): Message {
    // Simulate immediate execution
    const execId = genMsgId("exec");
    const result = simulateToolResult(tool, params);
    const execution: ToolExecution = {
      id: execId,
      toolId: tool.id,
      status: "success",
      params,
      result,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    setRecentExecutions(prev => [execution, ...prev].slice(0, 5));
    setAgentContext(prev => ({ ...prev, state: "reporting", currentTool: undefined }));
    return {
      id: genMsgId(),
      role: "assistant",
      content: "",
      timestamp: new Date(),
      agentType: "tool_result",
      toolExecution: execution,
      suggestions: tool.relatedTools
        ? tool.relatedTools.slice(0, 2).map(rid => {
            const rt = getToolById(rid);
            return rt ? `幫我${rt.name}` : "";
          }).filter(Boolean)
        : undefined,
    };
  }

  function simulateToolResult(tool: AgentTool, params: Record<string, any>): string {
    switch (tool.id) {
      case "order_meal": return `已成功下單！取餐號碼 A-${Math.floor(Math.random() * 100).toString().padStart(3, "0")}，預計 ${new Date(Date.now() + 20 * 60000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} 可取餐。\n餐點：${params.items || "每日精選"}\n餐廳：${params.cafeteria === "main_cafeteria" ? "學生餐廳（濟時樓）" : "校園餐廳"}`;
      case "recommend_meal": {
        // 使用真實菜單資料
        const menuData = menus as any[];
        if (menuData.length === 0) {
          // 硬編碼校園餐廳推薦（不再回傳無用的「沒有資料」）
          const hour = new Date().getHours();
          const mealLabel = hour < 10 ? "早餐" : hour < 14 ? "午餐" : "晚餐";
          const fallbackRecs = [
            "濟時樓學生餐廳 — 自助餐 $55起、滷肉飯 $40、排骨飯 $60",
            "伯鐸樓美食街 — 牛肉麵 $75、鍋燒麵 $60、咖哩飯 $65",
            "思源樓輕食區 — 三明治 $35、飯糰 $30、沙拉 $50",
          ];
          return `推薦你${mealLabel}可以去：\n\n${fallbackRecs.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n想知道更多選擇可以到校園餐廳頁面查看！`;
        }
        const wantsVeg = /素|蔬菜|菜|沙拉|健康|清淡/.test(JSON.stringify(params));
        const wantsCheap = /便宜|划算|省/.test(JSON.stringify(params));
        let filtered = menuData;
        if (wantsVeg) filtered = menuData.filter((m: any) => /素|蔬|菜|沙拉/.test(m.name ?? ""));
        else if (wantsCheap) filtered = [...menuData].sort((a: any, b: any) => (a.price ?? 999) - (b.price ?? 999));
        if (filtered.length === 0) filtered = menuData;
        const top = filtered.slice(0, 5);
        const recs = top.map((m: any, i: number) => `${i + 1}. ${m.name ?? "餐點"} $${m.price ?? "?"} (${m.cafeteria ?? "校園餐廳"})`);
        return `根據你的偏好，今天推薦：\n\n${recs.join("\n")}\n\n想直接訂哪一道？告訴我編號就好！`;
      }
      case "check_wait_time": return "目前等候時間：\n學生餐廳（濟時樓）：約 8 分鐘\n教職員餐廳：約 3 分鐘\n便利商店：無需等候";
      case "book_health": return `已預約成功！\n科別：${params.department === "mental" ? "心理諮商" : params.department === "dental" ? "牙科" : "一般門診"}\n時間：${params.date || "明天"} 上午 10:00\n地點：衛保組 2F\n\n請記得攜帶學生證。`;
      case "symptom_check": return `根據你的描述分析：\n\n症狀嚴重度：輕度\n建議：多休息、補充水分\n如果持續超過 2 天，建議到衛保組就診。\n\n需要我幫你預約掛號嗎？`;
      case "record_mood": return `已記錄今天的心情！\n情緒：${params.level === "5" ? "很好" : params.level === "4" ? "不錯" : params.level === "3" ? "普通" : "需關注"}\n\n本週心情趨勢：穩定偏好 📈\n連續記錄 ${Math.floor(Math.random() * 10) + 3} 天！`;
      case "reserve_seat": return `已預約成功！\n類型：${params.type === "group_room" ? "團體討論室 B" : params.type === "quiet_zone" ? "安靜閱覽區" : "個人自習座位 A-23"}\n樓層：${params.floor || "3F"}\n時段：${params.time_slot === "morning" ? "上午" : params.time_slot === "evening" ? "晚上" : "下午"}\n\n請於預約時段開始 15 分鐘內入座。`;
      case "search_book": return `查詢結果：\n\n1.「${params.query || "程式設計"}」— 館藏 3 本，可借 2 本\n   位置：2F 書庫 005.1 區\n\n2. 相關推薦：「資料結構與演算法」— 可借\n\n需要我幫你預約借閱嗎？`;
      case "report_repair": return `維修單已提交！\n\n工單編號：RP-${Date.now().toString().slice(-6)}\n類別：${params.category === "ac" ? "冷氣/暖氣" : params.category === "plumbing" ? "水管/馬桶" : "設施維修"}\n房號：${params.room || "未指定"}\n預計處理時間：1-3 個工作天\n\n我會在維修完成時通知你。`;
      case "check_laundry": return "洗衣機使用狀態：\n\n希嘉學苑：\n  1號 — 使用中（剩餘 23 分鐘）\n  2號 — 空閒 ✅\n  3號 — 空閒 ✅\n\n思高學苑：\n  1號 — 使用中（剩餘 41 分鐘）\n  2號 — 空閒 ✅";
      case "check_package": return "你有 1 個待領包裹！\n\n黑貓宅急便，4/26 送達\n存放位置：宿舍管理室\n\n請攜帶學生證前往領取（開放時間 8:00-21:00）。";
      case "post_lost": return `遺失公告已發布！\n\n物品：${params.item || "物品"}\n地點：${params.location || "校園"}\n\nAI 正在自動比對拾獲物資料庫...\n目前找到 ${Math.random() > 0.5 ? "1" : "0"} 筆可能的配對。`;
      case "request_leave": return `請假申請已提交！\n\n課程：${params.course || "課程"}\n假別：${params.reason === "sick" ? "病假" : "事假"}\n日期：${params.date || "今天"}\n\n狀態：待教師審核\n我會在教師回覆後通知你。`;
      case "check_grades": return "成績資料需要從教務系統即時查詢才能確保正確。\n\n正在前往成績查詢頁面...";
      case "check_assignments": {
        const _pa = pendingAssignments ?? [];
        if (_pa.length === 0) return "目前沒有查到待繳的作業資料。\n\n如有作業，請確認老師已在系統上發布。";
        const list = _pa.map((a, i) => `${i + 1}. ${a.isLate ? "🔴" : "🟢"} ${a.title}（${a.groupName ?? ""}）${a.dueAt ? ` — 截止 ${new Date(a.dueAt.seconds * 1000).toLocaleDateString("zh-TW")}` : ""}${a.isLate ? " ⚠️已逾期" : ""}`).join("\n");
        return `你有 ${_pa.length} 份待處理作業：\n\n${list}\n\n需要我設定提醒嗎？`;
      }
      case "check_bus": return "靜宜大學主要公車路線：\n\n• 300/307/308：往台中車站方向\n• 304：往清水方向\n• 統聯：往高鐵台中站\n\n⚠️ 即時到站時間請查看「台中公車」APP。";
      case "set_reminder": return `已設定提醒！\n\n內容：${params.title || "提醒"}\n時間：${params.datetime || "稍後"}\n\n到時間會推播通知你 🔔`;
      case "check_print_balance": return "列印餘額需要登入影印系統才能查詢。\n\n可至圖書館 1F 儲值機查看餘額及加值。";
      case "send_message": return `訊息已發送！\n\n收件人：${params.recipient || "群組"}\n內容：${params.content || "（訊息內容）"}\n\n狀態：已送達 ✓`;

      // ── 同儕互動工具 ──
      case "peer_review": return `互評分配完成！\n\n作業：${params.assignment || "作業"}\n每人需評 3 份同儕作業\n評分標準：${params.criteria || "完整度、邏輯性、創意度"}\n\n截止時間：原作業截止後 3 天\n已通知所有參與的同學。`;
      case "study_group_match": {
        const purpose = params.purpose === "study" ? "讀書會" : params.purpose === "project" ? "專題組員" : params.purpose === "exam_prep" ? "考前衝刺" : "課業輔導";
        return `AI 配對完成！\n\n目的：${purpose}${params.course ? `\n課程：${params.course}` : ""}\n\n已找到 ${params.group_size || "3"} 位合適的同學：\n1. 王○明（同課程，作業完成率高）\n2. 李○華（上學期修過，成績優秀）\n3. 陳○文（擅長整理筆記）\n\n要我發送邀約訊息嗎？`;
      }
      case "share_notes": return `筆記已分享至群組！\n\n課程：${params.course || "課程"}\n主題：${params.topic || "最新章節"}\n\nAI 已自動整理重點標記，群組內 ${Math.floor(Math.random() * 10) + 5} 位同學可以看到。`;
      case "group_order": return `揪團已建立！\n\n餐廳：${params.cafeteria === "main" ? "學生餐廳" : "校園餐廳"}\n目前成員：3 人\n\n等待其他人選餐中...\n已發送邀請至「${params.group || "午餐揪團"}」群組。\n\n所有人選好後 AI 會自動合併下單並計算分攤金額。`;
      case "tutoring_request": return `課業求助已送出！\n\n科目：${params.subject || "課程"}\n急迫度：${params.urgency === "high" ? "🔴 明天要交" : params.urgency === "medium" ? "🟡 這週內" : "🟢 不急"}\n\nAI 已在校內尋找合適的輔導人選...\n找到 2 位可能的學長姐，已發送配對請求。`;
      case "event_invite": return `活動邀約已發送！\n\n活動：${params.event || "活動"}\n已邀請：${params.friends || "好友們"}\n\n等待回覆中... 已有 1 人確認參加。`;
      case "carpool_match": return `共乘配對搜尋中...\n\n方向：${params.direction === "to_school" ? "到學校" : "回家"}\n時間：${params.time || "明天早上"}\n\n找到 1 位順路的同學！\n已發送共乘邀約，對方確認後會通知你。`;
      case "secondhand_trade": return `${params.action === "sell" ? "二手物品已上架" : "購買需求已登記"}！\n\n物品：${params.item || "物品"}\n${params.price ? `期望價格：$${params.price}` : ""}\n\nAI 正在比對${params.action === "sell" ? "潛在買家" : "賣家"}...\n${Math.random() > 0.5 ? "找到 1 位有興趣的同學，已通知對方！" : "目前還沒有配對，有新配對時會通知你。"}`;
      case "assignment_publish": return `作業已發布！\n\n課程：${params.course || "課程"}\n標題：${params.title || "作業"}\n截止日：${params.deadline || "下週"}\n\n已通知全班 ${Math.floor(Math.random() * 20) + 25} 位學生。`;
      case "peer_review_assign": return `互評配對完成！\n\n作業：${params.assignment || "作業"}\n每人需評：${params.reviews_per_student || "3"} 份\n分配方式：AI 隨機配對（確保匿名且公平）\n\n已通知所有學生開始互評。`;
      case "attendance_alert": return `出席警示已發送！\n\n課程：${params.course || "課程"}\n門檻：缺曠 ${params.threshold || "3"} 次\n\n偵測到 ${Math.floor(Math.random() * 3) + 1} 位學生達到警示標準\n已分別發送提醒，並通知導師。`;
      case "learning_insight": return `全班學習分析報告已生成！\n\n課程：${params.course || "課程"}\n\n📊 關鍵數據：\n• 平均作業���成率：${Math.floor(Math.random() * 15) + 80}%\n• 需要關注的學生：${Math.floor(Math.random() * 3) + 1} 位\n• 最常見困難：期中範圍第 3-4 章\n\n已產生個別化建議，可分別發送給學生。`;

      default: return `${tool.name} 執行完成！`;
    }
  }

  // ── Task Chain Execution ──
  function startTaskChain(chain: TaskChain, userMessage: string) {
    setAgentContext(prev => ({
      ...prev,
      state: "executing",
      currentChain: chain.id,
      currentChainStep: 1,
      collectedParams: {},
    }));

    const progressMsg: Message = {
      id: genMsgId(),
      role: "assistant",
      content: `好的，我啟動「${chain.name}」流程，共 ${chain.steps.length} 個步驟：`,
      timestamp: new Date(),
      agentType: "chain_progress",
      chainProgress: { chain, currentStep: 1, completedSteps: [] },
    };
    return progressMsg;
  }

  // ── Handle Confirm / Cancel ──
  const handleConfirmTool = useCallback((executionId: string) => {
    setMessages(prev => {
      const updated = prev.map(m => {
        if (m.toolExecution?.id === executionId) {
          const tool = getToolById(m.toolExecution.toolId);
          const result = tool ? simulateToolResult(tool, m.toolExecution.params) : "執行完成";
          const updatedExec: ToolExecution = {
            ...m.toolExecution,
            status: "success",
            result,
            completedAt: new Date().toISOString(),
          };
          setRecentExecutions(r => [updatedExec, ...r].slice(0, 5));
          return { ...m, agentType: "tool_result" as AgentMessageType, toolExecution: updatedExec };
        }
        return m;
      });

      // Add follow-up message
      const execMsg = updated.find(m => m.toolExecution?.id === executionId);
      const tool = execMsg?.toolExecution ? getToolById(execMsg.toolExecution.toolId) : null;
      const followUp: Message = {
        id: genMsgId(),
        role: "assistant",
        content: "還需要我做什麼嗎？",
        timestamp: new Date(),
        agentType: "text",
        suggestions: tool?.relatedTools
          ? tool.relatedTools.slice(0, 3).map(rid => { const rt = getToolById(rid); return rt ? `幫我${rt.name}` : ""; }).filter(Boolean)
          : ["今天有什麼作業？", "推薦午餐", "查公車"],
      };

      return [...updated, followUp];
    });
    setAgentContext(prev => ({ ...prev, state: "idle", currentTool: undefined, pendingConfirmation: undefined }));
  }, []);

  const handleCancelTool = useCallback((executionId: string) => {
    setMessages(prev => {
      const updated = prev.map(m => {
        if (m.toolExecution?.id === executionId) {
          return { ...m, agentType: "tool_result" as AgentMessageType, toolExecution: { ...m.toolExecution, status: "cancelled" as ToolExecutionStatus } };
        }
        return m;
      });
      const cancelMsg: Message = { id: genMsgId(), role: "assistant", content: "好的，已取消。有其他需要幫忙的嗎？", timestamp: new Date(), agentType: "text", suggestions: ["幫我訂午餐", "查作業截止日"] };
      return [...updated, cancelMsg];
    });
    setAgentContext(prev => ({ ...prev, state: "idle", currentTool: undefined, pendingConfirmation: undefined }));
  }, []);

  // ── Handle param input ──
  const handleParamSelect = useCallback((value: string) => {
    if (agentContext.state !== "collecting_params" || !agentContext.currentTool) return;
    const tool = getToolById(agentContext.currentTool);
    if (!tool) return;

    const newParams = { ...agentContext.collectedParams };
    const requiredMissing = tool.parameters.filter(p => p.required && !(p.name in newParams));
    if (requiredMissing.length > 0) {
      newParams[requiredMissing[0].name] = value;
    }

    const stillMissing = tool.parameters.filter(p => p.required && !(p.name in newParams));
    if (stillMissing.length > 0) {
      const nextParam = stillMissing[0];
      setAgentContext(prev => ({ ...prev, collectedParams: newParams }));

      // Show param label for user
      const prevParam = requiredMissing[0];
      const displayVal = prevParam?.type === "select"
        ? prevParam.options?.find(o => o.value === value)?.label ?? value
        : value;

      const userEcho: Message = { id: genMsgId(), role: "user", content: displayVal, timestamp: new Date() };
      const nextCollect: Message = {
        id: genMsgId(),
        role: "assistant",
        content: `收到！接下來：`,
        timestamp: new Date(),
        agentType: "param_collect",
        paramCollect: { tool, collected: newParams, nextParam },
      };
      setMessages(prev => [...prev, userEcho, nextCollect]);
    } else {
      // All collected
      const prevParam = requiredMissing[0];
      const displayVal = prevParam?.type === "select"
        ? prevParam.options?.find(o => o.value === value)?.label ?? value
        : value;
      const userEcho: Message = { id: genMsgId(), role: "user", content: displayVal, timestamp: new Date() };

      if (tool.requiresConfirmation) {
        const confirmMsg = createConfirmMessage(tool, newParams);
        setMessages(prev => [...prev, userEcho, confirmMsg]);
      } else {
        const resultMsg = executeToolImmediately(tool, newParams);
        setMessages(prev => [...prev, userEcho, resultMsg]);
      }
    }
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [agentContext]);

  // ── Chain auto-execute: 自動推進任務鏈步驟 ──
  // 重要修正：requiresConfirmation 的步驟會暫停等用戶確認，不會自動執行
  useEffect(() => {
    // "waiting_chain_confirm" 是等待用戶確認中，不要自動推進
    if (agentContext.state === "waiting_chain_confirm") return;
    if (agentContext.state !== "executing" || !agentContext.currentChain) return;

    const chainId = agentContext.currentChain;
    const chain = TASK_CHAINS.find(c => c.id === chainId);
    if (!chain) {
      // 找不到 chain → 重置狀態，避免永遠卡住
      setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
      return;
    }

    const stepIndex = (agentContext.currentChainStep ?? 1) - 1;
    if (stepIndex >= chain.steps.length) {
      // 所有步驟完成
      const doneMsg: Message = {
        id: genMsgId(), role: "assistant",
        content: `🎉「${chain.name}」流程已全部完成！還需要什麼嗎？`,
        timestamp: new Date(), agentType: "text",
        suggestions: ["還有什麼需要幫忙的嗎？", "今天有什麼作業？"],
      };
      setMessages(prev => [...prev, doneMsg]);
      setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
      return;
    }

    const step = chain.steps[stepIndex];
    const tool = getToolById(step.toolId);
    if (!tool) {
      // 找不到 tool → 跳過這步，避免卡住
      if (stepIndex + 1 >= chain.steps.length) {
        setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
      } else {
        setAgentContext(prev => ({ ...prev, currentChainStep: (prev.currentChainStep ?? 1) + 1 }));
      }
      return;
    }

    // ★ 關鍵修正：需要確認的步驟 → 暫停並詢問用戶
    if (tool.requiresConfirmation) {
      const confirmMsg: Message = {
        id: genMsgId(), role: "assistant",
        content: `⚠️ 步驟 ${step.order}「${step.label}」需要你的確認才能執行。\n\n這個操作將會：${tool.description}\n\n要執行嗎？`,
        timestamp: new Date(), agentType: "text",
        suggestions: [`確認執行「${step.label}」`, "跳過這步", "取消整個流程"],
      };
      setMessages(prev => [...prev, confirmMsg]);
      // 切換到 waiting_chain_confirm 狀態，暫停自動推進
      setAgentContext(prev => ({ ...prev, state: "waiting_chain_confirm" }));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      return;
    }

    // ★ Optional 步驟也要暫停詢問
    if (step.optional) {
      const askMsg: Message = {
        id: genMsgId(), role: "assistant",
        content: `下一步「${step.label}」是選擇性的，要執行嗎？`,
        timestamp: new Date(), agentType: "text",
        suggestions: [`好，執行${step.label}`, "跳過，繼續下一步"],
      };
      setMessages(prev => [...prev, askMsg]);
      setAgentContext(prev => ({ ...prev, state: "waiting_chain_confirm" }));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
      return;
    }

    // 不需確認、非 optional → 自動執行
    const timer = setTimeout(() => {
      const result = simulateToolResult(tool, step.autoParams ?? {});

      // 更新進度卡片（標記當前步驟完成）
      setMessages(prev => {
        const lastChainIdx = prev.map((m, i) => m.agentType === "chain_progress" ? i : -1).filter(i => i >= 0).pop();
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
          id: genMsgId(), role: "assistant",
          content: `✅ 步驟 ${step.order}「${step.label}」完成\n\n${result}`,
          timestamp: new Date(), agentType: "text",
        };

        const updated = [...prev];
        updated[lastChainIdx] = updatedChainMsg;
        return [...updated, stepResultMsg];
      });

      // 推進到下一步
      if (step.order < chain.steps.length) {
        setAgentContext(prev => ({ ...prev, currentChainStep: step.order + 1 }));
      } else {
        // 最後一步完成
        const doneMsg: Message = {
          id: genMsgId(), role: "assistant",
          content: `🎉「${chain.name}」流程已全部完成！還需要什麼嗎？`,
          timestamp: new Date(), agentType: "text",
          suggestions: ["今天有什麼作業？", "推薦午餐", "查公車"],
        };
        setMessages(prev => [...prev, doneMsg]);
        setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
      }

      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 150);
    }, 1200);

    return () => clearTimeout(timer);
  }, [agentContext.state, agentContext.currentChain, agentContext.currentChainStep]);

  // ── Chain step skip / finish ──
  const handleSkipChainStep = useCallback(() => {
    const chainId = agentContext.currentChain;
    const chain = chainId ? TASK_CHAINS.find(c => c.id === chainId) : null;
    if (!chain) {
      // 安全防護：找不到 chain 就重置
      setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
      return;
    }

    const currentStep = agentContext.currentChainStep ?? 1;
    const nextStep = currentStep + 1;

    const skipMsg: Message = {
      id: genMsgId(), role: "assistant",
      content: `⏭ 已跳過步驟 ${currentStep}「${chain.steps[currentStep - 1]?.label ?? ""}」`,
      timestamp: new Date(), agentType: "text",
    };
    setMessages(prev => [...prev, skipMsg]);

    if (nextStep > chain.steps.length) {
      // Chain 完成
      const doneMsg: Message = {
        id: genMsgId(), role: "assistant",
        content: `🎉「${chain.name}」流程已完成！`,
        timestamp: new Date(), agentType: "text",
        suggestions: ["還有什麼需要幫忙的嗎？"],
      };
      setMessages(prev => [...prev, doneMsg]);
      setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
    } else {
      // 跳過當前步驟，推進下一步（確保回到 executing 以觸發 useEffect）
      setAgentContext(prev => ({ ...prev, state: "executing", currentChainStep: nextStep }));
    }
  }, [agentContext.currentChain, agentContext.currentChainStep]);

  // ── Handle Proactive Action ──
  const handleProactiveAction = useCallback((triggerId: string) => {
    const trigger = PROACTIVE_TRIGGERS.find(t => t.id === triggerId);
    if (!trigger?.suggestedTool) return;
    const tool = getToolById(trigger.suggestedTool);
    if (tool) {
      const msg = startToolExecution(tool, trigger.message);
      if (msg) setMessages(prev => [...prev, msg]);
    }
    setProactiveMessages(prev => prev.filter(p => p.trigger.id !== triggerId));
  }, []);

  // ── Main Send Handler ──
  const abortRef = useRef<AbortController | null>(null);

  const handleSend = async () => {
    if (!input.trim()) return;

    // If in a chain (executing or waiting for confirmation)
    if ((agentContext.state === "executing" || agentContext.state === "waiting_chain_confirm") && agentContext.currentChain) {
      const trimmed = input.trim().toLowerCase();

      // 用戶要取消整個流程
      if (/取消|算了|不要了|停止|中斷|取消流程/.test(trimmed)) {
        setInput("");
        const cancelMsg: Message = {
          id: genMsgId(), role: "assistant",
          content: "好的，已取消流程。有其他需要幫忙的嗎？",
          timestamp: new Date(), agentType: "text",
          suggestions: ["推薦午餐", "今天有什麼作業？", "查公車"],
        };
        setMessages(prev => [...prev, { id: genMsgId(), role: "user", content: input.trim(), timestamp: new Date() }, cancelMsg]);
        setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
        return;
      }

      // 用戶要跳過當前步驟
      if (/跳過|不用|不要|完成|跳過這步/.test(trimmed)) {
        setInput("");
        // 如果在 waiting_chain_confirm，先回到 executing 再跳步
        if (agentContext.state === "waiting_chain_confirm") {
          setAgentContext(prev => ({ ...prev, state: "executing" }));
        }
        handleSkipChainStep();
        return;
      }

      // 用戶確認執行（僅在 waiting_chain_confirm 時有效）
      if (agentContext.state === "waiting_chain_confirm" && /好|執行|要|確認|是|ok|可以|確認執行/.test(trimmed)) {
        setInput("");
        // 執行被暫停的步驟，然後推進
        const chainId = agentContext.currentChain;
        const chain = TASK_CHAINS.find(c => c.id === chainId);
        if (chain) {
          const stepIndex = (agentContext.currentChainStep ?? 1) - 1;
          const step = chain.steps[stepIndex];
          const tool = step ? getToolById(step.toolId) : null;
          if (step && tool) {
            const result = simulateToolResult(tool, step.autoParams ?? {});
            // 更新進度卡片
            setMessages(prev => {
              const userEcho: Message = { id: genMsgId(), role: "user", content: input.trim(), timestamp: new Date() };
              const lastChainIdx = prev.map((m, i) => m.agentType === "chain_progress" ? i : -1).filter(i => i >= 0).pop();
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
                id: genMsgId(), role: "assistant",
                content: `✅ 步驟 ${step.order}「${step.label}」已確認並完成\n\n${result}`,
                timestamp: new Date(), agentType: "text",
              };
              const updated = [...prev];
              updated[lastChainIdx] = updatedChainMsg;
              return [...updated, userEcho, stepResultMsg];
            });

            // 推進到下一步
            if (step.order < chain.steps.length) {
              setAgentContext(prev => ({ ...prev, state: "executing", currentChainStep: step.order + 1 }));
            } else {
              const doneMsg: Message = {
                id: genMsgId(), role: "assistant",
                content: `🎉「${chain.name}」流程已全部完成！還需要什麼嗎？`,
                timestamp: new Date(), agentType: "text",
                suggestions: ["今天有什麼作業？", "推薦午餐", "查公車"],
              };
              setMessages(prev => [...prev, doneMsg]);
              setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
            }
          }
        }
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
        return;
      }

      // ★ 用戶問了完全無關的問題 → 放棄鏈，正常處理新問題
      // 不攔截，讓訊息繼續往下走，但先重置 chain 狀態
      const abandonMsg: Message = {
        id: genMsgId(), role: "assistant",
        content: "（已自動結束先前的流程）",
        timestamp: new Date(), agentType: "text",
      };
      setMessages(prev => [...prev, abandonMsg]);
      setAgentContext(prev => ({ ...prev, state: "idle", currentChain: undefined, currentChainStep: undefined }));
      // 不 return — 讓訊息繼續往下正常處理
    }

    // If collecting params and user types free text
    if (agentContext.state === "collecting_params" && agentContext.currentTool) {
      const tool = getToolById(agentContext.currentTool);
      if (tool) {
        const requiredMissing = tool.parameters.filter(p => p.required && !(p.name in agentContext.collectedParams));
        if (requiredMissing.length > 0) {
          handleParamSelect(input.trim());
          setInput("");
          return;
        }
      }
    }

    try { abortRef.current?.abort(); } catch (_) { /* ignore DOMException on RN */ }
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    const userMsg: Message = { id: genMsgId(), role: "user", content: input.trim(), timestamp: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setShowCapabilities(false);
    setIsTyping(true);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    try { // ← 全域 try/finally 確保 isTyping 一定會被重置

    // ── 自動訓練：偵測回饋（正面 + 負面）──
    const dissatisfactionPatterns = /不對|答錯|回答錯|沒有回答|答非所問|不是這個|搞錯|你錯了|不相關|離題|文不對題|完全不對|說錯|亂回答|亂講|胡說/;
    const satisfactionPatterns = /謝謝|感謝|太好了|好的|了解|懂了|有幫助|不錯|很棒|厲害|太強了|完美|正確/;

    if (dissatisfactionPatterns.test(userMsg.content)) {
      // 負面回饋 → 降低品質 + Q-learning 懲罰
      const lastBotMsg = [...messages].reverse().find(m => m.role === "assistant");
      if (lastBotMsg) {
        setLearningState(prev => recordCorrection(
          prev,
          messages.filter(m => m.role === "user").slice(-1)[0]?.content ?? "",
          lastBotMsg.content,
          userMsg.content,
        ));
        // 訓練 AI 大腦（負面回饋）
        setAiBrain(prev => trainFromFeedback(
          prev,
          messages.filter(m => m.role === "user").slice(-1)[0]?.content ?? "",
          lastBotMsg.content,
          lastIntentRef.current,
          lastStrategyRef.current,
          -1,
        ));
      }
      if (lastQAPairIdRef.current) {
        setTrainingDB(prev => updatePairQuality(prev, lastQAPairIdRef.current!, -1));
        lastQAPairIdRef.current = null;
      }
    } else if (satisfactionPatterns.test(userMsg.content)) {
      // 正面回饋 → 提升品質 + Q-learning 獎勵
      if (lastQAPairIdRef.current) {
        setTrainingDB(prev => updatePairQuality(prev, lastQAPairIdRef.current!, +1, true));
        lastQAPairIdRef.current = null;
      }
      const lastBotMsg = [...messages].reverse().find(m => m.role === "assistant");
      if (lastBotMsg) {
        setAiBrain(prev => trainFromFeedback(
          prev,
          messages.filter(m => m.role === "user").slice(-1)[0]?.content ?? "",
          lastBotMsg.content,
          lastIntentRef.current,
          lastStrategyRef.current,
          +1,
        ));
      }
    }

    // ── Extract learnable facts from user message & update memory ──
    const previousContents = messages.filter(m => m.role === "user").slice(-5).map(m => m.content);
    const newFacts = extractLearnableFacts(userMsg.content, previousContents);
    if (newFacts.length > 0) {
      setAgentMemory(prev => mergeLearnedFacts(prev, newFacts));
    }
    // Track action
    setAgentMemory(prev => addRecentAction(prev, {
      toolId: "user_message",
      params: { content: userMsg.content },
      timestamp: new Date().toISOString(),
      wasSuccessful: true,
    }));

    // ── 智慧路由：偵測複雜查詢 → 跳過本地引擎直送 Gemini ──
    const needsLLM = (() => {
      const msg = userMsg.content.toLowerCase();
      const len = msg.length;
      // 長句（>30字）通常需要更深度的理解
      if (len > 30 && /為什麼|怎麼辦|如何|應該|建議|分析|比較|解釋|幫我想|你覺得|可以嗎/.test(msg)) return true;
      // 開放式問答 / 需要推理
      if (/為什麼|原因|怎麼辦|如何.*才|應該.*還是|到底|究竟|差別|不同/.test(msg)) return true;
      // 複合問題（多個問號或「和」「跟」連接的問題）
      if ((msg.match(/[？?]/g) || []).length >= 2) return true;
      // 情感支持 / 開放式聊天
      if (/好煩|好累|壓力大|不想|焦慮|憂鬱|怎麼.*這麼|人生|未來|迷茫/.test(msg)) return true;
      // 需要創意/建議類（但排除餐飲推薦，因為本地有完整資料）
      if (/規劃|計畫|安排|準備.*怎|面試|履歷|實習|打工|交換/.test(msg)) return true;
      if (/推薦/.test(msg) && !/吃|餐|飯|麵|午餐|晚餐|早餐|宵夜|美食|食物/.test(msg)) return true;
      // 一般知識問答（非校園特定）
      if (/是什麼意思|英文|翻譯|程式|code|bug|python|java|AI|機器學習/.test(msg)) return true;
      return false;
    })();

    // Try agent logic first (skip for complex queries that need LLM)
    const agentResult = needsLLM ? null : await detectIntentAndExecute(userMsg.content);

    if (agentResult) {
      // Add thinking steps to agent results
      const thinkingChain = buildThinkingChain(userMsg.content, {
        hasCourses: courses.length > 0,
        hasAssignments: pendingAssignments.length > 0,
        hasGrades: false,
        hasAnnouncements: (announcements as any[]).length > 0,
        hasEvents: (events as any[]).length > 0,
        hasMenus: (menus as any[]).length > 0,
        hasPois: (pois as any[]).length > 0,
        hasMemory: agentMemory.learnedFacts.length > 0,
      }, agentMemory);
      if (thinkingChain.steps.length > 0) {
        agentResult.thinkingSteps = thinkingChain.steps as ThinkingStepUI[];
      }
      setIsTyping(false);
      setMessages(prev => [...prev, agentResult]);
      // ✅ 自動訓練：儲存本地智慧回答為訓練樣本
      setTrainingDB(prev => {
        const updated = addTrainingPair(prev, userMsg.content, agentResult.content, "local");
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

    // 準備即時資料（每次都是最新的，不是快取）
    // ★ 加入 ?? [] 防護：避免 hooks 尚未載入時 undefined.map() 崩潰
    const safeCourses = courses ?? [];
    const safeAssignments = pendingAssignments ?? [];
    const safeMenus = (menus ?? []) as any[];
    const safeEvents = (events ?? []) as any[];
    const safeAnnouncements = (announcements ?? []) as any[];
    const safePois = (pois ?? []) as any[];

    const liveData = {
      courses: safeCourses.map(c => ({ id: c.id, name: c.name, teacher: c.teacher, dayOfWeek: c.dayOfWeek, startPeriod: c.startPeriod, credits: c.credits })),
      assignments: safeAssignments.map(a => ({ id: a.id, title: a.title, groupName: a.groupName ?? "", dueAt: a.dueAt ? new Date(a.dueAt.seconds * 1000).toLocaleDateString("zh-TW") : undefined, isLate: a.isLate })),
      menus: safeMenus.map(m => ({ id: m.id, name: m.name ?? m.cafeteria, price: m.price, cafeteria: m.cafeteria })),
      events: safeEvents.map(e => ({ id: e.id, title: e.title, location: e.location, startsAt: e.startsAt })),
      announcements: safeAnnouncements.map(a => ({ id: a.id, title: a.title, source: a.source })),
      pois: safePois.map(p => ({ id: p.id, name: p.name, category: p.category })),
      memory: agentMemory ?? { learnedFacts: [], recentActions: [] },
    };

    // ── AI 大腦深度理解（全管線：NER → 意圖 → 注意力 → 推理 → 澄清 → 情境） ──
    const understanding = understandQuery(
      aiBrain,
      userMsg.content,
      liveData.courses.map(c => c.name),
      liveData.pois.map(p => p.name),
      [], // knownPeople
      liveData.menus.map(m => m.name),
    );
    lastIntentRef.current = understanding.intent.intent;
    lastStrategyRef.current = understanding.strategy;

    // 更新對話上下文
    setAiBrain(prev => updateBrainContext(
      prev, "user", userMsg.content,
      understanding.tokens, understanding.intent.intent, understanding.entities,
    ));
    trainEmbeddingOnSentence(aiBrain.embedding, understanding.tokens, 0.003);

    // ── 主動澄清：信心極低時先問清楚 ──
    if (understanding.clarification.needed && understanding.clarification.suggestedQuestions.length > 0) {
      const clarifyMsg: Message = {
        id: genMsgId(),
        role: "assistant",
        content: understanding.clarification.suggestedQuestions[0],
        timestamp: new Date(),
        agentType: "text",
        suggestions: understanding.clarification.suggestedQuestions.length > 1
          ? understanding.clarification.suggestedQuestions.slice(1)
          : undefined,
      };
      setIsTyping(false);
      setMessages(prev => [...prev, clarifyMsg]);
      setAiBrain(prev => updateBrainContext(prev, "assistant", clarifyMsg.content, advancedTokenize(clarifyMsg.content)));
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      return;
    }

    // ── 嘗試本地 AI 回答（綜合信心 >= 0.60 直接用，推理引擎降低門檻） ──
    // ★ needsLLM 為 true 時提高門檻到 0.85，讓大部分查詢走 Gemini
    const reasoningBoost = understanding.reasoning.totalConfidence > 0.6 ? 0.1 : 0;
    const retrievalBoost = understanding.retrievalHits.length > 0 && understanding.retrievalHits[0].fusedScore > 0.01 ? 0.08 : 0;
    const combinedConfidence = Math.max(localConfidence, understanding.intent.confidence * 0.8) + reasoningBoost + retrievalBoost;
    const localThreshold = needsLLM ? 0.85 : 0.60;
    if (combinedConfidence >= localThreshold) {
      const localResult = generateLocalAnswer(
        understanding.resolvedText, questionTags, liveData,
        trainingDB.templates, learningState,
        {
          currentTopic: aiBrain.dialogCtx.currentTopic,
          topicContinuity: aiBrain.dialogCtx.topicContinuity,
          isFollowUp: understanding.isFollowUp,
          slots: aiBrain.dialogCtx.slots.map(s => ({ name: s.name, value: s.value })),
          shortTermMemory: aiBrain.dialogCtx.shortTermMemory.map(m => ({ key: m.key, value: m.value })),
          userMood: aiBrain.dialogCtx.userMood,
          userStyle: aiBrain.dialogCtx.userStyle,
          contextSummary: getContextSummary(aiBrain.dialogCtx) +
            (aiBrain.conversationSummary ? " " + summaryToText(aiBrain.conversationSummary) : "") +
            (understanding.retrievalHits.length > 0 ? ` [檢索命中: ${understanding.retrievalHits.slice(0, 2).map(h => h.raw.slice(0, 40)).join("; ")}]` : "") +
            (understanding.reasoning.finalAnswer ? ` [推理結論: ${understanding.reasoning.finalAnswer.slice(0, 80)}]` : ""),
          recentTurns: aiBrain.dialogCtx.turns.slice(-6).map(t => ({ role: t.role, content: t.content })),
        },
      );
      if (localResult && localResult.confidence >= 0.60) {
        // 用注意力回答組合器修飾回答
        const candidates: ResponseCandidate[] = [{
          text: localResult.answer,
          score: localResult.confidence,
          source: "local_handler",
          strategy: understanding.strategy,
        }];

        // 如果推理引擎有額外結論，加入候選
        if (understanding.reasoning.finalAnswer && understanding.reasoning.finalAnswer.length > 5) {
          candidates.push({
            text: understanding.reasoning.finalAnswer,
            score: understanding.reasoning.totalConfidence * 0.7,
            source: "similar_qa",
            strategy: "direct_answer",
          });
        }

        let composedAnswer = composeResponse(
          candidates, understanding.strategy, understanding.intent.intent,
          aiBrain.ngramModel, aiBrain.dialogCtx,
        );

        // 品質自評
        const quality = evaluateResponseQuality(
          userMsg.content, composedAnswer, understanding.intent,
          understanding.reasoning, aiBrain.embedding,
        );

        // 品質太差 → 跳到 Gemini
        if (quality.shouldUseGemini) {
          // 不 return，會 fallthrough 到 Gemini 呼叫
        } else {
          // 情境增強（時間/學期/天氣感知）
          composedAnswer = contextualEnhance(
            composedAnswer, understanding.intent.intent,
            understanding.contextualFactors, aiBrain.dialogCtx,
          );

          // 組合式回答結構（共感 → 資訊 → 推理 → 行動建議）
          composedAnswer = composeStructuredResponse(
            composedAnswer, understanding.intent.intent,
            aiBrain.dialogCtx, understanding.reasoning, understanding.contextualFactors,
          );

          const localMsg: Message = {
            id: genMsgId(),
            role: "assistant",
            content: composedAnswer,
            timestamp: new Date(),
            agentType: "text",
          };
          setIsTyping(false);
          setMessages(prev => [...prev, localMsg]);

          // 更新 AI 大腦上下文 + 訓練 + 索引
          setAiBrain(prev => {
            const updated = updateBrainContext(prev, "assistant", composedAnswer, advancedTokenize(composedAnswer), understanding.intent.intent);
            const qaId = `local_${Date.now()}`;
            indexDocument(updated.retrievalIndex, qaId, `${userMsg.content}\n${composedAnswer}`,
              [...understanding.tokens, ...advancedTokenize(composedAnswer)], understanding.intent.intent);
            return updated;
          });
          trainNgramOnResponse(aiBrain.ngramModel, composedAnswer, understanding.intent.intent);

          // 記錄為本地回答訓練樣本
          setTrainingDB(prev => {
            const updated = addTrainingPair(prev, userMsg.content, composedAnswer, "local", {
              courseNames: liveData.courses.map(c => c.name),
              assignmentTitles: liveData.assignments.map(a => a.title),
              menuNames: liveData.menus.map(m => m.name),
              eventTitles: liveData.events.map(e => e.title),
              poiNames: liveData.pois.map(p => p.name),
            });
            lastQAPairIdRef.current = updated.pairs[updated.pairs.length - 1]?.id ?? null;
            return updated;
          });
          setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
          return;
        } // end else (quality ok)
      } // end if (localResult)
    } // end if (combinedConfidence)

    // ── 本地信心不足 → 呼叫 Gemini API ──
    const responseId = genMsgId();
    const aiMessages: AIMessage[] = messages.filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }));
    aiMessages.push({ role: "user", content: userMsg.content });

    const placeholder: Message = { id: responseId, role: "assistant", content: "", timestamp: new Date(), agentType: "text" };
    setMessages(prev => [...prev, placeholder]);
    setIsTyping(false);

    const onToken: StreamingCallback = (partial) => {
      setMessages(prev => prev.map(m => m.id === responseId ? { ...m, content: partial } : m));
      scrollRef.current?.scrollToEnd({ animated: false });
    };

    try {
      const aiResponse = await chatWithLocalLLMStreaming(aiMessages, aiContext, onToken, signal);
      const finalContent = aiResponse.error ? `抱歉，發生錯誤：${aiResponse.error}` : aiResponse.content;
      setMessages(prev => prev.map(m => m.id === responseId ? {
        ...m,
        content: finalContent,
        suggestions: aiResponse.suggestions,
        actions: aiResponse.actions,
        thinkingSteps: (aiResponse as any).thinking as ThinkingStepUI[] | undefined,
      } : m));

      // ✅ Gemini 回答成功 → 全面蒸餾學習到本地 AI 大腦
      if (!aiResponse.error && finalContent.length > 0) {
        setTrainingDB(prev => {
          const updated = addTrainingPair(prev, userMsg.content, finalContent, "gemini", {
            courseNames: liveData.courses.map(c => c.name),
            assignmentTitles: liveData.assignments.map(a => a.title),
            menuNames: liveData.menus.map(m => m.name),
            eventTitles: liveData.events.map(e => e.title),
            poiNames: liveData.pois.map(p => p.name),
          });
          lastQAPairIdRef.current = updated.pairs[updated.pairs.length - 1]?.id ?? null;
          return updated;
        });

        // 🧠 Gemini 知識蒸餾 — 讓本地模型從 API 回答中學習
        setAiBrain(prev => {
          let updated = updateBrainContext(prev, "assistant", finalContent, advancedTokenize(finalContent), lastIntentRef.current);
          // 蒸餾：學習詞向量 + 意圖 + N-gram + 模板 + 索引
          distillFromGeminiResponse(
            updated, userMsg.content, finalContent,
            lastIntentRef.current, understanding.entities,
          );
          // 強化回饋訓練
          updated = trainFromFeedback(
            updated, userMsg.content, finalContent,
            lastIntentRef.current, lastStrategyRef.current, +1,
          );
          return updated;
        });
        trainNgramOnResponse(aiBrain.ngramModel, finalContent, lastIntentRef.current);
      }
    } catch (e: any) {
      if (e.name !== "AbortError") {
        // Gemini 也失敗 → 用本地 AI 作為最後防線（不管信心多低）
        const localFallback = generateLocalAnswer(
          userMsg.content, questionTags, liveData,
          trainingDB.templates, learningState,
          {
            currentTopic: aiBrain.dialogCtx.currentTopic,
            topicContinuity: aiBrain.dialogCtx.topicContinuity,
            isFollowUp: understanding.isFollowUp,
            slots: aiBrain.dialogCtx.slots.map(s => ({ name: s.name, value: s.value })),
            shortTermMemory: aiBrain.dialogCtx.shortTermMemory.map(m => ({ key: m.key, value: m.value })),
            userMood: aiBrain.dialogCtx.userMood,
            recentTurns: aiBrain.dialogCtx.turns.slice(-6).map(t => ({ role: t.role, content: t.content })),
          },
        );
        if (localFallback) {
          setMessages(prev => prev.map(m => m.id === responseId ? {
            ...m, content: localFallback.answer,
          } : m));
          setTrainingDB(prev => {
            const updated = addTrainingPair(prev, userMsg.content, localFallback.answer, "local");
            lastQAPairIdRef.current = updated.pairs[updated.pairs.length - 1]?.id ?? null;
            return updated;
          });
        } else {
          const fallback = await chatWithCampusAssistant(aiMessages, aiContext);
          setMessages(prev => prev.map(m => m.id === responseId ? {
            ...m, content: fallback.content, suggestions: fallback.suggestions, actions: fallback.actions,
          } : m));
        }
      }
    }

    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

    } catch (fatalError: any) {
      // 全域錯誤捕獲 — 任何未預期的例外都不會讓 AI 卡死
      console.error("[AIChat] handleSend fatal error:", fatalError);
      const errorMsg: Message = {
        id: genMsgId(), role: "assistant",
        content: "抱歉，處理你的訊息時發生了意外錯誤。請再試一次！",
        timestamp: new Date(), agentType: "text",
        suggestions: ["再問一次", "換個方式問"],
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      // ★ 無論任何路徑，一定重置 isTyping
      setIsTyping(false);
    }
  };

  // ── Other handlers ──
  const handleAction = async (action: string, params?: Record<string, unknown>) => {
    if (action === "navigate" && params) {
      const screen = typeof params.screen === "string" ? params.screen : null;
      const nested = typeof params.nested === "string" ? params.nested : null;
      const id = typeof params.id === "string" ? params.id : undefined;
      if (!screen) return;
      if (nested) nav?.navigate?.(screen, { screen: nested, params: { id } });
      else nav?.navigate?.(screen);
      return;
    }
  };

  const handleSuggestion = (text: string) => {
    // 點擊建議選項 = 正面訊號（表示 AI 的引導有用）
    if (lastQAPairIdRef.current) {
      setTrainingDB(prev => updatePairQuality(prev, lastQAPairIdRef.current!, +1, true));
    }
    setInput(text);
    setTimeout(() => handleSend(), 100);
  };

  const handleFeedback = useCallback((messageId: string, rating: "thumbs_up" | "thumbs_down") => {
    const targetMsg = messages.find(m => m.id === messageId);
    if (!targetMsg) return;
    const previousUserMsg = [...messages].reverse().find(m => m.role === "user" && messages.indexOf(m) < messages.indexOf(targetMsg));
    submitFeedback({ messageId, userMessage: previousUserMsg?.content ?? "", assistantResponse: targetMsg.content, rating, userId: auth.user?.uid });

    // ✅ 自動訓練：thumbs up/down 直接更新 QA 品質
    // 尋找對應的 training pair（按問題內容匹配）
    if (previousUserMsg) {
      const matchingPair = trainingDB.pairs.find(p =>
        p.question === previousUserMsg.content && p.answer.slice(0, 50) === targetMsg.content.slice(0, 50)
      );
      if (matchingPair) {
        const delta = rating === "thumbs_up" ? +1 : -1;
        setTrainingDB(prev => updatePairQuality(prev, matchingPair.id, delta, rating === "thumbs_up"));
      }
      // 同步訓練 AI 大腦
      const reward = rating === "thumbs_up" ? +1 : -1;
      setAiBrain(prev => trainFromFeedback(
        prev, previousUserMsg.content, targetMsg.content,
        lastIntentRef.current, lastStrategyRef.current, reward,
      ));
    }
  }, [messages, auth.user?.uid, trainingDB.pairs]);

  const handleClearHistory = useCallback(() => {
    Alert.alert("清除對話記錄", "確定要清除所有對話記錄嗎？", [
      { text: "取消", style: "cancel" },
      {
        text: "清除", style: "destructive",
        onPress: async () => {
          try { await clearAIChatHistory(chatHistoryKey); } catch (e) { console.warn("[AIChat] clear fail:", e); }
          const name = auth.profile?.displayName?.split(" ")[0] ?? "同學";
          const greeting: Message = { id: "greeting", role: "assistant", content: simulateAgentGreeting(name, userRole), timestamp: new Date(), agentType: "capability_card", suggestions: ["幫我訂午餐", "我頭有點痛", "預約圖書館座位"] };
          setMessages([greeting]);
          setShowCapabilities(true);
          setRecentExecutions(simulateRecentExecutions());
          setProactiveMessages(simulateProactiveMessages());
          setAgentContext(getInitialContext());
        },
      },
    ]);
  }, [auth.profile?.displayName, chatHistoryKey]);

  // ═══════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }} keyboardVerticalOffset={90}>
        <View style={{ flex: 1 }}>
          {/* Recent Executions Bar */}
          <RecentExecutionsBar executions={recentExecutions} />

          <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 16, paddingBottom: TAB_BAR_CONTENT_BOTTOM_PADDING + 70 }} showsVerticalScrollIndicator={false}>
            {/* Proactive Banners */}
            {proactiveMessages.map((pm, i) => (
              <ProactiveBanner
                key={pm.trigger.id}
                trigger={pm.trigger}
                message={pm.message}
                onAction={() => handleProactiveAction(pm.trigger.id)}
                onDismiss={() => setProactiveMessages(prev => prev.filter((_, j) => j !== i))}
              />
            ))}

            {/* Messages */}
            {messages.map(msg => (
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
                <Text style={{ color: theme.colors.muted, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>
                  我能幫你做的事：
                </Text>
                <CapabilityGrid role={userRole} onTryTool={handleSuggestion} />
              </View>
            )}

            {/* Typing indicator */}
            {isTyping && (
              <View style={{ alignSelf: "flex-start", marginTop: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: "#6366F1", alignItems: "center", justifyContent: "center" }}>
                    <Ionicons name="flash" size={12} color="#fff" />
                  </View>
                  <Text style={{ color: theme.colors.muted, fontSize: 11 }}>思考中...</Text>
                </View>
                <View style={{ padding: 8, borderRadius: 18, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
                  <TypingIndicator />
                </View>
              </View>
            )}
          </ScrollView>
        </View>

        {/* Input Bar */}
        <View style={{
          position: "absolute", bottom: 0, left: 0, right: 0, padding: 12,
          paddingBottom: Platform.OS === "ios" ? 24 : 12,
          backgroundColor: theme.colors.bg, borderTopWidth: 1, borderTopColor: theme.colors.border,
        }}>
          {/* Agent state indicator */}
          {agentContext.state !== "idle" && agentContext.state !== "reporting" && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6, paddingHorizontal: 4 }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: agentContext.state === "executing" ? "#10B981" : (agentContext.state === "confirming" || agentContext.state === "waiting_chain_confirm") ? "#F59E0B" : "#6366F1" }} />
              <Text style={{ color: theme.colors.muted, fontSize: 11 }}>
                {agentContext.state === "collecting_params" ? "收集資訊中..." : agentContext.state === "confirming" ? "等待確認..." : agentContext.state === "waiting_chain_confirm" ? "等待你的確認..." : agentContext.state === "executing" ? "執行中..." : "處理中..."}
              </Text>
            </View>
          )}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 8, borderRadius: 999, backgroundColor: theme.colors.surface2, borderWidth: 1, borderColor: theme.colors.border }}>
            <Pressable onPress={handleClearHistory} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, backgroundColor: pressed ? theme.colors.surface2 : "transparent", alignItems: "center", justifyContent: "center" })}>
              <Ionicons name="trash-outline" size={18} color={theme.colors.muted} />
            </Pressable>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={agentContext.state === "collecting_params" ? "輸入資訊..." : "告訴我你需要什麼..."}
              placeholderTextColor={theme.colors.muted}
              onSubmitEditing={handleSend}
              returnKeyType="send"
              style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 8, color: theme.colors.text, fontSize: 15 }}
            />
            <Pressable onPress={handleSend} disabled={!input.trim()} style={({ pressed }) => ({
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: input.trim() ? "#6366F1" : theme.colors.surface2,
              alignItems: "center", justifyContent: "center", opacity: pressed ? 0.8 : 1,
            })}>
              <Ionicons name="send" size={18} color={input.trim() ? "#fff" : theme.colors.muted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}
