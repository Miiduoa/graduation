import {
  isPlatformPublicTaskRoute,
  registerPlatformPublicTaskRoutes,
  type FastifyCandidate,
} from './fastify-candidate';
import { bindProvidencePublicCatalog } from './production-catalog';
import { createGroqNavigationPlanner } from './groq-navigation-plan';
import { createGroqServerTransport } from './groq-server-transport';
import type { PlatformSessionResolver } from './admission';
import type { PublicAgentDatabase, PublicAgentPolicy } from './ledger';

type Source = Parameters<typeof bindProvidencePublicCatalog>[0];
type Places = Parameters<typeof bindProvidencePublicCatalog>[1];
export type PublicAgentHostOptions = {
  enabled: true;
  policy: PublicAgentPolicy;
  /** Test-only candidate until a provider-enforced no-charge guarantee is established. */
  groqCandidate?: {
    credential: string;
    fetch: typeof fetch;
    freeOnlyGuard: (signal: AbortSignal) => Promise<boolean>;
  };
};

/** Both the authorization exemption and registration must use the same opt-in. */
export function hostAllowsPublicTask(
  method: string,
  path: string,
  options?: PublicAgentHostOptions,
): boolean {
  return isPlatformPublicTaskRoute(method, path, options?.enabled === true);
}

/** No runtime flag or credentials are configured here; existing API stays disabled. */
export function installPublicTaskHost(
  app: FastifyCandidate,
  db: PublicAgentDatabase,
  accounts: PlatformSessionResolver,
  source: Source,
  places: Places,
  options?: PublicAgentHostOptions,
): void {
  if (options?.enabled !== true) return;
  const readPublicCatalog = bindProvidencePublicCatalog(source, places);
  const groqPlan = options.groqCandidate
    ? createGroqNavigationPlanner({
        enabled: true,
        transport: createGroqServerTransport(options.groqCandidate),
        readPublicCatalog,
      })
    : undefined;
  registerPlatformPublicTaskRoutes(app, {
    enabled: true,
    db,
    accounts,
    policy: options.policy,
    readPublicCatalog,
    ...(groqPlan ? { groqPlan, freeTierVerified: true } : {}),
  });
}
