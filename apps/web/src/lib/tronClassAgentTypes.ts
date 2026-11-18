import type { TronClassPreparation, TronClassSnapshot } from './tronClassIntegrationTypes';

export const TRONCLASS_AGENT_MAX_ACTIONS = 500;

export type TronClassAgentIntent =
  | 'courses' | 'homework' | 'announcements' | 'materials'
  | 'download' | 'prepare' | 'capabilities' | 'unsupported';

export type TronClassAgentCapabilities = {
  readCourseData: boolean;
  downloadMaterials: boolean;
  prepareHomework: boolean;
  /** Agent writes require a separately verified school contract and confirmation flow. */
  submitHomework: false;
  limitations: string[];
};

export type TronClassAgentCapabilityResult = {
  source: 'tronclass';
  revision: string;
  grantVersion: string | null;
  capabilities: TronClassAgentCapabilities;
};

export type TronClassAgentAction =
  | {
    kind: 'download_material';
    id: string;
    courseId: number;
    activityId: number;
    uploadKey: string;
    name: string;
    revision: string;
    /** Only a literal download request with one verified target may start automatically. */
    automatic: boolean;
  }
  | {
    kind: 'prepare_homework';
    id: string;
    courseId: number;
    homeworkId: number;
    title: string;
    revision: string;
  };

export type TronClassAgentStep = {
  id: string;
  tool: 'read_courses' | 'read_homework' | 'read_announcements' | 'read_materials'
    | 'prepare_homework' | 'select_target';
  status: 'completed' | 'partial' | 'blocked';
  message: string;
};

export type TronClassAgentReply = {
  source: 'tronclass';
  requestId: string;
  intent: TronClassAgentIntent;
  revision: string;
  grantVersion: string;
  fetchedAt: string;
  answer: string;
  selection: 'course' | 'homework' | null;
  snapshot: TronClassSnapshot | null;
  preparation: TronClassPreparation | null;
  actions: TronClassAgentAction[];
  capabilities: TronClassAgentCapabilities;
  steps: TronClassAgentStep[];
};

export type TronClassAgentAskInput = {
  question: string;
  courseId?: number;
  homeworkId?: number;
};
