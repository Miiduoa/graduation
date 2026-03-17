"use client";

import { forwardRef, InputHTMLAttributes, ReactNode, useState } from "react";

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  inputSize?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leftIcon,
      rightIcon,
      inputSize = "md",
      fullWidth = true,
      disabled,
      style,
      className,
      type = "text",
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);
    const [showPassword, setShowPassword] = useState(false);

    const isPassword = type === "password";
    const inputType = isPassword && showPassword ? "text" : type;

    const sizeStyles = {
      sm: { padding: "10px 12px", fontSize: "13px", height: "36px" },
      md: { padding: "14px 16px", fontSize: "15px", height: "44px" },
      lg: { padding: "16px 18px", fontSize: "16px", height: "52px" },
    };

    const sizes = sizeStyles[inputSize];

    return (
      <div style={{ width: fullWidth ? "100%" : "auto" }}>
        {label && (
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontSize: "14px",
              fontWeight: 500,
              color: error ? "#EF4444" : "var(--text)",
            }}
          >
            {label}
          </label>
        )}
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
          }}
        >
          {leftIcon && (
            <div
              style={{
                position: "absolute",
                left: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                pointerEvents: "none",
              }}
            >
              {leftIcon}
            </div>
          )}
          <input
            ref={ref}
            type={inputType}
            disabled={disabled}
            className={className}
            onFocus={(e) => {
              setIsFocused(true);
              props.onFocus?.(e);
            }}
            onBlur={(e) => {
              setIsFocused(false);
              props.onBlur?.(e);
            }}
            style={{
              width: "100%",
              borderRadius: "12px",
              border: `1px solid ${error ? "#EF4444" : isFocused ? "var(--brand)" : "var(--border)"}`,
              background: disabled ? "var(--panel2)" : "var(--panel)",
              color: "var(--text)",
              transition: "all 0.2s ease",
              outline: "none",
              paddingLeft: leftIcon ? "44px" : sizes.padding,
              paddingRight: rightIcon || isPassword ? "44px" : sizes.padding,
              paddingTop: sizes.padding,
              paddingBottom: sizes.padding,
              fontSize: sizes.fontSize,
              height: sizes.height,
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? "not-allowed" : "text",
              boxShadow: isFocused ? "0 0 0 3px var(--accent-soft)" : "none",
              ...style,
            }}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: "absolute",
                right: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--muted)",
                padding: "4px",
              }}
              tabIndex={-1}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          )}
          {rightIcon && !isPassword && (
            <div
              style={{
                position: "absolute",
                right: "14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
              }}
            >
              {rightIcon}
            </div>
          )}
        </div>
        {(error || hint) && (
          <p
            style={{
              marginTop: "6px",
              fontSize: "13px",
              color: error ? "#EF4444" : "var(--muted)",
            }}
          >
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

interface TextareaProps extends Omit<InputHTMLAttributes<HTMLTextAreaElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
  rows?: number;
  fullWidth?: boolean;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, rows = 4, fullWidth = true, disabled, style, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);

    return (
      <div style={{ width: fullWidth ? "100%" : "auto" }}>
        {label && (
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontSize: "14px",
              fontWeight: 500,
              color: error ? "#EF4444" : "var(--text)",
            }}
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          rows={rows}
          disabled={disabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            width: "100%",
            padding: "14px 16px",
            borderRadius: "12px",
            border: `1px solid ${error ? "#EF4444" : isFocused ? "var(--brand)" : "var(--border)"}`,
            background: disabled ? "var(--panel2)" : "var(--panel)",
            color: "var(--text)",
            fontSize: "15px",
            lineHeight: 1.5,
            resize: "vertical",
            transition: "all 0.2s ease",
            outline: "none",
            opacity: disabled ? 0.6 : 1,
            cursor: disabled ? "not-allowed" : "text",
            boxShadow: isFocused ? "0 0 0 3px var(--accent-soft)" : "none",
            fontFamily: "inherit",
            ...style,
          }}
          {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
        {(error || hint) && (
          <p
            style={{
              marginTop: "6px",
              fontSize: "13px",
              color: error ? "#EF4444" : "var(--muted)",
            }}
          >
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);

Textarea.displayName = "Textarea";

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<InputHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
  inputSize?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      label,
      error,
      hint,
      options,
      placeholder,
      inputSize = "md",
      fullWidth = true,
      disabled,
      style,
      ...props
    },
    ref
  ) => {
    const [isFocused, setIsFocused] = useState(false);

    const sizeStyles = {
      sm: { padding: "10px 12px", fontSize: "13px", height: "36px" },
      md: { padding: "14px 16px", fontSize: "15px", height: "44px" },
      lg: { padding: "16px 18px", fontSize: "16px", height: "52px" },
    };

    const sizes = sizeStyles[inputSize];

    return (
      <div style={{ width: fullWidth ? "100%" : "auto" }}>
        {label && (
          <label
            style={{
              display: "block",
              marginBottom: "8px",
              fontSize: "14px",
              fontWeight: 500,
              color: error ? "#EF4444" : "var(--text)",
            }}
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          disabled={disabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          style={{
            width: "100%",
            borderRadius: "12px",
            border: `1px solid ${error ? "#EF4444" : isFocused ? "var(--brand)" : "var(--border)"}`,
            background: disabled ? "var(--panel2)" : "var(--panel)",
            color: "var(--text)",
            transition: "all 0.2s ease",
            outline: "none",
            appearance: "none",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2'%3E%3Cpolyline points='6,9 12,15 18,9'%3E%3C/polyline%3E%3C/svg%3E\")",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 12px center",
            paddingRight: "40px",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.6 : 1,
            boxShadow: isFocused ? "0 0 0 3px var(--accent-soft)" : "none",
            ...sizes,
            padding: `${sizes.padding} 40px ${sizes.padding} 16px`,
            ...style,
          }}
          {...(props as React.SelectHTMLAttributes<HTMLSelectElement>)}
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
        {(error || hint) && (
          <p
            style={{
              marginTop: "6px",
              fontSize: "13px",
              color: error ? "#EF4444" : "var(--muted)",
            }}
          >
            {error || hint}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";

export { Input, Textarea, Select };
export type { InputProps, TextareaProps, SelectProps, SelectOption };
