'use client';

import { createContext, useContext, type Dispatch, type SetStateAction } from 'react';
import type { AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';

export interface AssistantWorkspace {
  open: boolean;
  hasStarted: boolean;
  paused: boolean;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  openWorkspace(options?: { workContext?: AssistantWorkContext }): void;
  minimize(restoreFocus?: boolean): void;
  scopeKey: string;
}

export const ASSISTANT_WORKSPACE_ID = 'campus-assistant-workspace';
export const AssistantWorkspaceContext = createContext<AssistantWorkspace | null>(null);

export function useOptionalAssistantWorkspace(): AssistantWorkspace | null {
  return useContext(AssistantWorkspaceContext);
}
