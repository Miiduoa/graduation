import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { assistantRoleToolAllowed, type AssistantRoleProfileId } from '@campus/shared/src/assistantRoleProfiles';
import { AssistantThread, assistantQuestionReadRoute } from './AssistantThread';

type Props = ComponentProps<typeof AssistantThread>;
const noop = () => {};
function Harness({ initialProfile = 'student', ...props }: Partial<Props> & { initialProfile?: AssistantRoleProfileId }) {
  const [taskProfile, onTaskProfile] = useState<AssistantRoleProfileId>(initialProfile);
  const [question, onQuestion] = useState(props.question ?? '');
  return <AssistantThread schoolId="pu" ready fallback={false} consent onConsent={noop}
    turns={[]} states={{}} pending={false} asking={false} onStopAsk={noop} error=""
    recoverableQuestion="" onRecoverQuestion={noop} onConfirm={noop} onCancel={noop}
    {...props} onAsk={() => {
      expect(assistantQuestionReadRoute(taskProfile, question).roleGuide).toBeNull();
      expect(assistantRoleToolAllowed(taskProfile, taskProfile === 'teacher' ? 'get_teaching_overview' : 'get_merchant_overview')).toBe(true);
      props.onAsk?.();
    }} taskProfile={taskProfile} onTaskProfile={onTaskProfile} question={question} onQuestion={onQuestion} />;
}
const work = () => screen.getByLabelText('目前處理的工作') as HTMLSelectElement;
const profile = () => screen.getByLabelText('目前要處理') as HTMLSelectElement;
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

it.each([
  ['teacher', '查我的授課概況', 'get_teaching_overview'],
  ['merchant', '查我的門市營運概況，查學校電話', 'get_merchant_overview'],
] as const)('selecting %s work updates the submitted profile and lets the overview reach readers', (context, question, tool) => {
  const onAsk = vi.fn();
  render(<Harness question={question} onAsk={onAsk} />);
  fireEvent.change(work(), { target: { value: context } });
  expect(profile().value).toBe(context);
  expect(assistantRoleToolAllowed(profile().value, tool)).toBe(true);
  expect(assistantRoleToolAllowed(profile().value, 'get_due_work')).toBe(false);
  expect(assistantRoleToolAllowed(profile().value, 'list_food_orders')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(onAsk).toHaveBeenCalledOnce();
});

it.each([['teacher', 'teacher'], ['merchant', 'merchant'], ['school', 'staff'], ['platform', 'operator']] as const)(
  'selecting profile %s synchronizes work context %s', (next, context) => {
    render(<Harness />);
    fireEvent.change(profile(), { target: { value: next } });
    expect(work().value).toBe(context);
    expect(profile().value).toBe(next);
  },
);

it('initializes the task profile from loaded workspace preference and preserves manual selection', () => {
  const view = render(<Harness preferredWorkContext="teacher" />);
  expect(profile().value).toBe('teacher');
  fireEvent.change(work(), { target: { value: 'merchant' } });
  view.rerender(<Harness preferredWorkContext="student" />);
  expect(profile().value).toBe('merchant');
  expect(work().value).toBe('merchant');
});

it('initializes explicit overview entries and respects an existing nonstudent task profile', () => {
  const view = render(<Harness question="查我的授課概況" />);
  expect(profile().value).toBe('teacher');
  view.unmount();
  render(<Harness initialProfile="merchant" preferredWorkContext="teacher" />);
  expect(profile().value).toBe('merchant');
  expect(work().value).toBe('merchant');
});

it('locks both selectors while an existing operation prevents a profile change', () => {
  render(<Harness initialProfile="teacher" taskProfileLocked />);
  expect(profile().disabled).toBe(true);
  expect(work().disabled).toBe(true);
  fireEvent.change(work(), { target: { value: 'merchant' } });
  expect(profile().value).toBe('teacher');
  expect(work().value).toBe('teacher');
});
