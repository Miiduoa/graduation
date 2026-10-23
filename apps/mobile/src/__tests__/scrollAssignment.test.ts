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
