import React, { useState, useRef, useCallback } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  TextInputProps,
  ScrollView,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "./theme";

// ===== TextInput =====

type InputProps = TextInputProps & {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: string;
  rightIcon?: string;
  onRightIconPress?: () => void;
  required?: boolean;
  disabled?: boolean;
};

export function Input({
  label,
  error,
  hint,
  leftIcon,
  rightIcon,
  onRightIconPress,
  required,
  disabled,
  style,
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const borderColor = error
    ? theme.colors.danger
    : isFocused
    ? theme.colors.accent
    : theme.colors.border;

  return (
    <View style={styles.inputContainer}>
      {label && (
        <View style={styles.labelRow}>
          <Text style={styles.label}>{label}</Text>
          {required && <Text style={styles.required}>*</Text>}
        </View>
      )}
      
      <View style={[styles.inputWrapper, { borderColor }, disabled && styles.inputDisabled]}>
        {leftIcon && (
          <Ionicons
            name={leftIcon as any}
            size={20}
            color={theme.colors.muted}
            style={styles.inputLeftIcon}
          />
        )}
        
        <TextInput
          style={[styles.input, leftIcon && styles.inputWithLeftIcon, style]}
          placeholderTextColor={theme.colors.muted}
          editable={!disabled}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          {...props}
        />
        
        {rightIcon && (
          <Pressable
            onPress={onRightIconPress}
            disabled={!onRightIconPress}
            style={({ pressed }) => [
              styles.inputRightIcon,
              pressed && onRightIconPress && styles.inputRightIconPressed,
            ]}
          >
            <Ionicons name={rightIcon as any} size={20} color={theme.colors.muted} />
          </Pressable>
        )}
      </View>
      
      {(error || hint) && (
        <Text style={[styles.hint, error && styles.errorText]}>
          {error || hint}
        </Text>
      )}
    </View>
  );
}

// ===== Password Input =====

type PasswordInputProps = Omit<InputProps, "secureTextEntry" | "rightIcon" | "onRightIconPress">;

export function PasswordInput(props: PasswordInputProps) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <Input
      {...props}
      secureTextEntry={!showPassword}
      rightIcon={showPassword ? "eye-off" : "eye"}
      onRightIconPress={() => setShowPassword(!showPassword)}
    />
  );
}

// ===== TextArea =====

type TextAreaProps = InputProps & {
  rows?: number;
  maxLength?: number;
  showCount?: boolean;
};

export function TextArea({
  rows = 4,
  maxLength,
  showCount,
  value,
  ...props
}: TextAreaProps) {
  const charCount = value?.length ?? 0;

  return (
    <View style={styles.inputContainer}>
      <Input
        {...props}
        value={value}
        multiline
        numberOfLines={rows}
        textAlignVertical="top"
        maxLength={maxLength}
        style={[{ height: rows * 24 + 24 }, props.style]}
      />
      {showCount && maxLength && (
        <Text style={styles.charCount}>
          {charCount}/{maxLength}
        </Text>
      )}
    </View>
  );
}

// ===== Checkbox =====

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  error?: string;
};

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  error,
}: CheckboxProps) {
  return (
    <View style={styles.checkboxContainer}>
      <Pressable
        onPress={() => !disabled && onChange(!checked)}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked, disabled }}
        accessibilityLabel={label}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        style={({ pressed }) => [
          styles.checkboxRow,
          pressed && !disabled && styles.checkboxRowPressed,
        ]}
      >
        <View style={styles.checkboxTouchArea}>
          <View
            style={[
              styles.checkbox,
              checked && styles.checkboxChecked,
              error && styles.checkboxError,
              disabled && styles.checkboxDisabled,
            ]}
          >
            {checked && <Ionicons name="checkmark" size={16} color="#fff" />}
          </View>
        </View>
        
        {(label || description) && (
          <View style={styles.checkboxContent}>
            {label && (
              <Text style={[styles.checkboxLabel, disabled && styles.checkboxLabelDisabled]}>
                {label}
              </Text>
            )}
            {description && (
              <Text style={styles.checkboxDescription}>{description}</Text>
            )}
          </View>
        )}
      </Pressable>
      
      {error && <Text style={styles.errorTextSmall}>{error}</Text>}
    </View>
  );
}

// ===== Radio =====

type RadioOption<T> = {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean;
};

type RadioGroupProps<T> = {
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  label?: string;
  error?: string;
  horizontal?: boolean;
};

export function RadioGroup<T>({
  value,
  onChange,
  options,
  label,
  error,
  horizontal,
}: RadioGroupProps<T>) {
  return (
    <View style={styles.radioGroupContainer}>
      {label && <Text style={styles.radioGroupLabel}>{label}</Text>}
      
      <View style={[styles.radioGroup, horizontal && styles.radioGroupHorizontal]}>
        {options.map((option, index) => {
          const isSelected = value === option.value;
          const isDisabled = option.disabled;

          return (
            <Pressable
              key={index}
              onPress={() => !isDisabled && onChange(option.value)}
              disabled={isDisabled}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected, disabled: isDisabled }}
              accessibilityLabel={option.label}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={({ pressed }) => [
                styles.radioRow,
                pressed && !isDisabled && styles.radioRowPressed,
                horizontal && styles.radioRowHorizontal,
              ]}
            >
              <View style={styles.radioTouchArea}>
                <View
                  style={[
                    styles.radio,
                    isSelected && styles.radioSelected,
                    error && styles.radioError,
                    isDisabled && styles.radioDisabled,
                  ]}
                >
                  {isSelected && <View style={styles.radioInner} />}
                </View>
              </View>
              
              <View style={styles.radioContent}>
                <Text style={[styles.radioLabel, isDisabled && styles.radioLabelDisabled]}>
                  {option.label}
                </Text>
                {option.description && (
                  <Text style={styles.radioDescription}>{option.description}</Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
      
      {error && <Text style={styles.errorTextSmall}>{error}</Text>}
    </View>
  );
}

// ===== Select =====

type SelectOption<T> = {
  value: T;
  label: string;
};

type SelectProps<T> = {
  value: T | null;
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  label?: string;
  placeholder?: string;
  error?: string;
  disabled?: boolean;
  onPress?: () => void;
};

export function Select<T>({
  value,
  onChange,
  options,
  label,
  placeholder = "請選擇",
  error,
  disabled,
  onPress,
}: SelectProps<T>) {
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <View style={styles.inputContainer}>
      {label && <Text style={styles.label}>{label}</Text>}
      
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          styles.select,
          error && styles.selectError,
          disabled && styles.selectDisabled,
          pressed && styles.selectPressed,
        ]}
      >
        <Text
          style={[
            styles.selectText,
            !selectedOption && styles.selectPlaceholder,
          ]}
        >
          {selectedOption?.label || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={20} color={theme.colors.muted} />
      </Pressable>
      
      {error && <Text style={styles.errorTextSmall}>{error}</Text>}
    </View>
  );
}

// ===== Slider =====

type SliderProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  disabled?: boolean;
};

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = true,
  formatValue = (v) => String(v),
  disabled,
}: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  const handlePress = useCallback(
    (event: { nativeEvent: { locationX: number } }) => {
      if (disabled) return;
      // This is a simplified implementation
      // For a full slider, consider using @react-native-community/slider
    },
    [disabled]
  );

  return (
    <View style={styles.sliderContainer}>
      {(label || showValue) && (
        <View style={styles.sliderHeader}>
          {label && <Text style={styles.sliderLabel}>{label}</Text>}
          {showValue && <Text style={styles.sliderValue}>{formatValue(value)}</Text>}
        </View>
      )}
      
      <View style={[styles.sliderTrack, disabled && styles.sliderDisabled]}>
        <View style={[styles.sliderFill, { width: `${percentage}%` }]} />
        <View style={[styles.sliderThumb, { left: `${percentage}%` }]} />
      </View>
      
      <View style={styles.sliderLabels}>
        <Text style={styles.sliderMinMax}>{formatValue(min)}</Text>
        <Text style={styles.sliderMinMax}>{formatValue(max)}</Text>
      </View>
    </View>
  );
}

// ===== Form Section =====

type FormSectionProps = {
  title?: string;
  description?: string;
  children: React.ReactNode;
};

export function FormSection({ title, description, children }: FormSectionProps) {
  return (
    <View style={styles.formSection}>
      {title && <Text style={styles.formSectionTitle}>{title}</Text>}
      {description && <Text style={styles.formSectionDescription}>{description}</Text>}
      <View style={styles.formSectionContent}>{children}</View>
    </View>
  );
}

// ===== Form Actions =====

type FormActionsProps = {
  children: React.ReactNode;
  align?: "left" | "center" | "right" | "stretch";
};

export function FormActions({ children, align = "right" }: FormActionsProps) {
  const justifyContent = {
    left: "flex-start",
    center: "center",
    right: "flex-end",
    stretch: "flex-start",
  }[align] as "flex-start" | "center" | "flex-end";

  return (
    <View style={[styles.formActions, { justifyContent, alignSelf: align === "stretch" ? "stretch" : "auto" }]}>
      {children}
    </View>
  );
}

// ===== Styles =====

const styles = StyleSheet.create({
  // Input
  inputContainer: {
    marginBottom: 16,
  },
  labelRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
  },
  required: {
    color: theme.colors.danger,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface2,
    overflow: "hidden",
  },
  inputDisabled: {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    opacity: 0.6,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 15,
    color: theme.colors.text,
  },
  inputWithLeftIcon: {
    paddingLeft: 8,
  },
  inputLeftIcon: {
    marginLeft: 14,
  },
  inputRightIcon: {
    padding: 12,
  },
  inputRightIconPressed: {
    backgroundColor: "rgba(255, 255, 255, 0.08)",
  },
  hint: {
    fontSize: 12,
    color: theme.colors.muted,
    marginTop: 6,
  },
  errorText: {
    color: theme.colors.danger,
  },
  errorTextSmall: {
    fontSize: 12,
    color: theme.colors.danger,
    marginTop: 6,
  },
  charCount: {
    position: "absolute",
    bottom: 8,
    right: 12,
    fontSize: 11,
    color: theme.colors.muted,
  },
  // Checkbox
  checkboxContainer: {
    marginBottom: 12,
  },
  checkboxRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 44,
  },
  checkboxRowPressed: {
    opacity: 0.8,
  },
  checkboxTouchArea: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  checkboxError: {
    borderColor: theme.colors.danger,
  },
  checkboxDisabled: {
    opacity: 0.5,
  },
  checkboxContent: {
    flex: 1,
  },
  checkboxLabel: {
    fontSize: 15,
    color: theme.colors.text,
    fontWeight: "500",
  },
  checkboxLabelDisabled: {
    color: theme.colors.muted,
  },
  checkboxDescription: {
    fontSize: 13,
    color: theme.colors.muted,
    marginTop: 2,
    lineHeight: 18,
  },
  // Radio
  radioGroupContainer: {
    marginBottom: 16,
  },
  radioGroupLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
    marginBottom: 12,
  },
  radioGroup: {
    gap: 4,
  },
  radioGroupHorizontal: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
  },
  radioRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    minHeight: 44,
  },
  radioRowPressed: {
    opacity: 0.8,
  },
  radioRowHorizontal: {
    minHeight: 44,
  },
  radioTouchArea: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 4,
  },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  radioSelected: {
    borderColor: theme.colors.accent,
  },
  radioError: {
    borderColor: theme.colors.danger,
  },
  radioDisabled: {
    opacity: 0.5,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.accent,
  },
  radioContent: {
    flex: 1,
  },
  radioLabel: {
    fontSize: 15,
    color: theme.colors.text,
    fontWeight: "500",
  },
  radioLabelDisabled: {
    color: theme.colors.muted,
  },
  radioDescription: {
    fontSize: 13,
    color: theme.colors.muted,
    marginTop: 2,
    lineHeight: 18,
  },
  // Select
  select: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface2,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  selectError: {
    borderColor: theme.colors.danger,
  },
  selectDisabled: {
    opacity: 0.6,
  },
  selectPressed: {
    borderColor: theme.colors.accent,
  },
  selectText: {
    fontSize: 15,
    color: theme.colors.text,
    flex: 1,
  },
  selectPlaceholder: {
    color: theme.colors.muted,
  },
  // Slider
  sliderContainer: {
    marginBottom: 16,
  },
  sliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sliderLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.text,
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.accent,
  },
  sliderTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.border,
    position: "relative",
  },
  sliderDisabled: {
    opacity: 0.5,
  },
  sliderFill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    backgroundColor: theme.colors.accent,
    borderRadius: 3,
  },
  sliderThumb: {
    position: "absolute",
    top: -9,
    marginLeft: -12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.colors.accent,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  sliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
  },
  sliderMinMax: {
    fontSize: 12,
    color: theme.colors.muted,
  },
  // Form Section
  formSection: {
    marginBottom: 24,
  },
  formSectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: theme.colors.text,
    marginBottom: 4,
  },
  formSectionDescription: {
    fontSize: 13,
    color: theme.colors.muted,
    marginBottom: 16,
    lineHeight: 18,
  },
  formSectionContent: {
    gap: 4,
  },
  // Form Actions
  formActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
});
