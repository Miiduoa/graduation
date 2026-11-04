import {
  getOfficialCampusMapUrl,
  PROVIDENCE_LIBRARY_FLOOR_GUIDE_URL,
} from '@campus/shared/src/campusMapLookup';
import { buildPersonalToday } from '@campus/shared/src/imports/today';
import { eventInterval, pageArgs, pageHref, signCard } from './actions';
import {
  addDays,
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
  get_today_context: [{}, []],
  get_schedule: [{ from: d, to: d }, ['from', 'to']],
  get_calendar: [{ from: d, to: d }, ['from', 'to']],
  list_courses: [{}, []],
  get_course_work: [
    { workspaceId: s, kind: { enum: ['assignments', 'quizzes', 'both'] } },
    ['workspaceId'],
  ],
  get_materials: [{ workspaceId: s, cursor: s }, ['workspaceId']],
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
      cursor: s,
    },
    ['tenantId'],
  ],
  get_food_order: [{ tenantId: s, orderId: s }, ['tenantId', 'orderId']],
  get_dining: [{ locationId: s }, []],
  list_clubs: [{ tenantId: s, membership: { enum: ['joined', 'all'] }, cursor: s }, ['tenantId']],
  get_club_feed: [{ tenantId: s, communityId: s, cursor: s }, ['tenantId', 'communityId']],
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
    ['date', 'taskIds'],
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
export const toolNames = Object.keys(definitions);
export function selectTools(question: string, simulation: boolean): string[] {
  const out = new Set<string>(['get_today_context', 'propose_open_page']);
  const add = (...names: string[]) => names.forEach((n) => out.add(n));
  if (/作業|要交|規劃|排|剛剛|剛才/.test(question))
    add(
      'list_courses',
      'get_course_work',
      'find_free_time',
      'propose_personal_event',
      'propose_study_plan',
    );
  if (/課|有空|下午|行程|規劃/.test(question))
    add('get_schedule', 'get_calendar', 'find_free_time');
  if (/教材/.test(question)) add('list_courses', 'get_materials');
  if (/吃|中午|餐廳|規劃/.test(question)) add('get_dining');
  if (/訂|餐好了/.test(question)) add('list_food_orders', 'get_food_order');
  if (/社團/.test(question)) add('list_clubs', 'get_club_feed');
  if (/圖書館|怎麼走|公車|地圖|公告|活動/.test(question)) add('get_campus_info', 'get_transit');
  if (/通知/.test(question) && simulation) add('get_notifications');
  // Prioritize the requested domain, retaining proposals for planning questions.
  const names = [...out];
  if (names.length > 8) names.splice(names.indexOf('propose_open_page'), 1);
  if (names.length > 8 && names.includes('find_free_time'))
    names.splice(names.indexOf('get_calendar'), 1);
  return names.slice(0, 8);
}
export const schemas = (names: string[]) =>
  names.map((name) => ({
    type: 'function',
    function: {
      name,
      parameters: {
        type: 'object',
        properties: definitions[name][0],
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
  for (const [key, value] of Object.entries(a)) {
    const spec = props[key] as Obj;
    if (spec.enum && !(spec.enum as unknown[]).includes(value)) return fail();
    if (spec.type === 'string') {
      if (spec.format === 'date') date(value);
      else if (key === 'from' || key === 'to' || key.endsWith('Time')) clock(value);
      else if (key.endsWith('Id') || key === 'cursor') id(value);
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
  if (name === 'get_schedule' || name === 'get_calendar') {
    if (
      String(a.from) > String(a.to) ||
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
  const diningIds = new Set<string>();
  const getLedger = () =>
    (ledger ||= adapter.ledger().then((value) => {
      if (value.schoolId !== binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
      return value;
    }));
  const getCourses = () => (courses ||= adapter.courses().then((value) => value.slice(0, 20)));
  const getRealms = () => (realms ||= adapter.realms());
  async function course(a: Obj) {
    if (!(await getCourses()).some((c) => c.id === a.workspaceId))
      return fail('FORBIDDEN_SCOPE', 403);
  }
  async function tenant(a: Obj) {
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
  async function propose(raw: Obj) {
    if (!writes)
      return {
        unavailable: 'WRITES_DISABLED',
        href: pageHref({ page: 'calendar' }, binding.schoolId),
      };
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
    const card = signCard(
      binding,
      'propose_personal_event',
      raw,
      l.revision + cards.filter((c) => c.tool === 'propose_personal_event').length,
      secret,
      now,
    );
    cards.push(card);
    return { proposed: true, ...raw, requiresConfirmation: true };
  }
  async function dispatch(name: string, raw: unknown): Promise<unknown> {
    const a = validateTool(name, raw);
    switch (name) {
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
        return { courses: await getCourses(), truncated: (await getCourses()).length >= 20 };
      case 'get_course_work':
        await course(a);
        return (await work(String(a.workspaceId))).filter(
          (t) =>
            !a.kind ||
            a.kind === 'both' ||
            t.kind === (a.kind === 'assignments' ? 'assignment' : 'quiz'),
        );
      case 'get_materials':
        await course(a);
        return adapter.materials(String(a.workspaceId), a.cursor as string | undefined);
      case 'list_food_orders': {
        await tenant(a);
        const value = await adapter.orders(String(a.tenantId), a.cursor as string | undefined, {
          state: a.state as string | undefined,
          limit: Number(a.limit || 5),
        });
        value.orders.forEach((o) => orders.add(a.tenantId + ':' + o.id));
        return {
          ...value,
          orders: value.orders
            .filter((o) => !a.state || o.state === a.state)
            .slice(0, Number(a.limit || 5)),
        };
      }
      case 'get_food_order':
        await tenant(a);
        if (!orders.has(a.tenantId + ':' + a.orderId)) return fail('FORBIDDEN_SCOPE', 403);
        return adapter.order(String(a.tenantId), String(a.orderId));
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
        const card = signCard(binding, name, a, 0, secret, now);
        cards.push(card);
        return { proposed: true, requiresConfirmation: true };
      }
      case 'propose_study_plan': {
        if (new Set(a.taskIds as string[]).size !== (a.taskIds as string[]).length) return fail();
        const selected = (a.taskIds as string[])
          .map((k) => tasks.get(k))
          .sort((a, b) => String(a?.dueAt || '9999').localeCompare(String(b?.dueAt || '9999')));
        if (selected.some((t) => !t || t.submitted || t.state !== 'open'))
          return fail('UNKNOWN_PENDING_TASK');
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
              title: ('寫作業：' + task!.title).slice(0, 120),
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
      if (list.length > 3) missing.push('course_coverage');
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
            t.dueAt.slice(0, 10) <= addDays(today, 7),
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
  return {
    cards,
    context,
    async call(name: string, raw: unknown) {
      const a = validateTool(name, raw),
        key = name + canonical(a),
        cached = cache.has(key);
      if (!cached) cache.set(key, dispatch(name, a));
      return { value: await cache.get(key), cached };
    },
  };
}
