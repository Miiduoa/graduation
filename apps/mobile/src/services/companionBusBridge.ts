/**
 * 將 campusEventBus 與同伴引擎連線（避免與 earnXP 已處理的項目重複加分）。
 */
import { campusEventBus } from './campusEventBus';
import { notifyCampusBusEvent } from './companionEngine';

const BRIDGE_EVENT_TYPES = [
  'grade:updated',
  'gpa:changed',
  'leave:reviewed',
  'assignment:graded',
  'assignment:published',
  'course:enrolled',
  'course:created',
  'course:approved',
  'session:started',
  'session:ended',
  'group:joined',
  'buddy:matched',
  'post:created',
  'cafeteria:order_placed',
  'lostfound:posted',
  'achievement:unlocked',
  'streak:updated',
  'post_login_context_ready',
  'role_updated',
] as const;

let bridged = false;
const subs: Array<() => void> = [];

export function registerCompanionCampusBusBridge(): void {
  if (bridged) return;
  bridged = true;

  for (const type of BRIDGE_EVENT_TYPES) {
    subs.push(
      campusEventBus.on(type, () => {
        void notifyCampusBusEvent(type);
      }),
    );
  }
}

export function teardownCompanionCampusBusBridge(): void {
  subs.forEach((fn) => fn());
  subs.length = 0;
  bridged = false;
}
