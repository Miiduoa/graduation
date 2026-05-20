import { isDemoUid, shouldUseLiveFirestoreListeners } from '../services/liveFirestoreGate';
import { getDataSourceEvidence } from '../data/source';
import { hasUsableFirebaseConfig, isFirebaseMockMode } from '../firebase';

jest.mock('../data/source', () => ({
  getDataSourceEvidence: jest.fn(),
}));

jest.mock('../firebase', () => ({
  hasUsableFirebaseConfig: jest.fn(),
  isFirebaseMockMode: jest.fn(),
}));

const mockedEvidence = getDataSourceEvidence as jest.Mock;
const mockedHasFirebase = hasUsableFirebaseConfig as jest.Mock;
const mockedMockMode = isFirebaseMockMode as jest.Mock;

describe('liveFirestoreGate', () => {
  beforeEach(() => {
    mockedEvidence.mockReturnValue({ mode: 'firebase', sourceLabel: 'real' });
    mockedHasFirebase.mockReturnValue(true);
    mockedMockMode.mockReturnValue(false);
  });

  it('detects demo users', () => {
    expect(isDemoUid('demo_student_kuchih')).toBe(true);
    expect(isDemoUid('real_user_1')).toBe(false);
    expect(isDemoUid(null)).toBe(false);
  });

  it('does not start listeners for demo users', () => {
    expect(shouldUseLiveFirestoreListeners({ uid: 'demo_teacher' })).toBe(false);
  });

  it('does not start listeners in mock data mode', () => {
    mockedEvidence.mockReturnValue({ mode: 'mock', sourceLabel: 'mock' });

    expect(shouldUseLiveFirestoreListeners({ uid: 'real_user_1' })).toBe(false);
  });

  it('starts listeners only when Firebase and real data are available', () => {
    expect(shouldUseLiveFirestoreListeners({ uid: 'real_user_1' })).toBe(true);

    mockedHasFirebase.mockReturnValue(false);
    expect(shouldUseLiveFirestoreListeners({ uid: 'real_user_1' })).toBe(false);
  });
});
