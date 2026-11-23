import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import CourseDiscussionScreen from '../screens/CourseDiscussionScreen';
import PeerReviewSubmitScreen from '../screens/PeerReviewSubmitScreen';
import SurveyScreen from '../screens/SurveyScreen';
import { Alert } from 'react-native';
import {
  tcFetchDiscussions,
  tcFetchPeerReviews,
  tcPostDiscussion,
  tcSubmitPeerReview,
  tcSubmitSurvey,
} from '../services/tronClassClient';

jest.mock('../state/auth', () => ({ useAuth: () => ({}) }));
jest.mock('../services/companionHooks', () => ({
  onDiscussionPosted: jest.fn(),
  onPeerReviewGiven: jest.fn(),
}));
jest.mock('../services/roleEventBus', () => ({
  emitDiscussionPosted: jest.fn(),
  emitHelpRequested: jest.fn(),
}));
jest.mock('../services/tronClassClient', () => ({
  isTronClassWriteLocked: () => true,
  TRONCLASS_WRITE_LOCKED_MESSAGE: '目前僅提供閱讀，送出功能尚未開放',
  tcFetchDiscussions: jest.fn(),
  tcFetchPeerReviews: jest.fn(),
  tcPostDiscussion: jest.fn(),
  tcSubmitPeerReview: jest.fn(),
  tcSubmitSurvey: jest.fn(),
}));

const demoCourseId = '71378';
const rubric = {
  id: 'rubric',
  title: '互評規準',
  criteria: [{
    id: 'clarity',
    title: '論述清晰',
    weight: 100,
    levels: [{ id: 'excellent', label: '優', points: 4 }],
  }],
};

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

test.each(['101', demoCourseId])('survey course %s shows questions with choices and free text read-only', (courseId) => {
  const view = render(<SurveyScreen route={{ params: {
    courseId: `tc:${courseId}`,
    surveyId: 'tc:404',
    questions: [
      { id: 'q1', type: 'single', prompt: '滿意度', options: [{ id: 'a', label: '非常滿意' }] },
      { id: 'q2', type: 'multi', prompt: '課程環節', options: [{ id: 'b', label: '課堂講授' }] },
      { id: 'q3', type: 'scale', prompt: '難度' },
      { id: 'q4', type: 'text', prompt: '回饋' },
    ],
  } }} />);

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
  const view = render(<PeerReviewSubmitScreen route={{ params: { courseId: '101', rubric } }} />);

  expect(await view.findByText('互評作業')).toBeTruthy();
  expect(view.getByText(readOnlyNotice)).toBeTruthy();
  expect(view.getByRole('button', { name: '論述清晰：優，4 分' })).toBeDisabled();
  expect(view.getByLabelText('論述清晰的逐項回饋').props.editable).toBe(false);
  expect(view.getByPlaceholderText('例如：你的論述很清晰，但建議補一個反例會更有說服力。').props.editable).toBe(false);
  expect(view.queryByRole('button', { name: /送出互評/ })).toBeNull();
});

test('demo discussions can be posted locally with TronClass writes locked', async () => {
  const view = render(<CourseDiscussionScreen route={{ params: { groupId: `tc:${demoCourseId}` } }} />);

  fireEvent.press(await view.findByRole('button', { name: '發起新討論' }));
  fireEvent.changeText(view.getByLabelText('討論標題'), '本機討論');
  fireEvent.press(view.getByRole('button', { name: '送出討論' }));

  expect(await view.findByRole('button', { name: '討論：本機討論' })).toBeTruthy();
  expect(view.queryByText(readOnlyNotice)).toBeNull();
  expect(tcPostDiscussion).not.toHaveBeenCalled();
});

test('sample surveys can be completed with TronClass writes locked', async () => {
  const view = render(<SurveyScreen route={{ params: { courseId: '101', surveyId: '404' } }} />);

  fireEvent.press(view.getByRole('button', { name: '非常滿意' }));
  fireEvent.press(view.getByRole('button', { name: '1' }));
  fireEvent.press(view.getByText('送出問卷'));

  expect(await view.findByText('✅ 已提交，謝謝你的回饋')).toBeTruthy();
  expect(view.queryByText(readOnlyNotice)).toBeNull();
  expect(tcSubmitSurvey).not.toHaveBeenCalled();
});

test('a peer review with a demo-list course ID and valid submit params remains read-only', async () => {
  const view = render(<PeerReviewSubmitScreen route={{ params: {
    courseId: demoCourseId,
    reviewId: '80001',
    rubric,
  } }} />);

  expect(await view.findByText('HW3 K-means 互評')).toBeTruthy();
  expect(view.getByText(readOnlyNotice)).toBeTruthy();
  expect(view.getByRole('button', { name: '論述清晰：優，4 分' })).toBeDisabled();
  expect(view.queryByRole('button', { name: /送出互評/ })).toBeNull();
  expect(tcSubmitPeerReview).not.toHaveBeenCalled();
});

test('sample peer reviews can be completed with TronClass writes locked', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const view = render(<PeerReviewSubmitScreen route={{ params: {
      reviewId: '80001',
      rubric,
    } }} />);

    fireEvent.press(await view.findByRole('button', { name: '論述清晰：優，4 分' }));
    fireEvent.press(view.getByRole('button', { name: '送出互評' }));

    await waitFor(() => expect(alert).toHaveBeenCalledWith(
      '✅ 互評已送出',
      expect.any(String),
      expect.any(Array),
    ));
    expect(view.queryByText(readOnlyNotice)).toBeNull();
    expect(tcSubmitPeerReview).not.toHaveBeenCalled();
  } finally {
    alert.mockRestore();
  }
});
