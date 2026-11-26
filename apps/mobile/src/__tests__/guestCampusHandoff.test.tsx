import React from 'react';
import { render } from '@testing-library/react-native';
import { GuestCampusHandoffProvider, useGuestCampusHandoff } from '../app/guestCampusHandoff';

let current: ReturnType<typeof useGuestCampusHandoff>;
function NavigationProbe() {
  current = useGuestCampusHandoff();
  return null;
}
function app(identity: string, navigationKey: string, enabled = true) {
  return (
    <GuestCampusHandoffProvider identity={identity} enabled={enabled}>
      <NavigationProbe key={navigationKey} />
    </GuestCampusHandoffProvider>
  );
}
const destination = { route: 'Library', schoolId: 'pu' } as const;

test('a selected service survives the school-scoped navigation remount once', () => {
  const view = render(app('guest', 'no-school'));
  current!.remember(destination);
  view.rerender(app('guest', 'pu'));
  expect(current!.consume('pu', 'LoginLanding')).toBe('Library');
  expect(current!.consume('pu', 'LoginLanding')).toBeUndefined();
});

test.each([
  ['ntu', 'LoginLanding'],
  ['pu', 'PersonalCalendar'],
  ['pu', undefined],
])(
  'consuming against a different school or an existing navigation destination drops the intent',
  (school, route) => {
    render(app('guest', 'no-school'));
    current!.remember(destination);
    expect(current!.consume(school!, route)).toBeUndefined();
    expect(current!.consume('pu', 'LoginLanding')).toBeUndefined();
  },
);

test('a cancelled selection, another account or a privileged session cannot replay a guest choice', () => {
  const view = render(app('guest', 'no-school'));
  current!.remember(destination);
  current!.clear();
  expect(current!.consume('pu', 'LoginLanding')).toBeUndefined();
  const former = current!;
  former.remember(destination);
  view.rerender(app('other-account', 'pu'));
  former.remember(destination);
  expect(former.consume('pu', 'LoginLanding')).toBeUndefined();
  expect(current!.consume('pu', 'LoginLanding')).toBeUndefined();
  current!.remember(destination);
  view.rerender(app('other-account', 'pu', false));
  expect(current).toBeNull();
  view.rerender(app('other-account', 'pu'));
  expect(current!.consume('pu', 'LoginLanding')).toBeUndefined();
});

test('a former identity generation stays revoked when the same account or public mode returns', () => {
  const view = render(app('account-a', 'no-school'));
  const firstA = current!;
  view.rerender(app('account-b', 'pu'));
  view.rerender(app('account-a', 'pu'));
  firstA.remember(destination);
  expect(firstA.consume('pu', 'LoginLanding')).toBeUndefined();
  const secondA = current!;
  view.rerender(app('account-a', 'pu', false));
  view.rerender(app('account-a', 'pu'));
  secondA.remember(destination);
  expect(secondA.consume('pu', 'LoginLanding')).toBeUndefined();
  current!.remember(destination);
  expect(current!.consume('pu', 'LoginLanding')).toBe('Library');
});
