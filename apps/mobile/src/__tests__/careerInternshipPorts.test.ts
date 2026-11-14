import AsyncStorage from '@react-native-async-storage/async-storage';
import { createCareerInternshipPorts } from '../components/career/careerInternshipPorts';
import { loadPersonalImports } from '../services/personalImports';
import { internshipCalendarItem } from '../../../../packages/shared/src/careerInternship';
import { internshipRecord } from '../../../../packages/shared/testFixtures/careerInternship';
it('writes the deadline into the existing scoped calendar and deduplicates repeated taps', async () => {
  await AsyncStorage.clear();
  const scope = { schoolId: 'pu', owner: 'internship-test' };
  const ports = createCareerInternshipPorts({
    schoolId: 'pu',
    scope,
    active: () => true,
    transport: async () => ({}),
  });
  const item = internshipCalendarItem(internshipRecord(), 0);
  await ports.onAddCalendar(item);
  await ports.onAddCalendar(item);
  const { records } = await loadPersonalImports(scope);
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({
    id: item.id,
    date: '2026-12-01',
    startTime: '17:00',
    kind: 'events',
  });
  await expect(
    createCareerInternshipPorts({
      schoolId: 'pu',
      scope,
      active: () => false,
      transport: async () => ({}),
    }).onAddCalendar(item),
  ).rejects.toThrow();
  expect(() =>
    createCareerInternshipPorts({
      schoolId: 'other',
      scope,
      active: () => true,
      transport: async () => ({}),
    }),
  ).toThrow();
});
