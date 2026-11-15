import { getSchoolContactAnswer } from '@campus/shared/src/schoolContactAnswer';
import { formatPublicSchoolAddress, publicSchoolInfoDirectory } from '@campus/shared/src/publicSchoolInfo';
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

test.each(['pu', 'tw-pu'])('PU dorm fallback states official card access hours for %s', (schoolId) => {
  const reply = buildSchoolScopedEmergencyFallback({ schoolId, userText: '宿舍門禁時間' });
  expect(reply?.content).toContain('24 小時以學生證刷卡進出，00:00–06:00 須刷卡登記');
  expect(reply?.content).not.toContain('23:00');
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

test('every bundled institution answers its own address, switchboard and official website with MOE provenance', () => {
  const schools = Object.values(publicSchoolInfoDirectory);
  expect(schools.length).toBe(138);
  for (const school of schools) {
    const answer = getSchoolContactAnswer(school.id, '請問學校的聯絡方式？', school.name);
    expect(answer).toContain(school.name);
    expect(answer).toContain(formatPublicSchoolAddress(school));
    expect(answer).toContain(school.telephone);
    expect(answer).toContain(school.websiteUrl);
    expect(answer).toContain('教育部');
  }
});

test('switches campuses and resolves explicit legacy IDs without reusing names or addresses', () => {
  const ask = (schoolId: string, userText: string) => buildSchoolScopedEmergencyFallback({ schoolId, userText })?.content;
  expect(ask('tw-pu', '學校地址在哪裡？')).toContain('臺中市沙鹿區');
  expect(ask('tw-nchu', '本校的總機電話')).toContain(publicSchoolInfoDirectory.nchu.telephone);
  expect(ask('nthu', '國立清華大學的官方網站是什麼？')).toContain(publicSchoolInfoDirectory.nthu.websiteUrl);
  expect(getSchoolContactAnswer('nthu', '如何聯絡學校？')).toContain(publicSchoolInfoDirectory.nthu.telephone);
  expect(getSchoolContactAnswer('nthu', '學校地址', '靜宜大學')).toBeNull();
  expect(getSchoolContactAnswer('other', '學校地址')).toBeNull();
  expect(getSchoolContactAnswer(null, '學校地址')).toBeNull();
});

test.each(['我的電話', '學校教務處電話', '學校圖書館官網', '學校緊急聯絡電話', '校安中心電話',
  '學校地址和我的住址', '國立清華大學的總機', '請問清大電話', '學校官網怎麼操作', '如何聯絡學校的老師',
  '總機電話是什麼意思', '幫我翻譯學校地址', '學校第一校區地址', '我的地址在哪裡'])(
  'does not use the selected institution switchboard or address for %s', (question) => {
    expect(getSchoolContactAnswer('pu', question)).toBeNull();
    expect(buildSchoolScopedEmergencyFallback({ schoolId: 'pu', userText: question })?.content ?? '')
      .not.toMatch(/2632-?8001|台灣大道七段 200 號/);
  },
);
