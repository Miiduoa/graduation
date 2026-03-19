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

    const sizeMap = {
      sm: { minHeight: "36px", fontSize: "13px", padding: "0 12px" },
      md: { minHeight: "46px", fontSize: "15px", padding: "0 15px" },
      lg: { minHeight: "54px", fontSize: "16px", padding: "0 18px" },
    };
    const sz = sizeMap[inputSize];

    const insetShadow = "inset 3px 3px 7px rgba(174,174,192,0.25), inset -2px -2px 5px rgba(255,255,255,0.88)";
    const focusShadow = `${insetShadow}, 0 0 0 3px var(--focus-ring)`;

    return (
      <div style={{ width: fullWidth ? "100%" : "auto" }}>
        {label && (
          <label
            style={{
              display: "block",
              marginBottom: "7px",
              fontSize: "13px",
              fontWeight: 600,
              color: error ? "var(--danger)" : "var(--muted)",
              letterSpacing: "0.02em",
            }}
          >
            {label}
          </label>
        )}
        <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
          {leftIcon && (
            <div
              style={{
                position: "absolute",
                left: "13px",
                display: "flex",
                alignItems: "center",
                color: isFocused ? "var(--brand)" : "var(--muted)",
                pointerEvents: "none",
                transition: "color 0.2s ease",
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
              borderRadius: "var(--radius-sm)",
              border: `1px solid ${error ? "var(--danger)" : isFocused ? "var(--brand)" : "var(--border)"}`,
              background: disabled ? "var(--panel)" : "var(--surface)",
              color: "var(--text)",
              transition: "border-color 0.2s ease, box-shadow 0.2s ease",
              outline: "none",
              paddingLeft: leftIcon ? "40px" : sz.padding.split(" ")[1],
              paddingRight: rightIcon || isPassword ? "40px" : sz.padding.split(" ")[1],
              paddingTop: "0",
              paddingBottom: "0",
              fontSize: sz.fontSize,
              minHeight: sz.minHeight,
              opacity: disabled ? 0.5 : 1,
              cursor: disabled ? "not-allowed" : "text",
              boxShadow: isFocused ? focusShadow : insetShadow,
              fontFamily: "inherit",
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
                right: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "var(--muted)",
                padding: "4px",
                fontSize: "16px",
              }}
              tabIndex={-1}
              aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
            >
              {showPassword ? "🙈" : "👁️"}
            </button>
          )}
          {rightIcon && !isPassword && (
            <div
              style={{
                position: "absolute",
                right: "12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
                pointerEvents: "none",
              }}
            >
              {rightIcon}
            </div>
          )}
        </div>
        {(error || hint) && (
          <p
            style={{
              marginTop: "5px",
              fontSize: "12px",
              color: error ? "var(--danger)" : "var(--muted)",
              lineHeight: 1.5,
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
    const insetShadow = "inset 3px 3px 7px rgba(174,174,192,0.25), inset -2px -2px 5px rgba(255,255,255,0.88)";
    const focusShadow = `${insetShadow}, 0 0 0 3px var(--focus-ring)`;

    return (
      <div style={{ width: fullWidth ? "100%" : "auto" }}>
        {label && (
          <label
            style={{
              display: "block",
              marginBottom: "7px",
              fontSize: "13px",
              fontWeight: 600,
              color: error ? "var(--danger)" : "var(--muted)",
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
            padding: "14px 15px",
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${error ? "var(--danger)" : isFocused ? "var(--brand)" : "var(--border)"}`,
            background: disabled ? "var(--panel)" : "var(--surface)",
            color: "var(--text)",
            fontSize: "15px",
            lineHeight: 1.6,
            resize: "vertical",
            transition: "border-color 0.2s ease, box-shadow 0.2s ease",
            outline: "none",
            opacity: disabled ? 0.5 : 1,
            cursor: disabled ? "not-allowed" : "text",
            boxShadow: isFocused ? focusShadow : insetShadow,
            fontFamily: "inherit",
            ...style,
          }}
          {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
        {(error || hint) && (
          <p
            style={{
              marginTop: "5px",
              fontSize: "12px",
              color: error ? "var(--danger)" : "var(--muted)",
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
    const insetShadow = "inset 3px 3px 7px rgba(174,174,192,0.25), inset -2px -2px 5px rgba(255,255,255,0.88)";
    const focusShadow = `${insetShadow}, 0 0 0 3px var(--focus-ring)`;

    const sizeMap = {
      sm: { minHeight: "36px", fontSize: "13px" },
      md: { minHeight: "46px", fontSize: "15px" },
      lg: { minHeight: "54px", fontSize: "16px" },
    };
    const sz = sizeMap[inputSize];

    return (
      <div style={{ width: fullWidth ? "100%" : "auto" }}>
        {label && (
          <label
            style={{
              display: "block",
              marginBottom: "7px",
              fontSize: "13px",
              fontWeight: 600,
              color: error ? "var(--danger)" : "var(--muted)",
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
            padding: "0 40px 0 15px",
            borderRadius: "var(--radius-sm)",
            border: `1px solid ${error ? "var(--danger)" : isFocused ? "var(--brand)" : "var(--border)"}`,
            background: disabled ? "var(--panel)" : "var(--surface)",
            color: "var(--text)",
            transition: "border-color 0.2s ease, box-shadow 0.2s ease",
            outline: "none",
            appearance: "none",
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%238E8E93' stroke-width='2'%3E%3Cpolyline points='6,9 12,15 18,9'%3E%3C/polyline%3E%3C/svg%3E\")",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 13px center",
            cursor: disabled ? "not-allowed" : "pointer",
            opacity: disabled ? 0.5 : 1,
            boxShadow: isFocused ? focusShadow : insetShadow,
            fontFamily: "inherit",
            ...sz,
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
              marginTop: "5px",
              fontSize: "12px",
              color: error ? "var(--danger)" : "var(--muted)",
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
