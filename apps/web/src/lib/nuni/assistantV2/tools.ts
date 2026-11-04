import { cartArgs, foodHref, priceCart } from './food';
import { operationSignal, withOperationSignal } from './operation';
import {
  getOfficialCampusMapUrl,
  PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL,
} from '@campus/shared/src/campusMapLookup';
import { buildPersonalToday } from '@campus/shared/src/imports/today';
import { beginProposal, eventInterval, pageArgs, pageHref, signCard } from './actions';
import {
  addDays,
  bounded,
  canonical,
  clock,
  date,
  eventArgs,
  fail,
  id,
  object,
  taipeiDate,
  text,
  type Adapter,
  type Binding,
  type Card,
  type Ledger,
  type Obj,
  type Task,
} from './contracts';
const s = { type: 'string', maxLength: 100 };
const d = { type: 'string', format: 'date' };
const t = { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' };
const definitions: Record<string, [Obj, string[]]> = {
  get_food_locations: [{ tenantId: s }, []],
  get_food_menu: [{ tenantId: s, locationId: s }, []],
  propose_food_order: [
    {
      tenantId: s,
      locationId: s,
      requestedPickupAt: { type: 'string', maxLength: 40 },
      items: {
        type: 'array',
        minItems: 1,
        maxItems: 5,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            menuItemId: s,
            quantity: { type: 'integer', minimum: 1, maximum: 20 },
            selectedOptionIds: { type: 'array', items: s, maxItems: 20 },
          },
          required: ['menuItemId', 'quantity', 'selectedOptionIds'],
        },
      },
    },
    ['tenantId', 'locationId', 'requestedPickupAt', 'items'],
  ],
  reorder_last_food_order: [{ tenantId: s, requestedPickupAt: { type: 'string', maxLength: 40 } }, []],
  get_due_work: [{ from: d, to: d }, []],
  get_day_overview: [{ date: d }, ['date']],
  get_today_context: [{}, []],
  get_schedule: [{ from: d, to: d }, ['from', 'to']],
  get_calendar: [{ from: d, to: d }, ['from', 'to']],
  list_courses: [{}, []],
  get_course_work: [{ workspaceId: s, kind: { enum: ['assignments', 'quizzes', 'both'] } }, []],
  get_materials: [{ workspaceId: s, cursor: { type: 'string', maxLength: 500 } }, []],
  list_food_orders: [
    {
      tenantId: s,
      state: {
        enum: [
          'payment-pending',
          'paid',
          'accepted',
          'cancellation-pending-refund',
          'rejection-pending-refund',
          'rejected',
          'preparing',
          'ready',
          'fulfilled',
          'canceled',
          'payment-expired',
        ],
      },
      limit: { type: 'integer', minimum: 1, maximum: 5 },
      cursor: { type: 'string', maxLength: 500 },
    },
    [],
  ],
  get_food_order: [{ tenantId: s, orderId: s }, ['tenantId', 'orderId']],
  get_dining: [{ locationId: s }, []],
  list_clubs: [
    {
      tenantId: s,
      membership: { enum: ['joined', 'all'] },
      cursor: { type: 'string', maxLength: 500 },
    },
    [],
  ],
  get_club_feed: [
    { tenantId: s, communityId: s, cursor: { type: 'string', maxLength: 500 } },
    ['tenantId', 'communityId'],
  ],
  get_campus_info: [
    { kind: { enum: ['map', 'library', 'bus', 'announcements', 'events'] } },
    ['kind'],
  ],
  get_transit: [{ action: { enum: ['campus', 'arrivals'] }, city: s, stopId: s }, ['action']],
  get_notifications: [{ limit: { type: 'integer', minimum: 1, maximum: 5 } }, []],
  find_free_time: [
    { date: d, from: t, to: t, minMinutes: { type: 'integer', minimum: 15, maximum: 480 } },
    ['date'],
  ],
  propose_personal_event: [
    {
      title: { type: 'string', maxLength: 120 },
      date: d,
      endDate: d,
      allDay: { type: 'boolean' },
      startTime: t,
      endTime: t,
    },
    ['title', 'date', 'allDay'],
  ],
  propose_study_plan: [
    {
      date: d,
      from: t,
      to: t,
      minMinutes: { type: 'integer', minimum: 15, maximum: 180 },
      taskIds: { type: 'array', items: s, minItems: 1, maxItems: 4 },
    },
    ['date'],
  ],
  propose_open_page: [
    {
      page: {
        enum: [
          'today',
          'timetable',
          'calendar',
          'classroom',
          'orders',
          'clubs',
          'map',
          'bus',
          'cafeteria',
          'announcements',
          'events',
        ],
      },
      entityId: s,
    },
    ['page'],
  ],
};
export function studyTitle(title: string): string {
  const clean = title
    .replace(/作[」』”"']\s*作業/g, '作業')
    .replace(/[「」『』“”\"']/g, '')
    .replace(/^(?:寫作業[：:]?\s*|寫\s*)+/, '')
    .trim();
  return ('寫作業：' + clean.replace(/作業(?:作業)+/g, '作業')).slice(0, 120);
}
export const toolNames = Object.keys(definitions);
export function selectTools(question: string, simulation: boolean): string[] {
  const out = new Set<string>(['get_today_context', 'propose_open_page']);
  const add = (...names: string[]) => names.forEach((n) => out.add(n));
  if (/作業|測驗|要交|規劃|排|剛剛|剛才/.test(question))
    add(
      'get_due_work',
      'get_day_overview',
      'get_course_work',
      'find_free_time',
      'propose_personal_event',
      'propose_study_plan',
    );
  if (/行程|事件|今晚|今夜|明晚/.test(question)) add('propose_personal_event');
  if (/課|有空|下午|行程|規劃/.test(question))
    add('get_schedule', 'get_calendar', 'find_free_time');
  if (/教材/.test(question)) add('list_courses', 'get_materials');
  if (/吃|中午|餐廳|規劃/.test(question)) add('get_dining');
  if (/訂|餐好了|點餐|幫我點|再點|跟上次一樣/.test(question))
    add(
      'get_food_locations',
      'get_food_menu',
      'propose_food_order',
      'list_food_orders',
      'get_food_order',
      'reorder_last_food_order',
    );
  if (/社團/.test(question)) add('list_clubs', 'get_club_feed');
  if (/圖書館|怎麼走|公車|交通|到站|地圖|公告|活動/.test(question))
    add('get_campus_info', 'get_transit');
  if (/通知/.test(question) && simulation) add('get_notifications');
  // Prioritize the requested domain, retaining proposals for planning questions.
  if (/點餐|幫我點|再點|跟上次一樣/.test(question)) {
    out.delete('get_today_context');
    out.delete('propose_open_page');
    out.delete('get_dining');
  }
  if (/規劃|安排|排寫/.test(question)) {
    out.delete('propose_open_page');
    out.delete('propose_personal_event');
    out.delete('get_schedule');
    out.delete('get_calendar');
    out.delete('get_course_work');
  }
  if (/點餐|幫我點/.test(question) && !/再點|上次/.test(question)) {
    out.delete('list_food_orders');
    out.delete('get_food_order');
    out.delete('reorder_last_food_order');
  }
  if (/再點|跟上次一樣/.test(question))
    return ['reorder_last_food_order', 'propose_food_order', 'get_food_menu', 'list_food_orders'];
  const names = [...out];
  if (names.length > 8) names.splice(names.indexOf('propose_open_page'), 1);
  if (names.length > 8 && names.includes('find_free_time'))
    names.splice(names.indexOf('get_calendar'), 1);
  if (/規劃|安排|排寫/.test(question))
    return [
      'get_day_overview',
      'get_today_context',
      'get_due_work',
      'find_free_time',
      'propose_study_plan',
      ...(/吃|餐廳|中午/.test(question) ? ['get_dining'] : []),
    ];
  const priority = /規劃|安排|排寫/.test(question)
    ? ['get_day_overview', 'get_due_work', 'find_free_time', 'propose_study_plan']
    : [];
  return [...new Set([...priority, ...names])].slice(0, 8);
}
export const schemas = (names: string[]) =>
  names.map((name) => ({
    type: 'function',
    function: {
      name,
      parameters: {
        type: 'object',
        properties: JSON.parse(JSON.stringify(definitions[name][0], (key, value) =>
          ['maxLength', 'minItems', 'maxItems', 'pattern'].includes(key) ? undefined : value,
        )),
        required: definitions[name][1],
        additionalProperties: false,
      },
    },
  }));
export function validateTool(name: string, raw: unknown): Obj {
  if (!Object.hasOwn(definitions, name)) return fail('UNKNOWN_TOOL');
  const [props, required] = definitions[name];
  const a = object(raw, Object.keys(props));
  if (required.some((k) => a[k] === undefined)) return fail();
  if (name === 'propose_food_order') return { ...cartArgs(a) };
  for (const [key, value] of Object.entries(a)) {
    const spec = props[key] as Obj;
    if (spec.enum && !(spec.enum as unknown[]).includes(value)) return fail();
    if (spec.type === 'string') {
      if (spec.format === 'date') date(value);
      else if (key === 'from' || key === 'to' || key.endsWith('Time')) clock(value);
      else if (key === 'cursor') {
        if (!/^[A-Za-z0-9_-]{1,500}$/.test(text(value, 500))) return fail();
      } else if (key.endsWith('Id')) id(value);
      else text(value, Number(spec.maxLength || 100));
    }
    if (spec.type === 'boolean' && typeof value !== 'boolean') return fail();
    if (
      spec.type === 'integer' &&
      (!Number.isInteger(value) ||
        Number(value) < Number(spec.minimum) ||
        Number(value) > Number(spec.maximum))
    )
      return fail();
    if (
      spec.type === 'array' &&
      (!Array.isArray(value) ||
        value.length < 1 ||
        value.length > 4 ||
        value.some((v) => {
          id(v);
          return false;
        }))
    )
      return fail();
  }
  if (name === 'propose_personal_event') return { ...eventArgs(a) };
  if (name === 'propose_open_page') return pageArgs(a);
  if (
    name === 'get_transit' &&
    (a.action === 'arrivals' ? !a.city || !a.stopId : a.city || a.stopId)
  )
    return fail();
  if (name === 'get_schedule' || name === 'get_calendar' || name === 'get_due_work') {
    if (
      String(a.from || '0000') > String(a.to || '9999') ||
      Date.parse(String(a.to)) - Date.parse(String(a.from)) >
        (name === 'get_schedule' ? 6 : 30) * 86400000
    )
      return fail();
  }
  if (
    ['find_free_time', 'propose_study_plan'].includes(name) &&
    String(a.from || '08:00') >= String(a.to || '22:00')
  )
    return fail();
  return a;
}
export function schedule(ledger: Ledger, from: string, to: string) {
  const result: {
    title: string;
    location: string;
    date: string;
    startTime: string;
    endTime: string;
    start: number;
    end: number;
  }[] = [];
  let unplaced = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const data = buildPersonalToday(ledger.records, {
      schoolId: ledger.schoolId,
      now: new Date(day + 'T12:00:00+08:00'),
    });
    unplaced = Math.max(unplaced, data.unplacedCount);
    for (const c of data.today)
      result.push({
        title: c.row.title,
        location: c.row.location || '未提供',
        date: day,
        startTime: c.startTime,
        endTime: c.endTime,
        start: c.startAt,
        end: c.endAt,
      });
  }
  return { classes: result, unplaced, source: 'personal-imports', updatedAt: ledger.updatedAt };
}
export function calendar(ledger: Ledger, from: string, to: string) {
  return ledger.records
    .filter((r) => r.kind === 'events' && r.date && r.date <= to && (r.endDate || r.date) >= from)
    .map((r) => ({
      title: r.title,
      date: r.date!,
      endDate: r.endDate,
      startTime: r.startTime,
      endTime: r.endTime,
      allDay: r.allDay ?? !r.startTime,
    }));
}
export function freeTime(ledger: Ledger, args: Obj) {
  const day = date(args.date),
    from = String(args.from || '08:00'),
    to = String(args.to || '22:00'),
    duration = Number(args.minMinutes || 60);
  const start = Date.parse(`${day}T${from}:00+08:00`),
    end = Date.parse(`${day}T${to}:00+08:00`);
  const classes = schedule(ledger, day, day);
  const busy: [number, number][] = classes.classes.map((c) => [c.start, c.end]);
  for (const e of calendar(ledger, addDays(day, -31), day)) {
    try {
      busy.push(eventInterval(eventArgs(e)));
    } catch {
      return fail('CALENDAR_INCOMPLETE', 409);
    }
  }
  if (classes.unplaced) return fail('SCHEDULE_INCOMPLETE', 409);
  let cursor = start;
  const slots: { date: string; startTime: string; endTime: string; minutes: number }[] = [];
  const append = (a: number, b: number) => {
    if (b - a >= duration * 60000)
      slots.push({
        date: day,
        startTime: new Date(a + 28800000).toISOString().slice(11, 16),
        endTime: new Date(b + 28800000).toISOString().slice(11, 16),
        minutes: (b - a) / 60000,
      });
  };
  for (const [a, b] of busy.sort((a, b) => a[0] - b[0])) {
    if (b <= start || a >= end) continue;
    append(cursor, Math.min(a, end));
    cursor = Math.max(cursor, Math.min(b, end));
  }
  append(cursor, end);
  return { slots, source: 'personal-imports', coverage: '僅已同步資料，未同步裝置資料不包含在內' };
}
export function createTools(
  adapter: Adapter,
  binding: Binding,
  secret: string,
  now: number,
  writes: boolean,
  reorder = false,
) {
  const cache = new Map<string, Promise<unknown>>();
  let ledger: Promise<Ledger> | undefined;
  let courses: Promise<{ id: string; title: string }[]> | undefined;
  let contextCache: Promise<Obj> | undefined;
  const workCache = new Map<string, Promise<Task[]>>();
  let realms: Promise<{ tenantId: string; schoolId?: string }[]> | undefined;
  const tasks = new Map<string, Task>();
  const orders = new Set<string>(),
    clubs = new Set<string>();
  const cards: Card[] = [];
  let proposalSeq: string | undefined;
  const sequence = () => (proposalSeq ||= beginProposal(binding, now));
  const diningIds = new Set<string>();
  const foodLocations = new Set<string>();
  const getLedger = () =>
    (ledger ||= adapter.ledger().then((value) => {
      if (value.schoolId !== binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
      return value;
    }));
  const courseIds: string[] = [],
    tenantIds: string[] = [];
  let courseCoveragePartial = false;
  const getCourses = () =>
    (courses ||= adapter.courses().then(({ courses: rows, partial }) => {
      courseCoveragePartial = partial;
      courseIds.push(...rows.map((c) => c.id));
      return rows;
    }));
  const getRealms = () =>
    (realms ||= adapter.realms().then((rows) => {
      tenantIds.push(...rows.filter((r) => r.schoolId === binding.schoolId).map((r) => r.tenantId));
      return rows;
    }));
  async function course(a: Obj) {
    if (!(await getCourses()).some((c) => c.id === a.workspaceId))
      return fail('FORBIDDEN_SCOPE', 403);
  }
  async function tenant(a: Obj) {
    const visible = (await getRealms()).filter((r) => r.schoolId === binding.schoolId);
    const matched = visible.filter((r) => r.tenantId.toLowerCase() === String(a.tenantId || '').toLowerCase());
    if (matched.length === 1) a.tenantId = matched[0].tenantId;
    if (!a.tenantId && visible.length === 1) a.tenantId = visible[0].tenantId;
    if (
      !(await getRealms()).some((r) => r.tenantId === a.tenantId && r.schoolId === binding.schoolId)
    )
      return fail('FORBIDDEN_SCOPE', 403);
  }
  async function work(courseId: string) {
    if (!workCache.has(courseId)) workCache.set(courseId, adapter.work(courseId));
    const found = await workCache.get(courseId)!;
    found.forEach((t) => tasks.set(t.id, t));
    return found;
  }
  async function dueWork(a: Obj) {
    const from = date(a.from || taipeiDate(now)),
      to = date(a.to || addDays(from, 6));
    if (to < from || Date.parse(to) - Date.parse(from) > 30 * 86400000) return fail();
    const list = await getCourses();
    const unqueried: { id: string; title: string; reason: string }[] = [];
    const found: Task[] = [];
    // Reserve whole assignment/quiz pairs before starting parallel work.
    let remaining = adapter.remainingApiCalls?.() ?? 12;
    const selected = list.filter((c) => {
      if (workCache.has(c.id)) return true;
      if (remaining < 2) {
        unqueried.push({ ...c, reason: 'API_BUDGET_EXCEEDED' });
        return false;
      }
      remaining -= 2;
      return true;
    });
    await Promise.all(
      selected.map(async (c) => {
        try {
          found.push(
            ...(await bounded(
              (child) => withOperationSignal(child, () => work(c.id)),
              operationSignal() || new AbortController().signal,
              3000,
            )),
          );
        } catch (e) {
          if ((e as { status?: number }).status === 401) throw e;
          unqueried.push({ ...c, reason: (e as { code?: string }).code || 'UNAVAILABLE' });
        }
      }),
    );
    found.sort((a, b) => String(a.dueAt || '9999').localeCompare(String(b.dueAt || '9999')));
    const end = Date.parse(addDays(to, 1) + 'T00:00:00+08:00');
    const start = Date.parse(from + 'T00:00:00+08:00');
    const inRange = (t: Task) => Boolean(t.dueAt && Date.parse(t.dueAt) >= start && Date.parse(t.dueAt) < end);
    const pending = found.filter((t) => !t.submitted && t.state === 'open');
    return {
      from,
      to,
      pending: pending.filter(
        (t) => t.dueAt && Date.parse(t.dueAt) >= Math.max(now, start) && Date.parse(t.dueAt) < end,
      ),
      undated: pending.filter((t) => !t.dueAt),
      submitted: found.filter((t) => t.submitted && inRange(t)),
      overdue: found.filter((t) => !t.submitted && inRange(t) && t.dueAt && Date.parse(t.dueAt) < now),
      partial: courseCoveragePartial || unqueried.length > 0,
      unqueried,
      source: 'class-workspaces',
    };
  }
  async function propose(raw: Obj) {
    if (!writes)
      return {
        unavailable: 'WRITES_DISABLED',
        href: pageHref({ page: 'calendar' }, binding.schoolId),
      };
    if (typeof raw.title === 'string' && /^寫/.test(raw.title))
      raw = { ...raw, title: studyTitle(raw.title) };
    const l = await getLedger(),
      e = eventArgs(raw),
      [start, end] = eventInterval(e);
    const classes = schedule(l, e.date, e.endDate || e.date);
    if (classes.unplaced) return fail('SCHEDULE_INCOMPLETE', 409);
    if (
      classes.classes.some((c) => c.start < end && start < c.end) ||
      cards.some((c) => {
        if (c.tool !== 'propose_personal_event') return false;
        const [a, b] = eventInterval(eventArgs(c.args));
        return a < end && start < b;
      }) ||
      calendar(l, addDays(e.date, -31), e.endDate || e.date).some((c) => {
        const [a, b] = eventInterval(eventArgs(c));
        return a < end && start < b;
      })
    )
      return fail('EVENT_CONFLICT', 409);
    const priorEvents = cards.filter((card) => card.tool === 'propose_personal_event');
    const card = signCard(
      binding,
      'propose_personal_event',
      raw,
      l.revision + priorEvents.length,
      secret,
      now,
      sequence(),
      priorEvents.at(-1),
    );
    cards.push(card);
    return { proposed: true, ...raw, requiresConfirmation: true };
  }
  async function dispatch(name: string, raw: unknown): Promise<unknown> {
    const a = validateTool(name, raw);
    switch (name) {
      case 'get_food_locations': {
        if (!a.tenantId) {
          const visible = (await getRealms()).filter((r) => r.schoolId === binding.schoolId);
          if (visible.length !== 1)
            return {
              realms: visible.slice(0, 5),
              nextStep:
                '使用上述 tenantId 呼叫 get_food_locations；沒有 realm 表示目前 scope 未連接',
            };
        }
        await tenant(a);
        if (!adapter.food) return { unavailable: 'NOT_CONNECTED' };
        const data = object(await adapter.food.locations(String(a.tenantId)));
        if (Array.isArray(data.locations))
          data.locations.forEach((v) => foodLocations.add(a.tenantId + ':' + id(object(v).id)));
        return {
          locations: Array.isArray(data.locations)
            ? data.locations.map((v) => {
                const row = object(v);
                return { tenantId: a.tenantId, id: row.id, name: row.name, state: row.state };
              })
            : [],
          truncated: Boolean(data.nextCursor),
          completePageHref: '/food?tenant=' + encodeURIComponent(String(a.tenantId)),
        };
      }
      case 'get_food_menu': {
        await tenant(a);
        if (!a.locationId)
          return {
            ...object(await dispatch('get_food_locations', { tenantId: a.tenantId })),
            nextStep: '用上述 location id 呼叫 get_food_menu',
          };
        if (!adapter.food || !foodLocations.has(a.tenantId + ':' + a.locationId))
          return fail('FORBIDDEN_SCOPE', 403);
        const menu = await adapter.food.menu(String(a.tenantId), String(a.locationId));
        return {
          locationId: menu.location.id,
          items: menu.sections
            .flatMap((s) => s.items)
            .filter((i) => i.available)
            .slice(0, 5)
            .map((item) => ({
              id: item.id,
              name: item.name,
              amountMinor: item.basePrice.amountMinor,
              tags: item.dietaryTags,
              groups: item.optionGroups.map((g) => ({
                min: g.minimumSelections,
                max: g.maximumSelections,
                options: g.options
                  .filter((o) => o.available)
                  .map((o) => ({ id: o.id, name: o.name, deltaMinor: o.priceDelta.amountMinor })),
              })),
            })),
          partial: true,
          completePageHref:
            '/food?tenant=' +
            encodeURIComponent(String(a.tenantId)) +
            '&location=' +
            encodeURIComponent(String(a.locationId)),
        };
      }
      case 'propose_food_order': {
        await tenant(a);
        if (!adapter.food || !foodLocations.has(a.tenantId + ':' + a.locationId))
          return fail('FORBIDDEN_SCOPE', 403);
        const cart = cartArgs(a);
        if (Date.parse(cart.requestedPickupAt) <= now) return fail('INVALID_PICKUP_TIME');
        const summary = priceCart(cart, await adapter.food.menu(cart.tenantId, cart.locationId));
        const mode = adapter.food.enabled() && !adapter.food.paymentRequired ? 'order' : 'page';
        const args = {
          cart,
          summary,
          mode,
          href: foodHref(cart),
          reason: !(adapter.food.onlineEnabled?.() ?? adapter.food.enabled())
            ? '線上點餐尚未開放；帶到點餐頁'
            : !adapter.food.enabled()
              ? '助理下單尚未開放；帶到點餐頁'
              : adapter.food.paymentRequired
                ? '此訂單需付款，請到點餐頁完成'
                : '確認後下單，自取',
        };
        cards.push(signCard(binding, name, args, 0, secret, now, sequence()));
        return { proposed: true, mode, reason: args.reason, summary, href: args.href, requiresConfirmation: true };
      }
      case 'reorder_last_food_order': {
        await tenant(a);
        const listed = object(await dispatch('list_food_orders', { tenantId: a.tenantId }));
        const rows = Array.isArray(listed.orders) ? listed.orders : [];
        if (!rows.length)
          return {
            unavailable: 'NO_RECENT_ORDER',
            nextStep: '沒有近期訂單可重點；請改查菜單後直接備單',
          };
        const newest = rows.reduce((best, raw) => {
          const row = object(raw);
          const next = Date.parse(String(row.createdAt ?? ''));
          const current = Date.parse(String(object(best).createdAt ?? ''));
          return (Number.isFinite(next) ? next : Number.NEGATIVE_INFINITY) >
            (Number.isFinite(current) ? current : Number.NEGATIVE_INFINITY)
            ? row
            : object(best);
        }, object(rows[0]));
        const detail = object(
          await dispatch('get_food_order', { tenantId: a.tenantId, orderId: newest.id }),
        );
        if (typeof detail.locationId !== 'string' || !detail.locationId)
          return fail('INVALID_INPUT');
        const pickup =
          typeof a.requestedPickupAt === 'string' && a.requestedPickupAt
            ? a.requestedPickupAt
            : new Date(now + 40 * 60000 + 28800000).toISOString().replace(/Z$/, '+08:00').replace('.000+', '+');
        const items = (Array.isArray(detail.lines) ? detail.lines : []).slice(0, 5).map((raw) => {
          const line = object(raw);
          const selected = Array.isArray(line.selectedOptionIds)
            ? line.selectedOptionIds
            : Array.isArray(line.selectedOptions)
              ? line.selectedOptions.map((option) => object(option).optionId).filter((v) => typeof v === 'string')
              : [];
          return {
            menuItemId: line.menuItemId,
            quantity: Number.isInteger(line.quantity) ? line.quantity : 1,
            selectedOptionIds: selected,
          };
        });
        if (!items.length) return fail('INVALID_INPUT');
        return dispatch('propose_food_order', {
          tenantId: a.tenantId,
          locationId: detail.locationId,
          requestedPickupAt: pickup,
          items,
        });
      }
      case 'get_due_work':
        return dueWork(a);
      case 'get_day_overview': {
        const day = date(a.date);
        const l = await getLedger();
        const due = await dueWork({ from: day, to: day });
        const classes = schedule(l, day, day);
        let free: unknown;
        try {
          free = freeTime(l, { date: day });
        } catch {
          free = { incomplete: true, note: '課表或事件不完整，無法判定空檔' };
        }
        return {
          date: day,
          schedule: classes,
          events: calendar(l, day, day),
          due,
          free,
          partial: due.partial || classes.unplaced > 0 || Boolean((free as Obj).incomplete),
          coverage: '僅已同步資料；不得推測未查到的課表',
        };
      }
      case 'get_today_context':
        return context();
      case 'get_schedule':
        return schedule(await getLedger(), String(a.from), String(a.to));
      case 'get_calendar':
        return {
          events: calendar(await getLedger(), String(a.from), String(a.to)),
          source: 'personal-imports',
        };
      case 'list_courses':
        return { courses: await getCourses(), truncated: courseCoveragePartial };
      case 'get_course_work':
        if (!a.workspaceId) return dueWork({});
        await course(a);
        return (await work(String(a.workspaceId))).filter(
          (t) =>
            !a.kind ||
            a.kind === 'both' ||
            t.kind === (a.kind === 'assignments' ? 'assignment' : 'quiz'),
        );
      case 'get_materials':
        if (!a.workspaceId)
          return {
            courses: (await getCourses()).slice(0, 20),
            partial: courseCoveragePartial,
            nextStep: '用上述課程 id 作 workspaceId 呼叫 get_materials',
          };
        await course(a);
        return adapter.materials(String(a.workspaceId), a.cursor as string | undefined);
      case 'list_food_orders': {
        await tenant(a);
        const value = await adapter.orders(String(a.tenantId), a.cursor as string | undefined, {
          state: a.state as string | undefined,
          limit: Number(a.limit || 5),
        });
        value.orders.forEach((o) => {
          orders.add(a.tenantId + ':' + o.id);
          if (typeof o.locationId === 'string' && o.locationId) foodLocations.add(a.tenantId + ':' + id(o.locationId));
        });
        return {
          ...value,
          ...(value.orders.length ? {} : { nextStep: '查無訂單；請省略 state 重查全部近期訂單，不代表沒有歷史訂單。' }),
          orders: value.orders
            .filter((o) => !a.state || o.state === a.state)
            .slice(0, Number(a.limit || 5)),
        };
      }
      case 'get_food_order': {
        await tenant(a);
        if (!orders.has(a.tenantId + ':' + a.orderId)) return fail('FORBIDDEN_SCOPE', 403);
        const order = object(await adapter.order(String(a.tenantId), String(a.orderId)));
        if (typeof order.locationId === 'string' && order.locationId) foodLocations.add(a.tenantId + ':' + id(order.locationId));
        return order;
      }
      case 'list_clubs': {
        await tenant(a);
        const value = await adapter.clubs(
          String(a.tenantId),
          String(a.membership || 'joined'),
          a.cursor as string | undefined,
        );
        value.communities.forEach((c) => clubs.add(a.tenantId + ':' + c.id));
        return value;
      }
      case 'get_club_feed':
        await tenant(a);
        if (!clubs.has(a.tenantId + ':' + a.communityId)) return fail('FORBIDDEN_SCOPE', 403);
        return adapter.feed(
          String(a.tenantId),
          String(a.communityId),
          a.cursor as string | undefined,
        );
      case 'get_dining': {
        if (a.locationId && !diningIds.has(String(a.locationId)))
          return fail('FORBIDDEN_SCOPE', 403);
        const data = await adapter.dining(a.locationId as string | undefined);
        data.cafeterias?.forEach((c) => diningIds.add(c.id));
        return data;
      }
      case 'get_notifications':
        return adapter.notifications(Number(a.limit || 5));
      case 'get_transit':
        return adapter.transit({
          ...a,
          ...(a.action === 'campus' ? { schoolId: binding.schoolId } : {}),
        });
      case 'get_campus_info':
        return {
          officialSource:
            a.kind === 'library' && binding.schoolId === 'pu'
              ? PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL
              : a.kind === 'map'
                ? getOfficialCampusMapUrl(binding.schoolId)
                : null,
          source: '站內入口，未讀完整內容',
          href: pageHref({ page: a.kind === 'library' ? 'map' : a.kind }, binding.schoolId),
          note:
            a.kind === 'library' ? '請在校園地圖查圖書館；未提供步行時間' : '請以頁面最新資料為準',
        };
      case 'find_free_time':
        return freeTime(await getLedger(), a);
      case 'propose_personal_event':
        return propose(a);
      case 'propose_open_page': {
        if (a.entityId) {
          const entity = String(a.entityId);
          const allowed =
            a.page === 'classroom'
              ? (await getCourses()).some((c) => c.id === entity)
              : a.page === 'orders'
                ? [...orders].some((key) => key.endsWith(':' + entity))
                : a.page === 'cafeteria' && diningIds.has(entity);
          if (!allowed) return fail('FORBIDDEN_SCOPE', 403);
        }
        const card = signCard(binding, name, a, 0, secret, now, sequence());
        cards.push(card);
        return { proposed: true, requiresConfirmation: true };
      }
      case 'propose_study_plan': {
        const requested = Array.isArray(a.taskIds) ? (a.taskIds as string[]) : [];
        if (new Set(requested).size !== requested.length) return fail();
        if (requested.length && requested.some((k) => !tasks.has(k))) return fail('UNKNOWN_PENDING_TASK');
        const selected = (requested.length ? requested.map((k) => tasks.get(k)!) : [...tasks.values()].filter((t) => !t.submitted && t.state === 'open' && t.dueAt && Date.parse(t.dueAt) >= now))
          .sort((a, b) => String(a?.dueAt || '9999').localeCompare(String(b?.dueAt || '9999')))
          .slice(0, 4);
        if (selected.some((t) => t.submitted || t.state !== 'open'))
          return fail('UNKNOWN_PENDING_TASK');
        if (!selected.length)
          return { planned: [], unplanned: 0, note: '目前期間沒有未交作業可安排' };
        const slots = freeTime(await getLedger(), a).slots.map((s) => ({ ...s }));
        const minutes = Number(a.minMinutes || 60),
          planned: unknown[] = [];
        for (const task of selected) {
          const slot = slots.find(
            (s) =>
              s.minutes >= minutes &&
              (!task!.dueAt ||
                Date.parse(`${s.date}T${s.startTime}:00+08:00`) + minutes * 60000 <=
                  Date.parse(task!.dueAt)),
          );
          if (!slot) continue;
          const start = Date.parse(`${slot.date}T${slot.startTime}:00+08:00`);
          const endTime = new Date(start + minutes * 60000 + 28800000).toISOString().slice(11, 16);
          planned.push(
            await propose({
              title: studyTitle(task!.title),
              date: slot.date,
              startTime: slot.startTime,
              endTime,
              allDay: false,
            }),
          );
          slot.startTime = endTime;
          slot.minutes -= minutes;
        }
        return { planned, unplanned: selected.length - planned.length };
      }
    }
    return fail('UNKNOWN_TOOL');
  }
  function context() {
    return (contextCache ||= buildContext());
  }
  async function buildContext() {
    const today = taipeiDate(now),
      missing: string[] = [],
      result: Obj = {
        now: new Date(now + 28800000).toISOString().replace('Z', '+08:00'),
        school: binding.schoolId,
        schoolSource: 'browse_scope',
        source: 'personal-imports / class-workspaces',
        coverage: '最多三門課；僅已同步個人資料',
        simulation: adapter.simulation,
      };
    try {
      const l = await getLedger();
      const data = schedule(l, today, today);
      result.classes = data.classes.map((c) => [c.title, c.startTime, c.endTime, c.location]);
      result.next = data.classes.find((c) => c.start > now);
      result.events = calendar(l, today, addDays(today, 7)).slice(0, 3);
      result.updatedAt = l.updatedAt;
      if (data.unplaced) missing.push('unplaced_schedule');
    } catch (e) {
      if ((e as { status?: number }).status === 401) throw e;
      missing.push('personal-imports');
    }
    try {
      const list = await getCourses();
      result.courses = list.slice(0, 3);
      if (courseCoveragePartial || list.length > 3) missing.push('course_coverage');
      const found: Task[] = [];
      for (const c of list.slice(0, 3)) {
        try {
          found.push(...(await work(c.id)));
        } catch (e) {
          if ((e as { status?: number }).status === 401) throw e;
          missing.push('course_work');
        }
      }
      result.due = found
        .filter(
          (t) =>
            !t.submitted &&
            t.state === 'open' &&
            t.dueAt &&
            Date.parse(t.dueAt) >= now &&
            Date.parse(t.dueAt) < Date.parse(addDays(today, 7) + 'T00:00:00+08:00'),
        )
        .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
        .slice(0, 3);
    } catch (e) {
      if ((e as { status?: number }).status === 401) throw e;
      missing.push('courses');
    }
    try {
      result.realms = await getRealms();
      if (!(result.realms as unknown[]).length) missing.push('realm_school_mapping');
    } catch (e) {
      if ((e as { status?: number }).status === 401) throw e;
      missing.push('realms');
    }
    if (!adapter.simulation) missing.push('notifications_NOT_CONNECTED');
    result.missing = missing;
    return result;
  }
  const known = new Map<string, { id: string; title: string }[]>();
  function remember(value: unknown, source: string) {
    if (Array.isArray(value)) {
      value.forEach((v) => remember(v, source));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const row = value as Obj;
    if (typeof row.id === 'string' && typeof (row.title || row.name) === 'string') {
      const list = known.get(source) || [];
      if (!list.some((r) => r.id === row.id))
        list.push({ id: row.id, title: String(row.title || row.name) });
      known.set(source, list);
    }
    Object.values(row).forEach((v) => {
      if (v && typeof v === 'object') remember(v, source);
    });
  }
  return {
    cards,
    context,
    recovery(name: string) {
      const next: Record<string, string> = {
        get_dining: '先呼叫 get_dining {} 取得 locationId',
        get_food_locations:
          '呼叫 get_food_locations {} 列出可用 realm，或用 context 中的 tenantId 重試',
        list_food_orders: '可省略 tenantId；多 realm 時用 context 可見 tenantId 重試',
        list_clubs: '可省略 tenantId；多 realm 時用 context 可見 tenantId 重試',
        get_food_menu: '先呼叫 get_food_locations {} 取得 tenantId/locationId',
        propose_food_order: '先呼叫 get_food_locations，再 get_food_menu；依菜單 id 重試',
        reorder_last_food_order: '可省略參數；伺服器會讀最近一筆自己的訂單並備同樣內容',
        get_course_work: '先呼叫 list_courses，使用回傳的 workspaceId',
        get_materials: '先呼叫 list_courses，使用回傳的 workspaceId',
        get_food_order: '先呼叫 list_food_orders 取得 orderId',
        get_club_feed: '先呼叫 list_clubs 取得 communityId',
        propose_study_plan: '可省略 taskIds；伺服器會用已讀取的未交作業安排，勿向使用者索取代碼',
        get_transit: '先以 action=campus 查詢；arrivals 需真實 city/stopId',
      };
      return {
        nextStep:
          next[name] || `依 ${name} schema 補正參數後重試；日期 YYYY-MM-DD、時間 HH:mm，不猜 id`,
        availableIds: (['list_food_orders', 'list_clubs', 'get_food_locations'].includes(name)
          ? tenantIds
          : name === 'get_dining'
            ? [...diningIds]
            : name === 'get_food_order'
              ? [...orders]
              : name === 'propose_food_order'
                ? [...foodLocations, ...(known.get('get_food_menu') || []).map((r) => r.id)]
                : name.includes('food')
                  ? [...foodLocations]
                  : name.includes('club')
                    ? [...clubs]
                    : /course|materials/.test(name)
                      ? courseIds
                      : name.includes('study')
                        ? [...tasks.keys()]
                        : tenantIds
        ).slice(0, 5),
      };
    },
    withSignal: withOperationSignal,
    async call(name: string, raw: unknown) {
      const cleaned = { ...object(raw) };
      if (name === 'propose_study_plan') {
        if (cleaned.taskIds === undefined && cleaned.taskId !== undefined)
          cleaned.taskIds = Array.isArray(cleaned.taskId) ? cleaned.taskId : [cleaned.taskId];
        delete cleaned.taskId;
        const day = typeof cleaned.date === 'string' ? String(cleaned.date) : taipeiDate(now);
        await dueWork({ from: day, to: addDays(day, 6) });
        if (!Array.isArray(cleaned.taskIds) || !cleaned.taskIds.length) {
          const pending = [...tasks.values()]
            .filter((row) => !row.submitted && row.state === 'open' && row.dueAt && Date.parse(row.dueAt) >= now)
            .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
            .slice(0, 4)
            .map((row) => row.id);
          if (pending.length) cleaned.taskIds = pending;
          else delete cleaned.taskIds;
        }
      }
      if (name === 'list_food_orders' && reorder) delete cleaned.state;
      const ignored = Object.keys(cleaned).filter((k) => !(k in (definitions[name]?.[0] || {})));
      if (name === 'get_transit' && cleaned.action === 'campus') {
        for (const key of ['city', 'stopId']) if (key in cleaned) ignored.push(key);
      }
      ignored.forEach((k) => delete cleaned[k]);
      if (name === 'propose_food_order' && Array.isArray(cleaned.items)) {
        cleaned.items = cleaned.items.map((item) => {
          const row = { ...object(item) };
          for (const key of Object.keys(row))
            if (!['menuItemId', 'quantity', 'selectedOptionIds'].includes(key)) {
              ignored.push('items.' + key);
              delete row[key];
            }
          return row;
        });
      }
      const sources: Record<string, string[]> = {
        workspaceId: ['list_courses'],
        orderId: ['list_food_orders'],
        communityId: ['list_clubs'],
        locationId: ['get_food_locations', 'get_dining'],
        taskIds: ['get_due_work', 'get_day_overview'],
        menuItemId: ['get_food_menu'],
        selectedOptionIds: ['get_food_menu'],
        entityId:
          cleaned.page === 'classroom'
            ? ['list_courses']
            : cleaned.page === 'orders'
              ? ['list_food_orders']
              : ['get_dining'],
      };
      function resolve(value: unknown, key: string): unknown {
        const rows = (sources[key] || []).flatMap((source) => known.get(source) || []);
        if (key === 'taskIds') rows.push(...tasks.values());
        if (rows.some((r) => r.id === value)) return value;
        const matches = [
          ...new Map(rows.filter((r) => r.title === value).map((r) => [r.id, r])).values(),
        ];
        return matches.length === 1 ? matches[0].id : value;
      }
      for (const key of Object.keys(sources)) {
        if (cleaned[key] !== undefined)
          cleaned[key] = Array.isArray(cleaned[key])
            ? (cleaned[key] as unknown[]).map((v) => resolve(v, key))
            : resolve(cleaned[key], key);
      }
      if (Array.isArray(cleaned.items))
        cleaned.items = cleaned.items.map((v) => {
          const row = object(v);
          return {
            ...row,
            menuItemId: resolve(row.menuItemId, 'menuItemId'),
            selectedOptionIds: Array.isArray(row.selectedOptionIds)
              ? row.selectedOptionIds.map((v) => resolve(v, 'selectedOptionIds'))
              : row.selectedOptionIds,
          };
        });
      if ('tenantId' in (definitions[name]?.[0] || {})) await tenant(cleaned);
      if (name === 'get_food_menu' || name === 'propose_food_order') {
        const visible = [...foodLocations].filter((v) => v.startsWith(cleaned.tenantId + ':'));
        const matched = visible.filter((v) => v.split(':').slice(1).join(':').toLowerCase() === String(cleaned.locationId || '').toLowerCase());
        if (matched.length === 1 || (!cleaned.locationId && visible.length === 1))
          cleaned.locationId = (matched[0] || visible[0]).slice(String(cleaned.tenantId).length + 1);
      }
      const a = validateTool(name, cleaned),
        key = name + canonical(a),
        cached = cache.has(key);
      if (!cached) cache.set(key, dispatch(name, a));
      const value = await cache.get(key);
      remember(value, name);
      return {
        value: ignored.length ? { data: value, note: '已忽略未知參數欄位' } : value,
        cached,
      };
    },
  };
}
