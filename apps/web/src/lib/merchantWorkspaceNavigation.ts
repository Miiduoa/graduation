import { validateMerchantWorkspaceIdentity } from '@campus/shared/src/nuniMerchantOperations';

export type MerchantWorkspaceSection = 'overview' | 'orders';
export type MerchantWorkspaceQueue = 'all' | 'incoming' | 'active';
export type MerchantWorkspaceLocation =
  | { status: 'list' }
  | { status: 'invalid' }
  | {
      status: 'selected';
      tenantId: string;
      locationId: string;
      section: MerchantWorkspaceSection;
      queue: MerchantWorkspaceQueue;
    };

type MerchantWorkspaceDestination = {
  tenantId: string;
  locationId: string;
  section?: MerchantWorkspaceSection;
  queue?: MerchantWorkspaceQueue;
};

const workspacePath = '/merchant/workspace';

function readSection(value: unknown): MerchantWorkspaceSection {
  return value === 'orders' ? 'orders' : 'overview';
}

function readQueue(value: unknown): MerchantWorkspaceQueue {
  return value === 'incoming' || value === 'active' ? value : 'all';
}

/** A location describes UI state only. The workspace must independently confirm access. */
export function readMerchantWorkspaceLocation(params: {
  getAll(name: string): string[];
}): MerchantWorkspaceLocation {
  const tenants = params.getAll('tenant');
  const locations = params.getAll('location');
  if (tenants.length === 0 && locations.length === 0) return { status: 'list' };
  if (tenants.length !== 1 || locations.length !== 1) return { status: 'invalid' };

  try {
    const identity = validateMerchantWorkspaceIdentity({
      tenantId: tenants[0],
      locationId: locations[0],
    });
    const sections = params.getAll('section');
    const queues = params.getAll('queue');
    return {
      status: 'selected',
      ...identity,
      section: readSection(sections.length === 1 ? sections[0] : undefined),
      queue: readQueue(queues.length === 1 ? queues[0] : undefined),
    };
  } catch {
    return { status: 'invalid' };
  }
}

/** Rebuild the known route without carrying credentials, confirmations or arbitrary queries. */
export function merchantWorkspaceHref(destination: MerchantWorkspaceDestination): string {
  try {
    const identity = validateMerchantWorkspaceIdentity({
      tenantId: destination.tenantId,
      locationId: destination.locationId,
    });
    const params = new URLSearchParams({
      tenant: identity.tenantId,
      location: identity.locationId,
    });
    const section = readSection(destination.section);
    const queue = readQueue(destination.queue);
    if (section !== 'overview') params.set('section', section);
    if (queue !== 'all') params.set('queue', queue);
    return `${workspacePath}?${params.toString()}`;
  } catch {
    return workspacePath;
  }
}
