import {
  isPlatformPublicTaskRoute,
  registerPlatformPublicTaskRoutes,
  type FastifyCandidate,
} from './fastify-candidate';
import { bindProvidencePublicCatalog } from './production-catalog';
import type { PlatformSessionResolver } from './admission';
import type { PublicAgentDatabase, PublicAgentPolicy } from './ledger';

type Source = Parameters<typeof bindProvidencePublicCatalog>[0];
type Places = Parameters<typeof bindProvidencePublicCatalog>[1];
export type PublicAgentHostOptions = { enabled: true; policy: PublicAgentPolicy };

/** Both the authorization exemption and registration must use the same opt-in. */
export function hostAllowsPublicTask(
  method: string,
  path: string,
  options?: PublicAgentHostOptions,
): boolean {
  return isPlatformPublicTaskRoute(method, path, options?.enabled === true);
}

/** Deliberately has no environment flag or provider: the existing API remains disabled by default. */
export function installPublicTaskHost(
  app: FastifyCandidate,
  db: PublicAgentDatabase,
  accounts: PlatformSessionResolver,
  source: Source,
  places: Places,
  options?: PublicAgentHostOptions,
): void {
  if (options?.enabled !== true) return;
  registerPlatformPublicTaskRoutes(app, {
    enabled: true,
    db,
    accounts,
    policy: options.policy,
    readPublicCatalog: bindProvidencePublicCatalog(source, places),
  });
}
