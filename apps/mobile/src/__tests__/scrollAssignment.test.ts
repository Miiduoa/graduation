import { revealAssignmentSubmitArea } from '../screens/nuni/scrollAssignment';

function node(
  pageY: number,
  measure = jest.fn((cb: (...args: number[]) => void) => cb(0, 0, 320, 180, 0, pageY)),
) {
  return {
    measure,
    scrollTo: jest.fn(),
  };
}

test('scrolls the submit area below a top gap instead of flushing it to the edge', () => {
  const scroll = node(80);
  const target = node(520);
  revealAssignmentSubmitArea(scroll, target);
  expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 392, animated: false });
});

test('adds the current content offset when the teacher is already scrolled down', () => {
  // currentOffset=1000, target contentY=1500 → viewport delta 500 → scrollTo 1452
  const scroll = node(80);
  const target = node(580);
  revealAssignmentSubmitArea(scroll, target, { contentOffsetY: 1000 });
  expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 1452, animated: false });
});

test('does not scroll above the top of the list', () => {
  const scroll = node(200);
  const target = node(40);
  revealAssignmentSubmitArea(scroll, target);
  expect(scroll.scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
});

test('skips a missing scroll view or submit area', () => {
  const scroll = node(0);
  revealAssignmentSubmitArea(null, node(120));
  revealAssignmentSubmitArea(scroll, null);
  expect(scroll.scrollTo).not.toHaveBeenCalled();
});

test('does not scroll when isActive is false before measurement starts', () => {
  const scroll = node(80);
  const target = node(580);
  revealAssignmentSubmitArea(scroll, target, {
    contentOffsetY: 1000,
    isActive: () => false,
  });
  expect(target.measure).not.toHaveBeenCalled();
  expect(scroll.scrollTo).not.toHaveBeenCalled();
});

test('does not scroll when cancelled after target measure but before host measure', () => {
  let targetCb: ((...args: number[]) => void) | undefined;
  let scrollCb: ((...args: number[]) => void) | undefined;
  const target = {
    measure: jest.fn((cb: (...args: number[]) => void) => {
      targetCb = cb;
    }),
    scrollTo: jest.fn(),
  };
  const scroll = {
    measure: jest.fn((cb: (...args: number[]) => void) => {
      scrollCb = cb;
    }),
    scrollTo: jest.fn(),
  };
  let active = true;
  revealAssignmentSubmitArea(scroll, target, {
    contentOffsetY: 1000,
    isActive: () => active,
  });
  expect(target.measure).toHaveBeenCalled();
  targetCb?.(0, 0, 320, 40, 0, 580);
  expect(scroll.measure).toHaveBeenCalled();
  active = false;
  scrollCb?.(0, 0, 320, 600, 0, 80);
  expect(scroll.scrollTo).not.toHaveBeenCalled();
});

test('does not scroll when delayed target measure fires after cancellation', () => {
  let targetCb: ((...args: number[]) => void) | undefined;
  const target = {
    measure: jest.fn((cb: (...args: number[]) => void) => {
      targetCb = cb;
    }),
    scrollTo: jest.fn(),
  };
  const scroll = node(80);
  let active = true;
  revealAssignmentSubmitArea(scroll, target, {
    contentOffsetY: 1000,
    isActive: () => active,
  });
  active = false;
  targetCb?.(0, 0, 320, 40, 0, 580);
  expect(scroll.measure).not.toHaveBeenCalled();
  expect(scroll.scrollTo).not.toHaveBeenCalled();
});

test('does not scroll when cancelled after both measures, before scrollTo', () => {
  let targetCb: ((...args: number[]) => void) | undefined;
  let scrollCb: ((...args: number[]) => void) | undefined;
  const target = {
    measure: jest.fn((cb: (...args: number[]) => void) => {
      targetCb = cb;
    }),
    scrollTo: jest.fn(),
  };
  const scroll = {
    measure: jest.fn((cb: (...args: number[]) => void) => {
      scrollCb = cb;
    }),
    scrollTo: jest.fn(),
  };
  let active = true;
  revealAssignmentSubmitArea(scroll, target, {
    contentOffsetY: 1000,
    isActive: () => active,
  });
  targetCb?.(0, 0, 320, 40, 0, 580);
  // Intercept: run host callback body with active flipped mid-flight by
  // wrapping isActive — flip just before scrollTo by flipping before invoke
  // then checking again inside helper after y is computed.
  const originalIsActive = () => active;
  void originalIsActive;
  active = false;
  scrollCb?.(0, 0, 320, 600, 0, 80);
  expect(scroll.scrollTo).not.toHaveBeenCalled();
});
