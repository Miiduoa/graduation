import type { NextRequest } from 'next/server';
import { NuniError } from '@campus/shared/src/nuni';
import type { TronClassRequiredAgentGrant } from '@campus/shared/src/tronClassAgentPermissions';
import { createTronClassAgentGrantService } from './tronClassAgentGrants';
import { createTronClassBindingService } from './tronClassBinding';
import { authenticateTronClassActor, type TronClassActor } from './tronClassIntegrationAuth';
import { handleTronClassMaterialDownload, type TronClassMaterialDownloadRouteDependencies } from './tronClassMaterialDownloadRoute';
import type { TronClassAgentGrants } from './tronClassAgent';

export type TronClassAgentDownloadRouteDependencies = TronClassMaterialDownloadRouteDependencies & { grants?: TronClassAgentGrants };

/** Reuse the bounded, origin-pinned downloader, adding revocable Agent grants. */
export function handleTronClassAgentDownload(request: NextRequest, dependencies: TronClassAgentDownloadRouteDependencies = {}): Promise<Response> {
  const grants = dependencies.grants ?? createTronClassAgentGrantService();
  const authenticate = dependencies.authenticate ?? authenticateTronClassActor;
  const bindings = dependencies.bindings ?? createTronClassBindingService();
  let original: TronClassActor | undefined;
  let grant: TronClassRequiredAgentGrant | undefined;
  const checkGrant = async (ownerKey: string) => {
    if (!grant || original?.ownerKey !== ownerKey) throw new NuniError(401, 'SIGN_IN_REQUIRED');
    await grants.assertCurrent(ownerKey, grant, 'readCourseData');
    await grants.assertCurrent(ownerKey, grant, 'downloadMaterials');
  };
  return handleTronClassMaterialDownload(request, {
    ...dependencies,
    authenticate: async (current) => {
      const actor = await authenticate(current);
      if (original) {
        if (actor.ownerKey !== original.ownerKey || actor.provider !== original.provider) throw new NuniError(409, 'SESSION_CHANGED');
        await checkGrant(actor.ownerKey);
      } else {
        original = actor;
        grant = await grants.require(actor.ownerKey, 'readCourseData');
        const download = await grants.require(actor.ownerKey, 'downloadMaterials');
        if (grant.version !== download.version || grant.revision !== download.revision) throw new NuniError(409, 'TRONCLASS_AGENT_PERMISSION_CHANGED');
      }
      return actor;
    },
    bindings: {
      requireBinding: bindings.requireBinding,
      assertCurrent: async (ownerKey, revision) => {
        if (!grant || grant.revision !== revision) throw new NuniError(409, 'TRONCLASS_BINDING_CHANGED');
        await bindings.assertCurrent(ownerKey, revision);
        await checkGrant(ownerKey);
      },
    },
  });
}
