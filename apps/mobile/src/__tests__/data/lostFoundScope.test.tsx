import React from 'react';
import { Text, View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { useLostFoundGenerationScope } from '../../data/lostFoundScope';

let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchool = { id: 'pu' };
let mockAuthUid: string | null = 'alice';

jest.mock('../../state/auth', () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock('../../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../../firebase', () => ({
  getAuthInstance: () => ({ currentUser: mockAuthUid ? { uid: mockAuthUid } : null }),
}));
jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    require('react').useEffect(() => {
      const cleanup = callback();
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    }, [callback]);
  },
}));

function Probe({ recordId = '' }: { recordId?: string }) {
  const { scope, isCurrent, generation } = useLostFoundGenerationScope(recordId);
  return (
    <View>
      <Text>{`scope:${scope}`}</Text>
      <Text>{`current:${isCurrent() ? 'yes' : 'no'}`}</Text>
      <Text>{`generation:${generation}`}</Text>
    </View>
  );
}

beforeEach(() => {
  mockUser = { uid: 'alice' };
  mockSchool = { id: 'pu' };
  mockAuthUid = 'alice';
});

test('generation token changes on identity transition including A→B→A', () => {
  const view = render(<Probe />);
  const first = view.getByText(/scope:/).props.children as string;
  mockUser = { uid: 'bob' };
  mockAuthUid = 'bob';
  view.rerender(<Probe />);
  const second = view.getByText(/scope:/).props.children as string;
  expect(second).not.toBe(first);
  mockUser = { uid: 'alice' };
  mockAuthUid = 'alice';
  view.rerender(<Probe />);
  const third = view.getByText(/scope:/).props.children as string;
  expect(third).not.toBe(second);
  expect(third).not.toBe(first);
});

test('old isCurrent closure stays invalid forever after uid A→B→A; new Alice succeeds', async () => {
  const held: Array<() => boolean> = [];
  function Capture() {
    const scope = useLostFoundGenerationScope('item-1');
    held.push(scope.isCurrent);
    return <Text>{scope.scope}</Text>;
  }
  const view = render(<Capture />);
  await act(async () => undefined);
  const oldAlice = held[held.length - 1];
  expect(oldAlice()).toBe(true);

  mockUser = { uid: 'bob' };
  mockAuthUid = 'bob';
  await act(async () => {
    view.rerender(<Capture />);
  });
  expect(oldAlice()).toBe(false);
  const bob = held[held.length - 1];
  expect(bob()).toBe(true);

  mockUser = { uid: 'alice' };
  mockAuthUid = 'alice';
  await act(async () => {
    view.rerender(<Capture />);
  });
  expect(oldAlice()).toBe(false);
  expect(bob()).toBe(false);
  const newAlice = held[held.length - 1];
  expect(newAlice()).toBe(true);
});

test('old isCurrent closure stays invalid forever after school A→B→A', async () => {
  const held: Array<() => boolean> = [];
  function Capture() {
    const scope = useLostFoundGenerationScope();
    held.push(scope.isCurrent);
    return <Text>{scope.scope}</Text>;
  }
  const view = render(<Capture />);
  await act(async () => undefined);
  const oldPu = held[held.length - 1];
  expect(oldPu()).toBe(true);

  mockSchool = { id: 'nchu' };
  await act(async () => {
    view.rerender(<Capture />);
  });
  expect(oldPu()).toBe(false);

  mockSchool = { id: 'pu' };
  await act(async () => {
    view.rerender(<Capture />);
  });
  expect(oldPu()).toBe(false);
  expect(held[held.length - 1]()).toBe(true);
});

test('actual auth uid disagreement invalidates even if useAuth snapshot lags', async () => {
  let latestIsCurrent: (() => boolean) | null = null;
  function Capture() {
    const scope = useLostFoundGenerationScope();
    latestIsCurrent = scope.isCurrent;
    return <Text>{scope.scope}</Text>;
  }
  render(<Capture />);
  await act(async () => undefined);
  expect(latestIsCurrent?.()).toBe(true);
  mockAuthUid = 'intruder';
  expect(latestIsCurrent?.()).toBe(false);
});

test('confirmed SDK logout invalidates a held callback before useAuth rerenders', async () => {
  let latestIsCurrent: (() => boolean) | null = null;
  function Capture() {
    const scope = useLostFoundGenerationScope();
    latestIsCurrent = scope.isCurrent;
    return <Text>{scope.scope}</Text>;
  }
  render(<Capture />);
  await act(async () => undefined);
  const beforeLogout = latestIsCurrent!;
  expect(beforeLogout()).toBe(true);
  mockAuthUid = null;
  expect(beforeLogout()).toBe(false);
  mockAuthUid = 'alice';
  expect(beforeLogout()).toBe(false);
});

test('blur/unmount invalidates old isCurrent; remounted focus gets a fresh valid closure', async () => {
  let latestIsCurrent: (() => boolean) | null = null;
  let latestFocused = false;
  function Capture() {
    const scope = useLostFoundGenerationScope('item-1');
    latestIsCurrent = scope.isCurrent;
    latestFocused = scope.focused;
    return <Text>{scope.scope}</Text>;
  }
  const view = render(<Capture />);
  await act(async () => undefined);
  const beforeUnmount = latestIsCurrent!;
  expect(latestFocused).toBe(true);
  expect(beforeUnmount()).toBe(true);
  await act(async () => {
    view.unmount();
  });
  expect(beforeUnmount()).toBe(false);

  const again = render(<Capture />);
  await act(async () => undefined);
  expect(beforeUnmount()).toBe(false);
  expect(latestFocused).toBe(true);
  expect(latestIsCurrent?.()).toBe(true);
  await act(async () => {
    again.unmount();
  });
});
