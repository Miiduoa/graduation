import { schoolFromSelection } from '../../state/school';

test('school selection follows the requested school instead of staying on Providence', () => {
  expect(schoolFromSelection({ schoolId: 'nthu' }).id).toBe('nthu');
  expect(schoolFromSelection({ schoolId: 'pu' }).id).toBe('pu');
  expect(schoolFromSelection({}).id).toBe('pu');
});
