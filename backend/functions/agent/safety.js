'use strict';

/**
 * PII redactor — 將敏感資訊以 placeholder 遮蔽。
 * 設計原則：寧可多遮，不放原文進 model context；audit log 也只記摘要。
 */
function redactSensitiveText(text) {
  return String(text ?? '')
    // 台灣身分證 / 居留證（A123456789 / AA12345678）
    .replace(/\b[A-Z][12]\d{8}\b/g, '[身分證已遮蔽]')
    .replace(/\b[A-Z]{2}\d{8}\b/g, '[居留證已遮蔽]')
    // 台灣手機（含 +886 / 國碼 / 各種分隔符）
    .replace(/\b(?:\+?886[-\s]?)?09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/g, '[電話已遮蔽]')
    // 市話（02-1234-5678 / (04)1234-5678）
    .replace(/\b\(?0[2-8]\)?[-\s]?\d{3,4}[-\s]?\d{4}\b/g, '[電話已遮蔽]')
    // 信用卡 / 銀行卡（13-19 位、可含 -/空白）
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, '[卡號已遮蔽]')
    // Email
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[Email 已遮蔽]')
    // 學號（以 "學號" 引導後接 6-10 位英數）
    .replace(/(學號\s*[：:=]?\s*)([A-Za-z0-9]{6,10})/g, '$1[學號已遮蔽]')
    // 通用密碼 / OTP / API key / Token / 銀行帳號
    .replace(
      /((?:密碼|password|passcode|驗證碼|otp|pin\s*碼?|金鑰|api[\s_-]?key|secret|token|存款帳號|匯款帳號|帳號)\s*[：:=]?\s*)[^\s，。；;]{2,}/gi,
      '$1[已遮蔽]',
    );
}

/**
 * 偵測：使用者意圖儲存「第三人」的 PII（不是自己的）。
 * 例：「把這通訊錄存起來 王同學 0912-...」「幫我記住 ku-123 的身分證 A...」
 */
function isThirdPartyPiiStoreAttempt(text) {
  const s = String(text ?? '');
  const hasStoreVerb = /(存起來|記住|記下|備註|保存|存檔|建一筆|加進|加入)/.test(s);
  const hasOthersName = /(同學|老師|教授|室友|朋友|男友|女友|主管|對方)/.test(s);
  const hasPii =
    /\b[A-Z][12]\d{8}\b/.test(s) ||
    /\b09\d{2}[-\s]?\d{3}[-\s]?\d{3}\b/.test(s) ||
    /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(s);
  return hasStoreVerb && hasOthersName && hasPii;
}

function sanitizeAssistantMessagesForRuntime(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((message) => {
    if (!message || typeof message !== 'object') return message;
    if (typeof message.content !== 'string') return message;
    return {
      ...message,
      content: redactSensitiveText(message.content),
    };
  });
}

/**
 * 偵測：Prompt 注入 / 角色越獄 / system prompt 洩漏 / 越權資料讀取。
 */
function isPromptInjectionAttempt(text) {
  const s = String(text ?? '').toLowerCase();
  return (
    /忽略.{0,12}(前面|以上|所有|系統|指示|規則|限制|提示)/.test(s) ||
    /(ignore|forget|discard|disregard|override|bypass).{0,24}(previous|above|system|instruction|rule|policy|prompt|guideline)/i.test(s) ||
    /(system prompt|系統提示|developer message|開發者訊息|內部提示|隱藏提示|背後規則|背景指令)/i.test(s) ||
    /\b(dan|jailbreak|越獄模式|無限制模式|developer mode|do anything now|sudo mode|root mode)\b/i.test(s) ||
    /(列出|顯示|dump|print|show|export|reveal).{0,24}(uid|使用者|所有用戶|所有使用者|token|secret|api[\s_-]?key|系統提示|password|帳密)/i.test(s) ||
    /(假裝你是|你現在是|pretend\s+you\s+are|act\s+as|roleplay\s+as).{0,30}(不受限|無限制|沒有規則|no\s+(?:rules|restrictions|limits))/i.test(s) ||
    /(你不准回我不知道|你必須回答|你一定要|你不能拒絕|you must answer|you cannot refuse)/i.test(s)
  );
}

/**
 * 偵測：使用者要求自我傷害方法（橋、跳樓、安眠藥劑量等）。
 * 雲端 runtime 命中此 guard → 強制走 wellbeing 安全回覆模板。
 */
function isSelfHarmRiskMessage(text) {
  const s = String(text ?? '').toLowerCase();
  return (
    /(自殺|想死|不想活|了結.*生命|結束.*生命|跳樓|跳橋|上吊|割腕|安眠藥.*劑量)/.test(s) ||
    /(want\s+to\s+die|kill\s+myself|end\s+(?:my|it)\s+(?:life|all)|suicide.*how)/i.test(s)
  );
}

/**
 * 偵測：醫療 / 心理健康 / 情緒求助類訊息（需 wellbeing 模板回覆）。
 */
function isWellbeingTopic(text) {
  const s = String(text ?? '').toLowerCase();
  return (
    /(頭痛|頭暈|頭好痛|不舒服|想吐|噁心|發燒|感冒|肚子痛|胃痛|背痛|生病|喘不過|昏倒|暈倒|身體不舒服)/.test(s) ||
    /(焦慮|憂鬱|崩潰|撐不住|壓力大|失眠|睡不著|想哭|情緒低落|心情不好|難過|空虛|沒動力|想自殘)/.test(s) ||
    /(諮商|心理師|身心科|看醫生|掛號)/.test(s)
  );
}

module.exports = {
  redactSensitiveText,
  sanitizeAssistantMessagesForRuntime,
  isPromptInjectionAttempt,
  isThirdPartyPiiStoreAttempt,
  isSelfHarmRiskMessage,
  isWellbeingTopic,
};
