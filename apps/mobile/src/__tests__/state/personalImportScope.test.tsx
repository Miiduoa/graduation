import { renderHook } from '@testing-library/react-native';
import { usePersonalImportScope } from '../../state/personalImportScope';

let mockSchool: { schoolId: string | null; selectionReady: boolean };
jest.mock('../../state/auth', () => ({ useAuth: () => ({ loading: false, user: null }) }));
jest.mock('../../state/nuniSession', () => ({
  useNuniSession: () => ({ session: { platformAccountId: 'alice' }, loading: false }),
}));
jest.mock('../../state/school', () => ({ useSchool: () => mockSchool }));

test('imports, reminders and the widget have no data scope until the user has a school', () => {
  mockSchool = { schoolId: 'pu', selectionReady: false };
  const hook = renderHook(() => usePersonalImportScope());
  expect(hook.result.current).toBeNull();
  mockSchool = { schoolId: null, selectionReady: true };
  hook.rerender({});
  expect(hook.result.current).toBeNull();
  mockSchool = { schoolId: 'ncnu', selectionReady: true };
  hook.rerender({});
  expect(hook.result.current).toEqual({ owner: 'nuni:alice', schoolId: 'ncnu' });
  mockSchool = { schoolId: null, selectionReady: true };
  hook.rerender({});
  expect(hook.result.current).toBeNull();
});
