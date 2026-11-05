'use client';

import { createContext, useContext } from 'react';

const AssistantEnabledContext = createContext(false);

export function AssistantEnabledProvider({ enabled, children }: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <AssistantEnabledContext.Provider value={enabled}>{children}</AssistantEnabledContext.Provider>;
}

export function useAssistantEnabled() {
  return useContext(AssistantEnabledContext);
}
