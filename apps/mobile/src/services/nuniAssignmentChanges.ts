// Only an authenticated workspace readback can invalidate an assistant snapshot.
// Listeners get identifiers; submission content and files stay in the workspace.
type NuniAssignmentChange = {
  accountId: string;
  context: string;
  workspaceId: string;
  assignmentId: string;
  submitted?: boolean;
};

const listeners = new Set<(change: NuniAssignmentChange) => void>();

export function subscribeNuniAssignmentChanges(listener: (change: NuniAssignmentChange) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function notifyNuniAssignmentChanged(change: NuniAssignmentChange) {
  for (const listener of listeners) listener(change);
}
