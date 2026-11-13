import type { PublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistantClient';

export type V2Card = {
  tool: string;
  args: Record<string, unknown>;
  token: string;
  mutationId: string;
  schoolId: string;
  destination: string;
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
  local?: import('@/lib/assistantLocalActions').LocalAssistantResult;
  courseworkTargets?: import('@/lib/assistantCoursework').AssistantCourseworkTarget[];
  courseworkDate?: string;
};

export type V2Turn = {
  question: string;
  reply: V2Reply;
  /** Local public lookup, outside the model conversation and signed action cards. */
  publicCourse?: { read?: PublicCourseAssistantRead };
  /** A private, typed TronClass result never becomes cloud model history. */
  tronClass?: {
    result?: import('@/lib/tronClassAgentTypes').TronClassAgentReply;
    accessRequired?: boolean;
    unconnected?: boolean;
    inactive?: boolean;
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
