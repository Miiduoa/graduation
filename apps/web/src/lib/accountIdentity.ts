import { createNuniClasses, type NuniTransport } from '@campus/shared/src/nuni';
import {
  merchantApplicationStateLabel,
  merchantWorkspaceStateLabel,
  parseMerchantOverview,
  parseMerchantWorkspaces,
  type NuniMerchantWorkspace,
} from '@campus/shared/src/nuniMerchant';

export const IDENTITY_LOOKUP_FAILED_COPY = '暫時無法確認老師／店家身分';
export const IDENTITY_NO_TEACHING_COPY = '這個帳號目前沒有授課課程';
export const IDENTITY_NO_MERCHANT_COPY = '目前沒有店家申請或已核准門市';
export const STORE_NOT_OPEN_COPY = '目前還不能開店';

export type TeachingIdentity = {
  id: string;
  name: string;
  role: '負責老師' | '協同教師';
  href: string;
};

export type StoreIdentity = {
  name: string;
  campus: string;
  status: string;
  open: boolean;
};

export type ApplicationIdentity = {
  brand: string;
  progress: string;
};

export type IdentityPart<T> = { status: 'ok'; items: T } | { status: 'error' };

export type AccountIdentity = {
  teaching: IdentityPart<TeachingIdentity[]>;
  stores: IdentityPart<StoreIdentity[]>;
  applications: IdentityPart<ApplicationIdentity[]>;
};

export function merchantLocationOpen(workspace: NuniMerchantWorkspace): boolean {
  return (
    workspace.activated &&
    workspace.merchantStatus === 'active' &&
    workspace.locationStatus === 'open' &&
    workspace.publicAccess
  );
}

function storeLine(workspace: NuniMerchantWorkspace): StoreIdentity {
  const open = merchantLocationOpen(workspace);
  return {
    name: workspace.merchantName,
    campus: workspace.campusName,
    status: open ? merchantWorkspaceStateLabel(workspace) : STORE_NOT_OPEN_COPY,
    open,
  };
}

async function settle<T>(load: () => Promise<T>): Promise<IdentityPart<T>> {
  try {
    return { status: 'ok', items: await load() };
  } catch {
    return { status: 'error' };
  }
}

export async function loadAccountIdentity(
  transport: NuniTransport,
  accountId: string,
): Promise<AccountIdentity> {
  const classes = createNuniClasses(transport, accountId);
  const [teaching, applications, workspaces] = await Promise.all([
    settle(async () =>
      (await classes.list())
        .filter((course) => course.state === 'active' && course.memberRole !== 'student')
        .map(
          (course): TeachingIdentity => ({
            id: course.id,
            name: course.title,
            role: course.memberRole === 'owner-teacher' ? '負責老師' : '協同教師',
            href: `/classroom/course/${encodeURIComponent(course.id)}`,
          }),
        ),
    ),
    settle(async () =>
      parseMerchantOverview({
        programs: [],
        applications: ((await transport('merchant-applications')) as { applications?: unknown })
          .applications,
      }).applications.map((item) => ({
        brand: item.brandName,
        progress: merchantApplicationStateLabel(item.state),
      })),
    ),
    settle(async () =>
      parseMerchantWorkspaces(await transport('merchant-workspaces')).map(storeLine),
    ),
  ]);
  return { teaching, stores: workspaces, applications };
}
