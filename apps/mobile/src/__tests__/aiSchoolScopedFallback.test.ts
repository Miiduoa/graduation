import {
  buildCheckBusOfflineMessage,
  buildSchoolScopedEmergencyFallback,
  buildSchoolScopedTransportDirections,
  buildSchoolScopedTransportQuickReply,
  buildSchoolScopedWeatherQuickReply,
} from '../features/aiSchoolScopedFallback';
import {
  buildAgentSystemPromptForSchool,
} from '../services/agentReasoningEngine';
import { resolveSchoolAssistantIdentity } from '@campus/shared/src';

test('PU weather and transport quick replies keep Providence facts', () => {
  expect(buildSchoolScopedWeatherQuickReply('pu').content).toContain('沙鹿');
  expect(buildSchoolScopedTransportQuickReply('tw-pu').content).toContain('300/307/308');
  expect(buildCheckBusOfflineMessage('pu')).toContain('台中公車');
});

test('non-PU weather/transport never invent Providence routes', () => {
  const weather = buildSchoolScopedWeatherQuickReply('ncku', '國立成功大學');
  expect(weather.content).toContain('國立成功大學');
  expect(weather.content).not.toContain('沙鹿');
  expect(weather.content).not.toContain('300/307/308');

  const transport = buildSchoolScopedTransportQuickReply('nthu', '國立清華大學');
  expect(transport.content).toContain('國立清華大學');
  expect(transport.content).not.toContain('靜宜');
  expect(transport.actions?.some((a) => a.params.nested === 'BusV2')).toBe(true);
});

test('transport directions are PU-only; other schools get grounded unavailable copy', () => {
  const pu = buildSchoolScopedTransportDirections('pu', '怎麼去台中車站');
  expect(pu?.content).toContain('靜宜大學');

  const other = buildSchoolScopedTransportDirections('ntpu', '怎麼去車站', '國立臺北大學');
  expect(other?.content).toContain('國立臺北大學');
  expect(other?.content).not.toContain('300、307');
});

test('emergency fallback uses official library link or loaded snippets for non-PU', () => {
  const libraryReply = buildSchoolScopedEmergencyFallback({
    schoolId: 'ncku',
    schoolName: '國立成功大學',
    userText: '圖書館開放時間',
  });
  expect(libraryReply?.content).toContain('lib.ncku.edu.tw');
  expect(libraryReply?.content).not.toMatch(/08:00-21:30/);
  expect(libraryReply?.content).not.toContain('靜宜');

  const snippetReply = buildSchoolScopedEmergencyFallback({
    schoolId: 'tenant-x',
    schoolName: '示範他校',
    userText: '選課規定是什麼',
    loadedPublicSnippets: ['加退選公告'],
  });
  expect(snippetReply?.content).toContain('加退選公告');
  expect(snippetReply?.content).not.toMatch(/25 學分/);
  expect(snippetReply?.content).not.toContain('靜宜');
});

test('assistant identity and agent prompt do not claim PU for other schools', () => {
  const identity = resolveSchoolAssistantIdentity('nthu', '國立清華大學');
  expect(identity.assistantLabel).not.toContain('靜宜');
  expect(identity.schoolName).toBe('國立清華大學');

  const prompt = buildAgentSystemPromptForSchool('nthu', '國立清華大學');
  expect(prompt).toContain('國立清華大學');
  expect(prompt).not.toContain('靜宜小幫手');
  expect(prompt).toContain('不可把其他學校');
});
