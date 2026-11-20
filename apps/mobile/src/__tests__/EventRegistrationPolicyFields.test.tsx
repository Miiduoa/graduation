import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import {
  EventRegistrationPolicyFields,
  registrationPolicyDraft,
  registrationPolicyInput,
} from '../components/EventRegistrationPolicyFields';
test('old events default to disabled and opening requires an explicit free acknowledgement and dates', () => {
  const draft = registrationPolicyDraft();
  expect(registrationPolicyInput(draft)).toEqual({ enabled: false });
  expect(() => registrationPolicyInput({ ...draft, enabled: true })).toThrow('免費');
  expect(() => registrationPolicyInput({ ...draft, enabled: true, free: true })).toThrow('期限');
});
test('policy dates are explicitly Taiwan time and impossible dates are rejected', () => {
  const draft = {
    ...registrationPolicyDraft(),
    enabled: true,
    free: true,
    opensAt: '2030-01-01 08:00',
    closesAt: '2030-01-02 08:00',
  };
  expect(registrationPolicyInput(draft)).toMatchObject({
    opensAt: '2030-01-01T00:00:00.000Z',
    closesAt: '2030-01-02T00:00:00.000Z',
    allowCancellation: false,
    cancellationClosesAt: null,
  });
  expect(() => registrationPolicyInput({ ...draft, closesAt: '2030-02-30 08:00' })).toThrow();
  expect(() => registrationPolicyInput({ ...draft, allowCancellation: true })).toThrow();
});
test('existing policy displays dates and keeps cancellation explicit', () => {
  const value = registrationPolicyDraft({
    enabled: true,
    free: true,
    opensAt: { toDate: () => new Date('2030-01-01T00:00:00Z') },
    closesAt: '2030-01-02T00:00:00Z',
    allowCancellation: false,
  });
  expect(value.opensAt).toBe('2030-01-01 08:00');
  const onChange = jest.fn();
  const view = render(<EventRegistrationPolicyFields value={value} onChange={onChange} />);
  expect(view.getByText(/人數上限沿用/)).toBeTruthy();
  fireEvent(view.getByLabelText('允許本人取消報名'), 'valueChange', true);
  expect(onChange).toHaveBeenCalledWith({ ...value, allowCancellation: true });
});
