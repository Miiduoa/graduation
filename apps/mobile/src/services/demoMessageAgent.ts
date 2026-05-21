import { getDemoUserStory } from '../data/demoUserStories';
import type { AssistantChoiceMenu } from '../data/types';
import {
  sendMessage,
  type DemoUserRole,
  type StoreDynamicMessage,
} from './demoStore';
import { listDemoOrdersForStudent } from './demoMerchantOrders';

type DemoMessageRecipient = {
  uid: string;
  name: string;
  role: DemoUserRole;
  aliases: string[];
  avatar: string;
};

export type DemoMessageAgentInput = {
  senderUid?: string;
  senderName?: string | null;
  senderRole?: string | null;
  peerId?: unknown;
  target?: unknown;
  text?: unknown;
  content?: unknown;
  message?: string;
};

export type DemoMessageAgentResult = {
  success: boolean;
  isWrite: boolean;
  summary: string;
  data?: StoreDynamicMessage;
  error?: string;
  choiceMenu?: AssistantChoiceMenu;
};

const RECIPIENTS: DemoMessageRecipient[] = [
  {
    uid: 'demo_teacher_chang',
    name: '張怡君老師',
    role: 'teacher',
    aliases: ['張怡君', '張老師', '張教授', '老師', '教授', 'teacher', 'professor'],
    avatar: '👩‍🏫',
  },
  {
    uid: 'demo_cafeteria',
    name: '口試 Demo 便當店',
    role: 'vendor',
    aliases: ['餐廳', '店家', '便當店', '口試demo便當店', '口試 Demo 便當店', '阿英', '阿櫻', '商家', 'vendor'],
    avatar: '🍱',
  },
  {
    uid: 'demo_ta_lin',
    name: '林助教',
    role: 'ta',
    aliases: ['林助教', '助教', 'ta'],
    avatar: '🧑‍💻',
  },
  {
    uid: 'demo_admin_huang',
    name: '黃主任',
    role: 'department_head',
    aliases: ['黃主任', '主任', '系主任', '系所主管', 'department head'],
    avatar: '🏛️',
  },
  {
    uid: 'demo_admin_sys',
    name: '王系管',
    role: 'admin',
    aliases: ['王系管', '管理員', '系統管理員', 'admin'],
    avatar: '🛠️',
  },
  {
    uid: 'demo_student_kuchih',
    name: '顧晉瑋',
    role: 'student',
    aliases: ['顧晉瑋', '晉瑋', '學生', '同學', 'student'],
    avatar: '🎓',
  },
  {
    uid: 'demo_club_wei',
    name: '魏程式',
    role: 'club_officer',
    aliases: ['魏程式', '社長', '社團幹部', 'club'],
    avatar: '🏆',
  },
  {
    uid: 'demo_alumni_chang',
    name: '張學長',
    role: 'alumni',
    aliases: ['張學長', '校友', '學長', 'alumni'],
    avatar: '🎓',
  },
  {
    uid: 'demo_guest',
    name: '訪客',
    role: 'guest',
    aliases: ['訪客', '來賓', 'guest'],
    avatar: '👋',
  },
];

function normalize(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s｜|／/,，、\-—_()（）「」『』"'`]/g, '');
}

function toDemoUserRole(role: string | null | undefined): DemoUserRole {
  switch (role) {
    case 'teacher':
    case 'faculty':
    case 'professor':
      return 'teacher';
    case 'ta':
      return 'ta';
    case 'club_officer':
      return 'club_officer';
    case 'department_head':
      return 'department_head';
    case 'admin':
      return 'admin';
    case 'vendor':
      return 'vendor';
    case 'alumni':
      return 'alumni';
    case 'guest':
      return 'guest';
    case 'student':
    default:
      return 'student';
  }
}

function senderAvatar(role: DemoUserRole): string {
  switch (role) {
    case 'teacher':
      return '👩‍🏫';
    case 'ta':
      return '🧑‍💻';
    case 'department_head':
      return '🏛️';
    case 'admin':
      return '🛠️';
    case 'vendor':
      return '🍱';
    case 'alumni':
      return '🎓';
    case 'guest':
      return '👋';
    case 'club_officer':
      return '🏆';
    case 'student':
    default:
      return '💬';
  }
}

function stringifyTarget(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(' ');
  return String(value ?? '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function aliasPatternFor(recipient: DemoMessageRecipient): string {
  return recipient.aliases
    .map(escapeRegExp)
    .sort((a, b) => b.length - a.length)
    .join('|');
}

export function resolveDemoMessageRecipient(value: unknown, message = ''): DemoMessageRecipient | null {
  const explicit = stringifyTarget(value);
  const key = normalize(explicit);
  const msgKey = normalize(message);
  const haystacks = [key, msgKey].filter(Boolean);
  if (haystacks.length === 0) return null;

  const byUid = RECIPIENTS.find((recipient) => recipient.uid === explicit);
  if (byUid) return byUid;

  let best: { recipient: DemoMessageRecipient; score: number } | null = null;
  for (const recipient of RECIPIENTS) {
    for (const alias of recipient.aliases) {
      const aliasKey = normalize(alias);
      if (!aliasKey) continue;
      for (const hay of haystacks) {
        if (hay === aliasKey) return recipient;
        if (hay.includes(aliasKey) || aliasKey.includes(hay)) {
          const score = aliasKey.length + (recipient.role === 'vendor' && /餐廳|店家|便當/.test(message) ? 4 : 0);
          if (!best || score > best.score) best = { recipient, score };
        }
      }
    }
  }
  return best?.recipient ?? null;
}

function stripMessagePrefix(text: string, recipient: DemoMessageRecipient | null): string {
  let result = text.trim();
  result = result.replace(/^(?:請你|請|麻煩|幫我|幫忙|可以幫我)?(?:發送|傳|傳送|發|寄|私訊|通知)?(?:一?則)?(?:訊息|站內訊息)?/u, '').trim();
  if (recipient) {
    const aliasPattern = aliasPatternFor(recipient);
    if (aliasPattern) {
      result = result.replace(new RegExp(`^(?:給|跟|對)?(?:${aliasPattern})`, 'iu'), '').trim();
    }
  }
  result = result.replace(/^(?:說|講|表示|告訴|通知|要|幫我跟他說|幫我跟她說|跟他說|跟她說|:|：|，|,)+/u, '').trim();
  return result;
}

function extractContent(input: DemoMessageAgentInput, recipient: DemoMessageRecipient | null): string {
  const full = String(input.message ?? '').trim();
  const explicit = String(input.text ?? input.content ?? '').trim();
  const said = full.match(/(?:說|講|表示|告訴|:|：)\s*(.+)$/u)?.[1]?.trim();
  if (said && said.length >= 2) return said;
  if (recipient) {
    const aliasPattern = aliasPatternFor(recipient);
    const afterRecipient = full
      .match(new RegExp(`(?:給|跟|對)?(?:${aliasPattern})(?:說|講|表示|告訴|通知|要|:|：|，|,)?\\s*(.+)$`, 'iu'))?.[1]
      ?.trim();
    if (afterRecipient && afterRecipient.length >= 2 && afterRecipient !== full) return afterRecipient;
  }
  const stripped = full ? stripMessagePrefix(full, recipient) : '';
  if (stripped && stripped !== full && stripped.length >= 2) return stripped;
  if (explicit && explicit !== '你好') return explicit;
  return stripped || explicit;
}

function shouldDraftOnly(message: string): boolean {
  return /(?:不要|別|先不要|不用).{0,8}(?:送出|發送|傳|私訊)|(?:只|先).{0,4}(?:草稿|擬|寫)/.test(message);
}

function buildRecipientChoiceMenu(): AssistantChoiceMenu {
  return {
    title: '請選擇收件人',
    prompt: '選一個 demo 角色後，我會幫你送出站內訊息。',
    producedByTool: 'send_message',
    options: RECIPIENTS.slice(0, 6).map((recipient) => ({
      id: recipient.uid,
      label: recipient.name,
      subtitle: recipient.role,
      sendAsUser: `傳訊息給${recipient.aliases[0]}說`,
    })),
  };
}

function enrichVendorOrderChange(content: string, senderUid: string | undefined): string {
  if (!senderUid || !/訂單|餐點|改單|修改|取消|少飯|加飯|不要|備註/.test(content)) return content;
  const latest = listDemoOrdersForStudent(senderUid)[0];
  if (!latest) return content;
  const items = latest.items.map((item) => `${item.name} x${item.quantity}`).join('、');
  return [
    content,
    '',
    `（AI 已附上最近訂單：#${latest.id.slice(0, 8)}｜${latest.merchantName ?? latest.cafeteria ?? '餐廳'}｜${items}｜$${latest.totalAmount ?? latest.total ?? 0}）`,
  ].join('\n');
}

export function sendDemoMessageAsAgent(input: DemoMessageAgentInput): DemoMessageAgentResult {
  const senderUid = String(input.senderUid ?? '').trim();
  if (!senderUid.startsWith('demo_')) {
    return {
      success: false,
      isWrite: true,
      summary: '這個訊息代理只處理 demo 角色。',
      error: 'not_demo_user',
    };
  }

  const message = String(input.message ?? '').trim();
  if (shouldDraftOnly(message)) {
    return {
      success: false,
      isWrite: false,
      summary: '我先不送出。你可以把要傳的內容確認後，再說「送出給某某」。',
    };
  }

  const recipient = resolveDemoMessageRecipient(input.peerId ?? input.target, message);
  if (!recipient) {
    return {
      success: false,
      isWrite: false,
      summary: '我還需要知道要傳給誰。可用 demo 收件人包含張教授、餐廳、助教、系主任、管理員、學生、校友。',
      choiceMenu: buildRecipientChoiceMenu(),
    };
  }

  const rawContent = extractContent(input, recipient);
  if (!rawContent || rawContent.length < 2) {
    return {
      success: false,
      isWrite: false,
      summary: `要傳給${recipient.name}的內容是什麼？`,
    };
  }

  const story = getDemoUserStory(senderUid);
  const senderRole = story?.role ?? toDemoUserRole(input.senderRole);
  const senderName = String(input.senderName ?? '').trim() || story?.fullName || 'Demo 使用者';
  const body = recipient.role === 'vendor'
    ? enrichVendorOrderChange(rawContent, senderUid)
    : rawContent;

  const sent = sendMessage({
    fromName: `${senderName}（AI 代理）`,
    fromAvatar: senderAvatar(senderRole),
    subject: `【AI 代理訊息】${senderName} → ${recipient.name}`,
    body,
    sentAt: '剛剛',
    isRead: false,
    type: 'info',
    senderRole,
    recipientRoles: [recipient.role],
  });

  return {
    success: true,
    isWrite: true,
    data: sent,
    summary: `已幫你傳訊息給${recipient.name}：「${rawContent.slice(0, 60)}${rawContent.length > 60 ? '…' : ''}」`,
  };
}
