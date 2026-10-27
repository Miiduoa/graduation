import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, TextInput, View } from 'react-native';
import { Input, PasswordInput } from '../../ui/FormComponents';
import { applyTheme, clearSchoolTheme, theme } from '../../ui/theme';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  clearSchoolTheme();
  applyTheme('light');
});
afterEach(() => act(() => applyTheme('light')));

test('caller focus handlers compose with the input focus styling', () => {
  const onFocus = jest.fn();
  const onBlur = jest.fn();
  const view = render(<Input label="姓名" onFocus={onFocus} onBlur={onBlur} />);
  const borderColor = () =>
    view
      .UNSAFE_getAllByType(View)
      .map((node) => StyleSheet.flatten(node.props.style))
      .find((style) => style?.borderWidth === 1)?.borderColor;
  const focusEvent = { nativeEvent: { target: 1 } };
  const input = view.getByLabelText('姓名');
  expect(borderColor()).toBe(theme.colors.border);
  fireEvent(input, 'focus', focusEvent);
  expect(onFocus).toHaveBeenCalledWith(focusEvent);
  expect(borderColor()).toBe(theme.colors.accent);
  fireEvent(input, 'blur', focusEvent);
  expect(onBlur).toHaveBeenCalledWith(focusEvent);
  expect(borderColor()).toBe(theme.colors.border);
});

test('explicit disabled cannot be undone by native editing or accessibility props', () => {
  const onChangeText = jest.fn();
  const onFocus = jest.fn();
  const onRightIconPress = jest.fn();
  const view = render(
    <Input
      label="班級"
      disabled
      editable
      readOnly={false}
      aria-disabled={false}
      accessibilityState={{ disabled: false }}
      onFocus={onFocus}
      onChangeText={onChangeText}
      rightIcon="close"
      onRightIconPress={onRightIconPress}
      rightIconAccessibilityLabel="清除班級"
    />,
  );
  const input = view.UNSAFE_getByType(TextInput);
  expect(input.props.editable).toBe(false);
  expect(input.props.readOnly).toBe(true);
  expect(view.getByLabelText('班級')).toHaveAccessibilityState({ disabled: true });
  fireEvent.changeText(view.getByLabelText('班級'), '三年一班');
  fireEvent(view.getByLabelText('班級'), 'focus');
  fireEvent.press(view.getByRole('button', { name: '清除班級' }));
  expect(view.getByRole('button', { name: '清除班級' })).toBeDisabled();
  expect(onChangeText).not.toHaveBeenCalled();
  expect(onFocus).not.toHaveBeenCalled();
  expect(onRightIconPress).not.toHaveBeenCalled();
});

test.each([{ editable: false }, { readOnly: true }, { 'aria-disabled': true }])(
  'native non-editable props keep the right action disabled: %j',
  (props) => {
    const view = render(<PasswordInput label="密碼" {...props} />);
    expect(view.getByLabelText('密碼')).toHaveAccessibilityState({ disabled: true });
    expect(view.getByRole('button', { name: '顯示密碼' })).toBeDisabled();
  },
);

test('password reveal has an actionable label that follows its visibility', () => {
  const view = render(<PasswordInput label="密碼" value="password" />);
  expect(view.UNSAFE_getByType(TextInput).props.secureTextEntry).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '顯示密碼' }));
  expect(view.UNSAFE_getByType(TextInput).props.secureTextEntry).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '隱藏密碼' }));
  expect(view.UNSAFE_getByType(TextInput).props.secureTextEntry).toBe(true);
});

test('labels expose required and error guidance without losing caller callbacks', () => {
  const onChange = jest.fn();
  const onChangeText = jest.fn();
  const view = render(
    <Input
      label="學號"
      required
      hint="請填寫學號"
      error="學號格式有誤"
      accessibilityLabel="學生學號"
      accessibilityHint="共八位數"
      onChange={onChange}
      onChangeText={onChangeText}
    />,
  );
  const input = view.getByLabelText('學生學號');
  expect(input.props.accessibilityHint).toBe('必填。學號格式有誤。共八位數');
  const changeEvent = { nativeEvent: { text: '12345678', eventCount: 1, target: 1 } };
  fireEvent(input, 'change', changeEvent);
  fireEvent.changeText(input, '12345678');
  expect(onChange).toHaveBeenCalledWith(changeEvent);
  expect(onChangeText).toHaveBeenCalledWith('12345678');
  expect(view.getByText('學號格式有誤').props.accessibilityLiveRegion).toBe('polite');
});
