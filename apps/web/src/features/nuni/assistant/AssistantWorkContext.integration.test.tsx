import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
    {...props} onAsk={props.onAsk ?? noop} taskProfile={taskProfile} onTaskProfile={next => {
      props.onTaskProfile?.(next);
      onTaskProfile(next);
    }} question={question} onQuestion={onQuestion} />;
}
const work = () => screen.getByLabelText('目前處理的工作') as HTMLSelectElement;
const profile = () => screen.getByLabelText('目前要處理') as HTMLSelectElement;
beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); });

it.each([
  ['teacher', '查我的授課概況', 'get_teaching_overview'],
  ['merchant', '查我的門市營運概況，查學校電話', 'get_merchant_overview'],
] as const)('selecting %s work updates the submitted profile and lets the overview reach readers', (context, question, tool) => {
  const onAsk = vi.fn(() => {
    expect(assistantQuestionReadRoute(profile().value as AssistantRoleProfileId, question).roleGuide).toBeNull();
    expect(assistantRoleToolAllowed(profile().value, tool)).toBe(true);
  });
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

it.each(['teacher', 'merchant'] as const)('uses the %s workspace preference only for examples and preserves manual selection', preferredWorkContext => {
  const onTaskProfile = vi.fn();
  const onAsk = vi.fn(() => expect(profile().value).toBe('student'));
  const view = render(<Harness preferredWorkContext={preferredWorkContext} onTaskProfile={onTaskProfile} onAsk={onAsk} />);
  expect(profile().value).toBe('student');
  expect(work().value).toBe(preferredWorkContext);
  expect(onTaskProfile).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: preferredWorkContext === 'teacher' ? '查我的授課概況' : '查我的門市營運概況' }));
  fireEvent.click(screen.getByRole('button', { name: '送出' }));
  expect(onAsk).toHaveBeenCalledOnce();
  expect(onTaskProfile).not.toHaveBeenCalled();
  fireEvent.change(work(), { target: { value: 'merchant' } });
  expect(onTaskProfile).toHaveBeenCalledExactlyOnceWith('merchant');
  view.rerender(<Harness preferredWorkContext="student" />);
  expect(profile().value).toBe('merchant');
  expect(work().value).toBe('merchant');
});

it('shows the loaded workspace preference on the first render without changing the task profile', () => {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(<Harness preferredWorkContext="teacher" />);
  const selects = Array.from(container.querySelectorAll('select'));
  expect(selects.map(select => select.value)).toEqual(['student', 'teacher']);
});

it('initializes explicit overview entries and respects an existing nonstudent task profile', () => {
  const view = render(<Harness question="查我的授課概況" />);
  expect(profile().value).toBe('teacher');
  view.unmount();
  render(<Harness initialProfile="merchant" preferredWorkContext="teacher" />);
  expect(profile().value).toBe('merchant');
  expect(work().value).toBe('merchant');
});

it('locks only the profile while work context changes examples without changing the existing operation', () => {
  const onTaskProfile = vi.fn();
  const onAsk = vi.fn();
  const view = render(<Harness initialProfile="teacher" taskProfileLocked onTaskProfile={onTaskProfile} onAsk={onAsk} />);
  const conversation = screen.getByRole('log');
  expect(profile().disabled).toBe(true);
  expect(work().disabled).toBe(false);
  fireEvent.change(work(), { target: { value: 'merchant' } });
  expect(profile().value).toBe('teacher');
  expect(work().value).toBe('merchant');
  expect(screen.getByRole('button', { name: '查我的門市營運概況' })).toBeTruthy();
  expect(screen.getByRole('log')).toBe(conversation);
  expect(onTaskProfile).not.toHaveBeenCalled();
  expect(onAsk).not.toHaveBeenCalled();
  view.rerender(<Harness initialProfile="teacher" onTaskProfile={onTaskProfile} onAsk={onAsk} />);
  expect(profile().value).toBe('teacher');
  expect(onTaskProfile).not.toHaveBeenCalled();
  fireEvent.change(work(), { target: { value: 'teacher' } });
  expect(onTaskProfile).toHaveBeenCalledExactlyOnceWith('teacher');
});
