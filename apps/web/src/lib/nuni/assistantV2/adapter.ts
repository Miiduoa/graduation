import { createNuniFoodClient } from '@campus/shared/src/nuniFood';
import { isWebOnlineOrderingEnabled } from '../../onlineOrdering';
import { operationSignal } from './operation';
import { createNuniClasses, parseNuniPrincipal } from '@campus/shared/src/nuni';
import {
  parsePersonalImportSnapshot,
  PERSONAL_IMPORT_SYNC_BODY_LIMIT,
  validatePersonalImportSyncRecords,
} from '@campus/shared/src/imports/sync';
import { createTransitService, validateTransitQuery } from '../../transit-server';
import { apiOrigin, boundedJson, type PlatformSession } from '../server';
import { bounded, id, object, V2Error, type Adapter, type Obj } from './contracts';
function rows(raw: unknown, key: string, limit = 5): Obj[] {
  const v = object(raw);
  if (!Array.isArray(v[key])) throw new V2Error(502, 'INVALID_RESPONSE');
  return (v[key] as unknown[]).slice(0, limit).map((v) => object(v));
}
const value = (v: unknown, max = 120) => (typeof v === 'string' ? v.slice(0, max) : '');
export function createAdapter(session: PlatformSession, schoolId: string, signal: AbortSignal) {
  let apiCalls = 0;
  const request = async (
    path: string,
    input?: Obj,
    query?: Record<string, string>,
    isPublic = false,
  ) => {
    signal.throwIfAborted();
    operationSignal()?.throwIfAborted();
    if (++apiCalls > 12) throw new V2Error(429, 'API_BUDGET_EXCEEDED');
    if (!/^[A-Za-z0-9/_-]+$/.test(path)) throw new V2Error(422, 'INVALID_INPUT');
    const local = AbortSignal.any([
      signal,
      ...(operationSignal() ? [operationSignal()!] : []),
      AbortSignal.timeout(4000),
    ]);
    return bounded(
      async () => {
        const response = await fetch(
          `${apiOrigin()}/${isPublic ? 'v1/public/' : 'v1/auth/platform/'}${path}${query ? '?' + new URLSearchParams(query) : ''}`,
          {
            method: input ? 'POST' : 'GET',
            cache: 'no-store',
            redirect: 'error',
            signal: local,
            headers: {
              Accept: 'application/json',
              ...(!isPublic ? { Authorization: 'Platform ' + session.sessionHandle } : {}),
              ...(input ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(input ? { body: JSON.stringify(input) } : {}),
          },
        );
        const data = await boundedJson(
          response,
          path.startsWith('personal-imports') ? PERSONAL_IMPORT_SYNC_BODY_LIMIT : 262144,
        );
        if (!response.ok) {
          const error = object(data).error;
          const code =
            typeof error === 'string'
              ? error
              : error && typeof error === 'object'
                ? (error as Obj).code
                : '';
          throw new V2Error(
            response.status,
            typeof code === 'string' && /^[A-Z_]{1,80}$/.test(code) ? code : 'UPSTREAM_UNAVAILABLE',
          );
        }
        return data;
      },
      local,
      4000,
    );
  };
  let verifiedPrincipal: ReturnType<typeof parseNuniPrincipal> | undefined;
  const classes = createNuniClasses(
    (path, input, query) => request(path, input, query),
    async () => {
      if (!verifiedPrincipal) throw new V2Error(401, 'UNAUTHENTICATED');
      return verifiedPrincipal.platformAccountId;
    },
  );
  const transit = createTransitService({
    credentials: () => ({
      clientId: process.env.TDX_CLIENT_ID,
      clientSecret: process.env.TDX_CLIENT_SECRET,
    }),
    fetcher: async (url, init) => {
      if (++apiCalls > 12) throw new V2Error(429, 'API_BUDGET_EXCEEDED');
      return fetch(url, {
        ...init,
        signal: AbortSignal.any([
          signal,
          ...(operationSignal() ? [operationSignal()!] : []),
          AbortSignal.timeout(4000),
        ]),
        redirect: 'error',
      });
    },
  });
  function scopedRealm(r: Obj) {
    const tenantId = id(r.tenantId);
    if (typeof r.schoolId === 'string') return { tenantId, schoolId: id(r.schoolId) };
    try {
      const map = object(JSON.parse(process.env.CAMPUS_ASSISTANT_V2_REALM_MAP || '{}'));
      const tenants = map[schoolId];
      if (
        Array.isArray(tenants) &&
        tenants.length <= 20 &&
        tenants.every((t) => typeof t === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(t)) &&
        tenants.includes(tenantId)
      )
        return { tenantId, schoolId };
    } catch {
      /* Missing mapping cannot authorize a school scope. */
    }
    return { tenantId };
  }
  const food = createNuniFoodClient((path, input, query) => request(path, input, query));
  const adapter: Adapter = {
    food: {
      onlineEnabled: () => isWebOnlineOrderingEnabled(),
      enabled: () =>
        isWebOnlineOrderingEnabled() && process.env.CAMPUS_ASSISTANT_V2_ORDERING_ENABLED === 'true',
      // Existing createOrder always creates awaiting_payment; never invoke it here.
      paymentRequired: true,
      locations: (tenant) => food.listLocations(tenant, { limit: 5 }),
      menu: (tenant, location) => food.getMenu(tenant, location),
      submit: async () => {
        throw new V2Error(403, 'PAYMENT_REQUIRED');
      },
    },
    simulation: false,
    remainingApiCalls: () => Math.max(0, 12 - apiCalls),
    ledger: async () =>
      parsePersonalImportSnapshot(await request('personal-imports/read', { schoolId }), schoolId),
    courses: async () =>
      (await classes.list())
        .filter((c) => c.state === 'active' && c.memberRole === 'student')
        .map((c) => ({ id: c.id, title: c.title })),
    work: async (courseId) => {
      if (12 - apiCalls < 2) throw new V2Error(429, 'API_BUDGET_EXCEEDED');
      const [assignments, quizzes] = await Promise.all([
        classes.assignments(courseId),
        classes.quizzes(courseId),
      ]);
      return [
        ...assignments.map((a) => ({
          id: a.id,
          courseId,
          title: a.title,
          dueAt: a.dueAt,
          submitted: Boolean(a.mySubmission?.submittedAt),
          kind: 'assignment' as const,
          state: a.state,
        })),
        ...quizzes.map((a) => ({
          id: a.id,
          courseId,
          title: a.title,
          dueAt: a.dueAt,
          submitted: Boolean(a.myResponse?.submittedAt),
          kind: 'quiz' as const,
          state: a.state,
        })),
      ];
    },
    materials: async (courseId, cursor) => {
      const page = await classes.materialsPage(courseId, cursor);
      return {
        materials: page.materials.slice(0, 5).map((m) => ({
          id: m.id,
          title: m.title,
          createdAt: m.createdAt,
          href: '/classroom/course/' + encodeURIComponent(courseId),
        })),
        nextCursor: page.materials.length > 5 ? undefined : page.nextCursor,
        truncated: page.materials.length > 5,
        completePageHref: '/classroom/course/' + encodeURIComponent(courseId),
        note:
          page.materials.length > 5 ? '本頁僅顯示前五筆，請開啟完整課程頁查看其餘教材' : undefined,
      };
    },
    realms: async () =>
      rows(await request('realms'), 'realms', 100)
        .map(scopedRealm)
        .filter((r) => r.schoolId === schoolId),
    orders: async (tenantId, cursor, options) => {
      const raw = await request(`realms/${id(tenantId)}/food/orders`, undefined, {
        limit: String(options?.limit || 5),
        ...(options?.state ? { state: options.state } : {}),
        ...(cursor ? { cursor } : {}),
      });
      return {
        orders: rows(raw, 'orders').map((r) => ({
          id: id(r.id),
          state: value(r.state),
          title: value(r.locationName),
        })),
        nextCursor: value(object(raw).nextCursor, 100) || undefined,
      };
    },
    order: async (tenantId, orderId) => {
      const r = object(await request(`realms/${id(tenantId)}/food/orders/${id(orderId)}`));
      if (r.id !== orderId) throw new V2Error(502, 'INVALID_RESPONSE');
      const pickup = r.pickup && typeof r.pickup === 'object' ? object(r.pickup) : {};
      return {
        id: value(r.id),
        state: value(r.state),
        location: value(r.locationName),
        locationId: value(r.locationId),
        requestedPickupAt: value(r.requestedPickupAt),
        pickupNumber: value(pickup.displayCode),
        readyAt: value(pickup.readyAt),
        lines: Array.isArray(r.lines)
          ? r.lines.slice(0, 5).map((line) => {
              const item = object(line);
              return {
                menuItemId: value(item.menuItemId),
                name: value(item.nameSnapshot),
                selectedOptions: Array.isArray(item.selectedOptions)
                  ? item.selectedOptions.slice(0, 20).map((o) => ({
                      name: value(object(o).nameSnapshot),
                      optionId: value(object(o).optionId),
                    }))
                  : [],
                quantity: Number.isSafeInteger(item.quantity) ? item.quantity : null,
              };
            })
          : [],
        updatedAt: value(r.updatedAt),
      };
    },
    clubs: async (tenantId, membership, cursor) => {
      const raw = await request(`realms/${id(tenantId)}/social/communities`, undefined, {
        kind: 'club',
        membership,
        limit: '5',
        ...(cursor ? { cursor } : {}),
      });
      return {
        communities: rows(raw, 'communities').map((r) => ({
          id: id(r.id),
          title: value(r.title || r.name),
        })),
        nextCursor: value(object(raw).nextCursor, 100) || undefined,
      };
    },
    feed: async (tenantId, communityId, cursor) => {
      const raw = await request(`realms/${id(tenantId)}/social/feed`, undefined, {
        mode: 'community',
        communityId,
        limit: '5',
        ...(cursor ? { cursor } : {}),
      });
      return {
        posts: rows(raw, 'items').map((r) => {
          const post = object(r.post || r);
          return {
            title: value(post.title),
            text: value(post.text, 200),
            createdAt: value(post.createdAt),
          };
        }),
        source: 'social/feed; untrusted content',
      };
    },
    dining: async (locationId) => {
      const raw = await request(
        `schools/${schoolId}/cafeterias${locationId ? '/' + id(locationId) : ''}`,
        undefined,
        undefined,
        true,
      );
      return {
        cafeterias: (locationId
          ? [object(object(raw).cafeteria || raw)]
          : rows(raw, 'cafeterias')
        ).map((r) => ({
          id: id(r.id),
          name: value(r.name),
          openingHours: value(r.openingHours),
          location: value(r.location),
        })),
        menus: Array.isArray(object(raw).menus)
          ? (object(raw).menus as unknown[]).slice(0, 5).map((item) => {
              const r = object(item);
              return {
                name: value(r.name),
                price: typeof r.price === 'number' ? r.price : null,
                available: r.available === true,
              };
            })
          : [],
        source: 'public cafeteria catalog; 價格/菜單可能缺漏',
      };
    },
    transit: async (args) => transit(validateTransitQuery(args)),
    notifications: async () => ({ unavailable: 'NOT_CONNECTED' }),
    write: async (input) => {
      validatePersonalImportSyncRecords(input.records, schoolId);
      return parsePersonalImportSnapshot(await request('personal-imports/write', input), schoolId);
    },
  };
  return {
    adapter,
    async principal() {
      verifiedPrincipal = parseNuniPrincipal(await request('sessions/current'));
      return verifiedPrincipal;
    },
    apiCalls: () => apiCalls,
  };
}
