'use client';

import { createContext, useContext } from 'react';

const SchoolLmsReadonlyContext = createContext(false);

export function SchoolLmsReadonlyProvider({ enabled, children }: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return <SchoolLmsReadonlyContext.Provider value={enabled}>{children}</SchoolLmsReadonlyContext.Provider>;
}

export function useSchoolLmsReadonlyEnabled() {
  return useContext(SchoolLmsReadonlyContext);
}
