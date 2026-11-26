'use client';

import { createContext, useContext, useLayoutEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';

export type AssistantWorkspaceEntryRequest = {
  prompt: string;
  workContext?: AssistantWorkContext;
  schoolId?: string | null;
};
/** An explicit course/group link belongs to its existing scoped reader. */
export function acceptsAssistantWorkspaceRoute(search: { get(key: string): string | null } | null | undefined) {
  return !search?.get('courseId') && !search?.get('groupId');
}
type EntryResult = { ok: true } | { ok: false; message: string };
export type AssistantWorkspaceEntryHandler = (entry: AssistantWorkspaceEntryRequest) => EntryResult;
export const AssistantWorkspaceHandoffContext = createContext<{
  register: (handler: AssistantWorkspaceEntryHandler) => () => void;
} | null>(null);

/** Only the mounted workspace engine receives an explicit entry. The handler
 * checks its own pending operations before changing a question or task profile. */
export function useAssistantWorkspaceHandoff(enabled: boolean, handler: AssistantWorkspaceEntryHandler) {
  const handoff = useContext(AssistantWorkspaceHandoffContext);
  const latest = useRef(handler);
  useLayoutEffect(() => { latest.current = handler; });
  useLayoutEffect(() => {
    if (!enabled || !handoff) return;
    return handoff.register((entry) => latest.current(entry));
  }, [enabled, handoff]);
}

export interface AssistantWorkspace {
  open: boolean;
  hasStarted: boolean;
  paused: boolean;
  draft: string;
  setDraft: Dispatch<SetStateAction<string>>;
  openWorkspace(options?: { workContext?: AssistantWorkContext }): void;
  /** Explicit entry only; never sends a request or silently replaces a draft. */
  requestEntry(entry: AssistantWorkspaceEntryRequest): boolean;
  minimize(restoreFocus?: boolean): void;
  scopeKey: string;
  /** Identity without route/campus; null only while initial identity is unknown.
   * A retained identity remains observable during a paused refresh. */
  identityKey: string | null;
}

export const ASSISTANT_WORKSPACE_ID = 'campus-assistant-workspace';
export const AssistantWorkspaceContext = createContext<AssistantWorkspace | null>(null);

export function useOptionalAssistantWorkspace(): AssistantWorkspace | null {
  return useContext(AssistantWorkspaceContext);
}
