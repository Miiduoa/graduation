'use client';

import {
  forwardRef,
  useId,
  useState,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type ReactNode,
} from 'react';
import styles from './Field.module.css';

interface FieldProps {
  label?: string;
  error?: string;
  hint?: string;
  fullWidth?: boolean;
}

type FieldSize = 'sm' | 'md' | 'lg';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>, FieldProps {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  inputSize?: FieldSize;
}

function Field({
  id,
  label,
  error,
  hint,
  fullWidth = true,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={styles.field} style={{ width: fullWidth ? '100%' : undefined }}>
      {label && (
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
      )}
      {children}
      {(error || hint) && (
        <p
          id={`${id}-description`}
          className={error ? styles.error : styles.hint}
          role={error ? 'alert' : undefined}
        >
          {error || hint}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string, provided?: string) {
  return (
    [provided, error || hint ? `${id}-description` : undefined].filter(Boolean).join(' ') ||
    undefined
  );
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      inputSize = 'md',
      fullWidth = true,
      id,
      disabled,
      className = '',
      type = 'text',
      'aria-describedby': description,
      'aria-invalid': invalid,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';
    return (
      <Field id={fieldId} label={label} error={error} hint={hint} fullWidth={fullWidth}>
        <div className={styles.control}>
          {leftIcon && (
            <span className={styles.leading} aria-hidden="true">
              {leftIcon}
            </span>
          )}
          <input
            {...props}
            ref={ref}
            id={fieldId}
            disabled={disabled}
            type={isPassword && showPassword ? 'text' : type}
            aria-invalid={error ? true : invalid}
            aria-describedby={describedBy(fieldId, error, hint, description)}
            className={`${styles.input} ${styles[inputSize]} ${leftIcon ? styles.withLeading : ''} ${rightIcon || isPassword ? styles.withTrailing : ''} ${className}`}
          />
          {isPassword ? (
            <button
              type="button"
              className={styles.reveal}
              disabled={disabled}
              aria-label={showPassword ? '隱藏密碼' : '顯示密碼'}
              aria-controls={fieldId}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((visible) => !visible)}
            >
              {showPassword ? '隱藏' : '顯示'}
            </button>
          ) : (
            rightIcon && (
              <span className={styles.trailing} aria-hidden="true">
                {rightIcon}
              </span>
            )
          )}
        </div>
      </Field>
    );
  },
);
Input.displayName = 'Input';

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement>, FieldProps {}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      label,
      error,
      hint,
      rows = 4,
      fullWidth = true,
      id,
      className = '',
      'aria-describedby': description,
      'aria-invalid': invalid,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <Field id={fieldId} label={label} error={error} hint={hint} fullWidth={fullWidth}>
        <textarea
          {...props}
          ref={ref}
          id={fieldId}
          rows={rows}
          aria-invalid={error ? true : invalid}
          aria-describedby={describedBy(fieldId, error, hint, description)}
          className={`${styles.input} ${styles.textarea} ${className}`}
        />
      </Field>
    );
  },
);
Textarea.displayName = 'Textarea';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}
interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>, FieldProps {
  options: SelectOption[];
  placeholder?: string;
  inputSize?: FieldSize;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      hint,
      options,
      placeholder,
      inputSize = 'md',
      fullWidth = true,
      id,
      className = '',
      'aria-describedby': description,
      'aria-invalid': invalid,
      ...props
    },
    ref,
  ) => {
    const generatedId = useId();
    const fieldId = id ?? generatedId;
    return (
      <Field id={fieldId} label={label} error={error} hint={hint} fullWidth={fullWidth}>
        <select
          {...props}
          ref={ref}
          id={fieldId}
          aria-invalid={error ? true : invalid}
          aria-describedby={describedBy(fieldId, error, hint, description)}
          className={`${styles.input} ${styles[inputSize]} ${className}`}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
    );
  },
);
Select.displayName = 'Select';

export { Input, Textarea, Select };
export type { InputProps, TextareaProps, SelectProps, SelectOption };
