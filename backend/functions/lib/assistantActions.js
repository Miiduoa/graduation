'use strict';

const { normalizeAssistantActions } = require('../assistantAgent');
const { normalizeAssistantText: normText } = require('./assistantFormat');

function assistantAction({
  label,
  action,
  params = {},
  requiresConfirmation = false,
  sensitivity = 'low',
  evidenceRefs = [],
  permissionScope = 'school_public',
}) {
  return {
    label,
    action,
    params,
    requiresConfirmation,
    sensitivity,
    permissionScope,
    evidenceRefs,
    status: requiresConfirmation ? 'pending_confirmation' : 'proposed',
  };
}

const ASSISTANT_ROLE_ACTION_ALLOWLIST = {
  student: new Set([
    'navigate',
    'start_navigation',
    'schedule_reminder',
    'create_reminder_draft',
    'split_assignment',
    'draft_message',
    'queue_action',
    'open_url',
    'review_ai_suggestion',
  ]),
  teacher: new Set([
    'navigate',
    'start_navigation',
    'schedule_reminder',
    'create_reminder_draft',
    'draft_message',
    'submit_draft',
    'queue_action',
    'open_url',
    'review_ai_suggestion',
  ]),
  staff: new Set([
    'navigate',
    'start_navigation',
    'draft_message',
    'submit_draft',
    'queue_action',
    'open_url',
    'review_ai_suggestion',
  ]),
  department: new Set([
    'navigate',
    'start_navigation',
    'draft_message',
    'submit_draft',
    'queue_action',
    'open_url',
    'review_ai_suggestion',
  ]),
  admin: new Set([
    'navigate',
    'start_navigation',
    'draft_message',
    'submit_draft',
    'queue_action',
    'open_url',
    'review_ai_suggestion',
  ]),
  school: new Set([
    'navigate',
    'start_navigation',
    'draft_message',
    'submit_draft',
    'queue_action',
    'open_url',
    'review_ai_suggestion',
  ]),
};

function resolveAssistantActorRole(rawRole) {
  const role = String(rawRole || '').toLowerCase();
  if (role === 'teacher' || role === 'professor') return 'teacher';
  if (role === 'staff') return 'staff';
  if (role === 'admin' || role === 'principal') return 'admin';
  if (role === 'department') return 'department';
  if (role === 'school') return 'school';
  return 'student';
}

function filterAssistantActionsByRole(actions, role, permissionScope = 'school_public') {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const allowlist =
    ASSISTANT_ROLE_ACTION_ALLOWLIST[role] || ASSISTANT_ROLE_ACTION_ALLOWLIST.student;
  return normalizeAssistantActions(actions, permissionScope).filter(
    (item) => item && allowlist.has(item.action),
  );
}

function buildPoiResponse(queryText, pois) {
  const normalizedQuery = normText(queryText);
  if (!normalizedQuery || pois.length === 0) return null;

  const best = pois
    .map((poi) => {
      let score = 0;
      const haystacks = [poi.name, poi.category, poi.description].map((value) =>
        String(value ?? ''),
      );
      haystacks.forEach((value) => {
        if (normalizedQuery.includes(value) || value.includes(normalizedQuery)) score += 3;
      });
      ['圖書館', '行政', '餐廳', '宿舍', '健康', '教室'].forEach((keyword) => {
        if (normalizedQuery.includes(keyword) && haystacks.some((value) => value.includes(keyword)))
          score += 2;
      });
      return { poi, score };
    })
    .sort((a, b) => b.score - a.score)[0];

  return best?.score > 0 ? best.poi : pois[0];
}

module.exports = {
  assistantAction,
  ASSISTANT_ROLE_ACTION_ALLOWLIST,
  resolveAssistantActorRole,
  filterAssistantActionsByRole,
  buildPoiResponse,
};
