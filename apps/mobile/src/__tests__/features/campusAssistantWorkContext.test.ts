import { httpsCallable } from 'firebase/functions';
import { askCampusAssistant } from '../../features/campusAssistant';
import { readAssistantTimetable } from '../../services/assistantTimetableSource';
import type { AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';

jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: null }), isFirebaseMockMode: () => false,
}));
jest.mock('../../services/assistantTimetableSource', () => ({ readAssistantTimetable: jest.fn() }));

const accountId = 'pa_00000000-0000-4000-8000-000000000075';
const scope = { schoolId: 'pu', uid: '' };
const context = { ...scope, isCurrent: () => true, platformTimetable: { accountId, isCurrent: () => true } };
const request = jest.fn();
const bffRequest = jest.fn();
const ask = (taskProfile: AssistantRoleProfileId, question: string, schoolId = 'pu') => askCampusAssistant({
  ...context, scope: { ...scope, schoolId }, taskProfile, courseworkRequests: { request, bffRequest },
  messages: [{ role: 'user', content: question }],
});

beforeEach(() => { jest.clearAllMocks(); });

test.each<AssistantRoleProfileId>(['student', 'teacher', 'merchant', 'club', 'school', 'platform'])(
  '%s can find the official library directory without reading any personal data', async (profile) => {
    const result = await ask(profile, '查本校圖書館的館藏網址');
    expect(result).toMatchObject({ source: 'device', tool: 'library-directory', libraryDirectory: { schoolId: 'pu' } });
    expect(result.content).toContain('蓋夏圖書館');
    expect(readAssistantTimetable).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(bffRequest).not.toHaveBeenCalled();
    expect(httpsCallable).not.toHaveBeenCalled();
  },
);

test('missing directory and compound tasks do not show a borrowed library or execute a partial appointment', async () => {
  expect(await ask('merchant', '查本校圖書館的館藏網址', 'unknown')).not.toHaveProperty('libraryDirectory');
  const combined = await ask('teacher', '安排明天下午一小時備課，並通知全班');
  expect(combined).toMatchObject({ tool: 'open-service', hasActions: false });
  expect(combined.calendarTask).toBeUndefined();
  expect(readAssistantTimetable).not.toHaveBeenCalled();
  expect(bffRequest).not.toHaveBeenCalled();
});

test.each([
  ['student', '找明天下午一小時備課', '教師與助教'],
  ['teacher', '安排明天下午半小時盤點', '店家'],
] as const)('%s must select the requested work context before reading private availability', async (profile, prompt, label) => {
  const reply = await ask(profile, prompt);
  expect(reply.content).toContain(label);
  expect(reply.calendarTask).toBeUndefined();
  expect(readAssistantTimetable).not.toHaveBeenCalled();
  expect(bffRequest).not.toHaveBeenCalled();
});

test.each([
  ['teacher', '幫我批改學生作業', 'classroom'],
  ['merchant', '查我的門市營運概況，安排明天下午半小時盤點', 'merchant'],
  ['school', '核准學生的請假', 'leave-review'],
  ['platform', '停權這個帳號', 'admin'],
] as const)('%s work stays with the authorized workspace when no native reader or writer is connected', async (profile, prompt, service) => {
  const result = await ask(profile, prompt);
  expect(result.serviceSelection?.serviceIds).toContain(service);
  expect(result.calendarTask).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
  expect(bffRequest).not.toHaveBeenCalled();
  expect(httpsCallable).not.toHaveBeenCalled();
  expect(readAssistantTimetable).not.toHaveBeenCalled();
});

test('work profiles can ask for public information without entering the professional workspace', async () => {
  const phone = await ask('merchant', '查學校電話');
  expect(phone.tool).toBe('school-directory');
  expect(phone.content).toContain('總機');
  const bus = await ask('teacher', '查公車');
  expect(bus.serviceSelection?.serviceIds).toEqual(['bus']);
  expect(request).not.toHaveBeenCalled();
  expect(bffRequest).not.toHaveBeenCalled();
});
