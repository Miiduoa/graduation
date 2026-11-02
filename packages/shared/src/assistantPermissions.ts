/**
 * 助理寫入類動作權限清單（與 agent tools 的 requiresConfirmation: true 對齊）。
 * 預設全部關閉；讀不到或格式錯誤時由 normalize 視為全部關閉（fail closed）。
 */

export const ASSISTANT_WRITE_PERMISSION_KEYS = [
  'submitLeaveRequest',
  'reserveSeat',
  'borrowBook',
  'renewBook',
  'returnBook',
  'createDormRepairRequest',
  'reserveWashingMachine',
  'createOrder',
  'cancelOrder',
  'submitQuizAttempt',
  'verifyAttendanceClaim',
] as const;

export type AssistantWritePermissionKey = (typeof ASSISTANT_WRITE_PERMISSION_KEYS)[number];

export type AssistantWritePermissionDefinition = {
  key: AssistantWritePermissionKey;
  label: string;
  description: string;
};

/** 網頁與手機共用的中文說明；每一種寫入動作可單獨開關。 */
export const ASSISTANT_WRITE_PERMISSION_DEFINITIONS: readonly AssistantWritePermissionDefinition[] = [
  {
    key: 'submitLeaveRequest',
    label: '送出請假申請',
    description: '依課表整理請假內容，經你確認後建立待審請假申請。',
  },
  {
    key: 'reserveSeat',
    label: '預約座位',
    description: '預約圖書館或自習室座位，確認後才會寫入預約紀錄。',
  },
  {
    key: 'borrowBook',
    label: '借閱圖書',
    description: '建立圖書借閱申請，確認後會建立借閱紀錄並扣庫存。',
  },
  {
    key: 'renewBook',
    label: '續借圖書',
    description: '延長既有借閱期限，確認後才會更新到期日。',
  },
  {
    key: 'returnBook',
    label: '歸還圖書',
    description: '登記還書，確認後才會更新借閱狀態。',
  },
  {
    key: 'createDormRepairRequest',
    label: '送出宿舍報修',
    description: '整理報修草稿，確認後送出宿舍維修申請。',
  },
  {
    key: 'reserveWashingMachine',
    label: '預約洗衣機',
    description: '預約宿舍洗衣機，確認後會寫入預約並更新機台狀態。',
  },
  {
    key: 'createOrder',
    label: '餐廳下單',
    description: '整理訂餐草稿，確認後送出餐廳訂單（仍受線上點餐開關約束）。',
  },
  {
    key: 'cancelOrder',
    label: '取消餐廳訂單',
    description: '取消尚未完成的餐廳訂單，確認後才會變更訂單狀態。',
  },
  {
    key: 'submitQuizAttempt',
    label: '提交測驗作答',
    description: '代你提交課程測驗作答，確認後才會送出成績計算。',
  },
  {
    key: 'verifyAttendanceClaim',
    label: '驗證點名簽到',
    description: '驗證 QR／數字／定位等點名憑證，確認後才會寫入出席紀錄。',
  },
] as const;

export type AssistantWritePermissions = Record<AssistantWritePermissionKey, boolean>;

/** Firestore：users/{uid}/settings/{ASSISTANT_PERMISSIONS_DOC_ID} */
export const ASSISTANT_PERMISSIONS_DOC_ID = 'assistantPermissions';

/** 網頁設定頁區塊參數 */
export const ASSISTANT_PERMISSIONS_SETTINGS_SECTION = 'assistant';

export const ASSISTANT_PERMISSIONS_SETTINGS_HREF = `/settings?section=${ASSISTANT_PERMISSIONS_SETTINGS_SECTION}`;

const KEY_SET = new Set<string>(ASSISTANT_WRITE_PERMISSION_KEYS);

export function createDefaultAssistantWritePermissions(): AssistantWritePermissions {
  const next = {} as AssistantWritePermissions;
  for (const key of ASSISTANT_WRITE_PERMISSION_KEYS) {
    next[key] = false;
  }
  return next;
}

/**
 * 正規化使用者設定。缺欄、型別錯誤、非物件 → 對應 key 視為關閉。
 * 未知欄位忽略；不會把非布林真值當成開啟。
 */
export function normalizeAssistantWritePermissions(value?: unknown): AssistantWritePermissions {
  const defaults = createDefaultAssistantWritePermissions();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }
  const source = value as Record<string, unknown>;
  const next = { ...defaults };
  for (const key of ASSISTANT_WRITE_PERMISSION_KEYS) {
    next[key] = source[key] === true;
  }
  return next;
}

export function isAssistantWritePermissionKey(value: string): value is AssistantWritePermissionKey {
  return KEY_SET.has(value);
}

/** 僅當明確為 true 才允許；未知工具一律拒絕。 */
export function isAssistantWriteToolAllowed(
  permissions: AssistantWritePermissions | null | undefined,
  toolName: string,
): boolean {
  if (!permissions || !isAssistantWritePermissionKey(toolName)) return false;
  return permissions[toolName] === true;
}

export function getAssistantWritePermissionDefinition(
  toolName: string,
): AssistantWritePermissionDefinition | null {
  if (!isAssistantWritePermissionKey(toolName)) return null;
  return ASSISTANT_WRITE_PERMISSION_DEFINITIONS.find((row) => row.key === toolName) ?? null;
}

export function getAssistantWritePermissionLabel(toolName: string): string {
  return getAssistantWritePermissionDefinition(toolName)?.label || toolName;
}

/** 規劃階段／執行前拒絕時的固定文案（附設定頁路徑提示）。 */
export function assistantWritePermissionDeniedMessage(toolName: string): string {
  const label = getAssistantWritePermissionLabel(toolName);
  return `你在設定關閉了「${label}」，可到設定頁開啟。\n設定路徑：設定 → 助理權限（${ASSISTANT_PERMISSIONS_SETTINGS_HREF}）`;
}

/** 序列化成可寫入 Firestore 的純物件（不含 updatedAt）。 */
export function serializeAssistantWritePermissions(
  permissions: AssistantWritePermissions,
): Record<AssistantWritePermissionKey, boolean> {
  return normalizeAssistantWritePermissions(permissions);
}
