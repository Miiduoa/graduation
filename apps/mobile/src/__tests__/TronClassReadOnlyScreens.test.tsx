import React from 'react';
import { render } from '@testing-library/react-native';
import CourseDiscussionScreen from '../screens/CourseDiscussionScreen';
import PeerReviewSubmitScreen from '../screens/PeerReviewSubmitScreen';
import SurveyScreen from '../screens/SurveyScreen';
import { tcFetchDiscussions, tcFetchPeerReviews } from '../services/tronClassClient';

jest.mock('../state/auth', () => ({ useAuth: () => ({}) }));
jest.mock('../services/tronClassClient', () => ({
  isTronClassWriteLocked: () => true,
  TRONCLASS_WRITE_LOCKED_MESSAGE: '目前僅提供閱讀，送出功能尚未開放',
  tcFetchDiscussions: jest.fn(),
  tcFetchPeerReviews: jest.fn(),
}));

const readOnlyNotice = '目前僅提供閱讀，送出功能尚未開放';

test('discussion threads remain readable while the composer is hidden', async () => {
  jest.mocked(tcFetchDiscussions).mockResolvedValue([{
    id: 303,
    course_id: 101,
    title: '教材討論',
    description: null,
    post_count: 0,
    created_at: null,
    last_post_at: null,
    is_locked: false,
  }]);
  const view = render(<CourseDiscussionScreen route={{ params: { groupId: 'tc:101' } }} />);

  expect(await view.findByText(readOnlyNotice)).toBeTruthy();
  expect(view.getByRole('button', { name: '討論：教材討論' })).toBeTruthy();
  expect(view.queryByRole('button', { name: '發起新討論' })).toBeNull();
  expect(view.queryByPlaceholderText('想討論的問題（限 60 字）')).toBeNull();
});

test('survey questions are visible while choices and free text are read-only', () => {
  const view = render(<SurveyScreen />);

  expect(view.getByText(readOnlyNotice)).toBeTruthy();
  for (const name of ['非常滿意', '課堂講授', '1']) {
    expect(view.getByRole('button', { name })).toBeDisabled();
  }
  expect(view.getByPlaceholderText('自由作答（可空白）').props.editable).toBe(false);
  expect(view.queryByText('送出問卷')).toBeNull();
});

test('peer review keeps the rubric readable while disabling scores and feedback', async () => {
  jest.mocked(tcFetchPeerReviews).mockResolvedValue([{
    id: 505,
    assignment_title: '互評作業',
    target_submission_id: 606,
    target_anonymous_name: '同學 A',
    submitted: false,
    rubric: null,
  }]);
  const view = render(<PeerReviewSubmitScreen route={{ params: { courseId: '101' } }} />);

  expect(await view.findByText('互評作業')).toBeTruthy();
  expect(view.getByText(readOnlyNotice)).toBeTruthy();
  expect(view.getByRole('button', { name: '論述清晰：優，4 分' })).toBeDisabled();
  expect(view.getByLabelText('論述清晰的逐項回饋').props.editable).toBe(false);
  expect(view.getByPlaceholderText('例如：你的論述很清晰，但建議補一個反例會更有說服力。').props.editable).toBe(false);
  expect(view.queryByRole('button', { name: /送出互評/ })).toBeNull();
});
