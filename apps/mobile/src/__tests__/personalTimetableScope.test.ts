import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDoc } from 'firebase/firestore';
import {
  loadPersonalTimetable,
  savePersonalTimetable,
  type StoredTimetable,
} from '../services/personalTimetable';

jest.mock('../firebase', () => ({ getDb: jest.fn(), getFunctionsInstance: jest.fn() }));
jest.mock('firebase/firestore', () => ({
  getDoc: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: jest.fn(),
  collection: jest.fn(),
}));
const make = (schoolId: string): StoredTimetable => ({
  schoolId,
  shareWithFriends: false,
  courses: [
    { id: 'c1', name: '私人成績', teacher: '', room: '', day: 1, start: 1, end: 2, color: 'blue' },
  ],
  meta: { school: '', year: '115', semester: '1', className: '', credits: 0, title: '' },
  updatedAt: '2026-10-13T00:00:00.000Z',
});
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(getDoc).mockReset();
});

test('old school cache cannot appear in another selected school', async () => {
  await AsyncStorage.setItem('campus-one-personal-timetable:local', JSON.stringify(make('pu')));
  expect((await loadPersonalTimetable(null, 'ntu')).courses).toEqual([]);
  expect((await loadPersonalTimetable(null, 'pu')).courses).toHaveLength(1);
});
test('new saves keep per-school local schedules and reject a mismatched cloud fallback', async () => {
  await savePersonalTimetable(null, make('pu'));
  await savePersonalTimetable(null, { ...make('ntu'), courses: [] });
  expect((await loadPersonalTimetable(null, 'pu')).courses).toHaveLength(1);
  jest.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => make('pu') } as never);
  expect((await loadPersonalTimetable('account', 'ntu')).courses).toEqual([]);
});

test('platform accounts never inherit guest or another platform account timetable', async () => {
  await savePersonalTimetable(null, make('pu'));
  expect((await loadPersonalTimetable(null, 'pu', 'nuni:account-a')).courses).toEqual([]);
  await savePersonalTimetable(null, make('pu'), 'nuni:account-a');
  expect((await loadPersonalTimetable(null, 'pu', 'nuni:account-a')).courses).toHaveLength(1);
  expect((await loadPersonalTimetable(null, 'pu', 'nuni:account-b')).courses).toEqual([]);
  expect((await loadPersonalTimetable(null, 'ntu', 'nuni:account-a')).courses).toEqual([]);
  expect(getDoc).not.toHaveBeenCalled();
});

test.each([
  '{broken-json',
  JSON.stringify({ ...make('pu'), courses: {} }),
  JSON.stringify({ ...make('pu'), courses: [null] }),
  JSON.stringify({ ...make('pu'), meta: null }),
])('an unreadable stored timetable is reported and cannot be overwritten: %s', async (raw) => {
  const key = 'campus-one-personal-timetable:nuni:account-a:pu';
  await AsyncStorage.setItem(key, raw);
  await expect(loadPersonalTimetable(null, 'pu', 'nuni:account-a')).rejects.toThrow('已保留原始資料');
  await expect(savePersonalTimetable(null, make('pu'), 'nuni:account-a')).rejects.toThrow('已保留原始資料');
  expect(await AsyncStorage.getItem(key)).toBe(raw);
});
