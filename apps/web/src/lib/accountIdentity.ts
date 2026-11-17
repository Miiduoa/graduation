import { createNuniClasses, type NuniTransport } from '@campus/shared/src/nuni';
import {
  merchantApplicationStateLabel,
  merchantWorkspaceStateLabel,
  parseMerchantOverview,
  parseMerchantWorkspaces,
  type NuniMerchantWorkspace,
} from '@campus/shared/src/nuniMerchant';
import { merchantOverviewNextStep } from '@campus/shared/src/merchantJourney';

export const IDENTITY_LOOKUP_FAILED_COPY = '暫時查不到你的老師或店家身分';
export const IDENTITY_LOOKUP_FAILED_HINT = '不影響一般功能，請稍後再試一次';
export const IDENTITY_RETRY_COPY = '再試一次';
export const IDENTITY_NO_TEACHING_COPY = '這個帳號目前沒有授課課程';
export const IDENTITY_NO_MERCHANT_COPY = '目前沒有店家申請或已核准門市';
export const STORE_NOT_OPEN_COPY = '目前還不能開店';

export type TeachingIdentity = {
  id: string;
  name: string;
  role: '負責老師' | '協同教師' | '教學協作';
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

export type IdentityPart<T> =
  | { status: 'ok'; items: T }
  | { status: 'error' }
  | { status: 'pending' };

export type AccountIdentity = {
  teaching: IdentityPart<TeachingIdentity[]>;
  stores: IdentityPart<StoreIdentity[]>;
  applications: IdentityPart<ApplicationIdentity[]>;
  /** Only present when both merchant sources were successfully confirmed. */
  merchantNextStep?: ReturnType<typeof merchantOverviewNextStep>;
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
  { readTeaching = true }: { readTeaching?: boolean } = {},
): Promise<AccountIdentity> {
  const classes = createNuniClasses(transport, accountId);
  const [teaching, applications, workspaces] = await Promise.all([
    readTeaching
      ? settle(async () =>
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
        )
      : Promise.resolve<IdentityPart<TeachingIdentity[]>>({ status: 'ok', items: [] }),
    settle(
      async () =>
        parseMerchantOverview({
          programs: [],
          applications: ((await transport('merchant-applications')) as { applications?: unknown })
            .applications,
        }).applications,
    ),
    settle(async () => parseMerchantWorkspaces(await transport('merchant-workspaces'))),
  ]);
  return {
    teaching,
    stores:
      workspaces.status === 'ok'
        ? { status: 'ok', items: workspaces.items.map(storeLine) }
        : workspaces,
    applications:
      applications.status === 'ok'
        ? {
            status: 'ok',
            items: applications.items.map((item) => ({
              brand: item.brandName,
              progress: merchantApplicationStateLabel(item.state),
            })),
          }
        : applications,
    ...(applications.status === 'ok' && workspaces.status === 'ok'
      ? {
          merchantNextStep: merchantOverviewNextStep({
            applications: applications.items,
            workspaces: workspaces.items,
          }),
        }
      : {}),
  };
}
