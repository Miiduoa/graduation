import { createDefaultAssistantWritePermissions } from './sharedPermissions';
export function effectivePermissions() {
  return createDefaultAssistantWritePermissions();
}
