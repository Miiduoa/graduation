import type { PublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistantClient';

export type V2Card = {
  tool: string;
  args: Record<string, unknown>;
  token: string;
  mutationId: string;
  schoolId: string;
  destination: string;
  /** Display policy only; the server's signed token retains source authority. */
  sourceBound?: 'food-pickup';
  /** Kept with recovery cards; never derived from model-generated arguments. */
  conversationId?: string;
};

export type V2Step = { name: string; status: string; summary: string };

export type V2Reply = {
  answer: string;
  steps: V2Step[];
  cards: V2Card[];
  simulation?: boolean;
  /** Verified reader output stays literal and out of later model history. */
  dataRead?: boolean;
  /** Fixed capability guidance; not a completed private-data read. */
  roleGuide?: import('@campus/shared/src/assistantRoleProfiles').AssistantRoleProfileId;
  serviceIds?: readonly import('@campus/shared/src/assistantServices').AssistantServiceId[];
  local?: import('@/lib/assistantLocalActions').LocalAssistantResult;
  demo?: import('@/lib/accountDemoAssistant').AccountDemoAssistantAnswer;
  courseworkTargets?: import('@/lib/assistantCoursework').AssistantCourseworkTarget[];
  courseworkDate?: string;
  /** Exact public records offered for an explicit, independently re-read selection. */
  eventTargets?: import('@/lib/assistantCampusEvent').AssistantCampusEventTarget[];
  /** True for a source-bound preview; false for a discovery that still needs
   * an explicit source choice. A preview's single source is not a new list. */
  campusEventPreview?: boolean;
  /** Server-prepared task results; validate before rendering or linking. */
  taskPlan?: import('@campus/shared/src/assistantTaskPlan').AssistantTaskPlan;
  /** Scoped read continuation; never an action-card confirmation. */
  taskRetry?: import('@campus/shared/src/assistantTaskRetry').AssistantTaskRetry;
  /** Reviewed public catalogs; validate their envelope before rendering cards. */
  publicCourseResults?: import('@campus/shared/src/assistantPublicCourseResults').AssistantPublicCourseResult[];
};

export type V2Turn = {
  question: string;
  reply: V2Reply;
  /** Local request provenance, never copied from a server reply. A fresh
   * discovery preview cannot expose an older activity list to later ordinals. */
  campusEventDiscovery?: true;
  /** Preserve the original conversation when retrying this turn's scoped reads. */
  conversationId?: string;
  taskProfile?: import('@campus/shared/src/assistantRoleProfiles').AssistantRoleProfileId;
  /** Local public lookup, outside the model conversation and signed action cards. */
  publicCourse?: { read?: PublicCourseAssistantRead };
  /** A private, typed TronClass result never becomes cloud model history. */
  tronClass?: {
    result?: import('@/lib/tronClassAgentTypes').TronClassAgentReply;
    accessRequired?: boolean;
    unconnected?: boolean;
    inactive?: boolean;
    /** A TronClass supplement appended after the planner answered a multi-clause
     * request. It never replaces the planner turn as follow-up context. */
    compoundQuestion?: string;
  };
};

export type V2ActionState =
  | { status: 'executing' | 'checking' }
  | { status: 'unknown' | 'blocked' | 'conflict'; message: string }
  | { status: 'absent'; retryable: boolean; message: string }
  | { status: 'cancelled' | 'superseded' }
  | { status: 'handoff'; href: string; message: string }
  | {
      status: 'verified';
      receipt: import('@campus/shared/src/assistantExecution').AssistantCalendarReceipt;
      local: 'ready' | 'unavailable';
      localMessage?: string;
      verificationWarning?: string;
    };

export type V2ActionStates = Record<string, V2ActionState>;

export type DueItem = {
  title: string;
  course?: string;
  dueLabel: string;
};
