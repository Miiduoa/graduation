export * from './notifications';
export * from './ical';
export * from './ai';
export * from './aiAppContext';
export * from './webSearch';
export * from './webLearning';
export * from './sso';
export * from './ssoSession';
export * from './offline';
export * from './analytics';
export * from './admin';
export * from './storage';
export * from './errorReporting';
export * from './performance';
export { PerformanceMonitor } from './performanceMonitor';
export * from './cacheWarming';
export * from './privacy';
export * from './memberDirectory';
export { localLLM, MODEL_REGISTRY, estimateTokens } from './localLLMInference';
export { agentReason, registerTool, getRegisteredTools } from './agentReasoningEngine';
export { localAssistant } from './localAssistant';
export {
  aiBrain,
  getAIBrain,
  type BrainSnapshot,
  type BrainListener,
  type AskOptions,
  type AskResult,
} from './aiBrain';
export {
  startRealtimeSync,
  stopRealtimeSync,
  subscribeRealtimeEvents,
  type RealtimeEvent,
  type RealtimeEventKind,
} from './aiRealtimeSync';
export {
  observeInteraction,
  recordFeedback,
  recordToolOutcome,
  subscribeLearning,
  inferPreferencesFromHistory,
  type LearningInteraction,
  type LearningSnapshot,
  type FeedbackPayload,
} from './aiContinualLearning';
export {
  buildActionPlan,
  executePlan,
  classifyRisk,
  registerPendingPlan,
  consumePendingPlan,
  dismissPendingPlan,
  listPendingPlans,
  subscribePendingPlans,
  type ActionPlan,
  type ActionStep,
  type ActionRisk,
  type ActionStatus,
  type StepOutcome,
  type ActionExecutionReport,
  type ActionExecutionContext,
} from './aiActionCoordinator';
export {
  startProactiveThinker,
  stopProactiveThinker,
  subscribeProactiveInsights,
  getProactiveInsights,
  dismissInsight as dismissProactiveInsight,
  runOnce as runProactiveOnce,
  type BrainInsight,
  type InsightCategory,
} from './aiProactiveThinker';
