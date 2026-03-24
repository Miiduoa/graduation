/* eslint-disable */
import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import type { TextInputProps } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ValidationRule<T> = {
  validate: (value: T, allValues: Record<string, unknown>) => boolean;
  message: string;
};

export type FieldConfig<T> = {
  initialValue: T;
  rules?: ValidationRule<T>[];
  transform?: (value: T) => T;
};

export type FormConfig<T extends Record<string, unknown>> = {
  [K in keyof T]: FieldConfig<T[K]>;
};

export type UseFormOptions = {
  persistKey?: string;
  persistDebounceMs?: number;
  validateOnChange?: boolean;
};

export type FormState<T extends Record<string, unknown>> = {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  touched: Partial<Record<keyof T, boolean>>;
  isValid: boolean;
  isDirty: boolean;
  isSubmitting: boolean;
};

export type FieldProps<V> = {
  value: V;
  onChangeText: (value: string | number | boolean) => void;
  onBlur: () => void;
  error: string | undefined;
};

export type FormActions<T extends Record<string, unknown>> = {
  setValue: <K extends keyof T>(field: K, value: T[K]) => void;
  setValues: (values: Partial<T>) => void;
  setError: <K extends keyof T>(field: K, error: string | null) => void;
  setTouched: <K extends keyof T>(field: K, touched?: boolean) => void;
  validateField: <K extends keyof T>(field: K) => boolean;
  validateForm: () => boolean;
  reset: (values?: Partial<T>) => void;
  clearDraft: () => Promise<void>;
  handleSubmit: (onSubmit: (values: T) => Promise<void> | void) => () => Promise<void>;
  getFieldProps: <K extends keyof T>(field: K) => FieldProps<T[K]>;
};

/**
 * 表單管理 hook
 */
export function useForm<T extends Record<string, unknown>>(
  config: FormConfig<T>,
  options: UseFormOptions = {}
): FormState<T> & FormActions<T> {
  const { persistKey, persistDebounceMs = 1000, validateOnChange = false } = options;
  // 使用 JSON 序列化進行深度比較，確保 config 變化時能正確重新計算初始值
  const configSnapshot = JSON.stringify(
    Object.fromEntries(
      Object.entries(config).map(([k, v]) => [k, v.initialValue])
    )
  );
  
  const initialValues = useMemo(() => {
    const values: Partial<T> = {};
    for (const key of Object.keys(config)) {
      values[key as keyof T] = config[key as keyof T].initialValue;
    }
    return values as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configSnapshot]);

  const [values, setValuesState] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouchedState] = useState<Partial<Record<keyof T, boolean>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(!persistKey);

  const configRef = useRef(config);
  configRef.current = config;
  
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!persistKey) return;
    
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(`@form_draft_${persistKey}`);
        if (saved) {
          const parsed = JSON.parse(saved);
          setValuesState((prev) => ({ ...prev, ...parsed }));
        }
      } catch (e) {
        console.warn("[useForm] Failed to load draft:", e);
      } finally {
        setDraftLoaded(true);
      }
    })();
  }, [persistKey]);

  useEffect(() => {
    if (!persistKey || !draftLoaded) return;
    
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }
    
    persistTimerRef.current = setTimeout(async () => {
      try {
        await AsyncStorage.setItem(`@form_draft_${persistKey}`, JSON.stringify(values));
      } catch (e) {
        console.warn("[useForm] Failed to save draft:", e);
      }
    }, persistDebounceMs);
    
    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [persistKey, values, draftLoaded, persistDebounceMs]);

  const clearDraft = useCallback(async () => {
    if (!persistKey) return;
    try {
      await AsyncStorage.removeItem(`@form_draft_${persistKey}`);
    } catch (e) {
      console.warn("[useForm] Failed to clear draft:", e);
    }
  }, [persistKey]);

  const validateField = useCallback(<K extends keyof T>(field: K): boolean => {
    const fieldConfig = configRef.current[field];
    const value = values[field];
    const rules = fieldConfig?.rules ?? [];

    for (const rule of rules) {
      if (!rule.validate(value as T[K], values as Record<string, unknown>)) {
        setErrors((prev) => ({ ...prev, [field]: rule.message }));
        return false;
      }
    }

    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    return true;
  }, [values]);

  const validateForm = useCallback((): boolean => {
    let isValid = true;
    const newErrors: Partial<Record<keyof T, string>> = {};

    for (const key of Object.keys(configRef.current)) {
      const field = key as keyof T;
      const fieldConfig = configRef.current[field];
      const value = values[field];
      const rules = fieldConfig?.rules ?? [];

      for (const rule of rules) {
        if (!rule.validate(value as T[keyof T], values as Record<string, unknown>)) {
          newErrors[field] = rule.message;
          isValid = false;
          break;
        }
      }
    }

    setErrors(newErrors);
    return isValid;
  }, [values]);

  const setValue = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    const fieldConfig = configRef.current[field];
    const transformedValue = fieldConfig?.transform ? fieldConfig.transform(value) : value;
    setValuesState((prev) => ({ ...prev, [field]: transformedValue }));
  }, []);

  const setValues = useCallback((newValues: Partial<T>) => {
    setValuesState((prev) => ({ ...prev, ...newValues }));
  }, []);

  const setError = useCallback(<K extends keyof T>(field: K, error: string | null) => {
    if (error) {
      setErrors((prev) => ({ ...prev, [field]: error }));
    } else {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, []);

  const setTouched = useCallback(<K extends keyof T>(field: K, isTouched = true) => {
    setTouchedState((prev) => ({ ...prev, [field]: isTouched }));
  }, []);

  const reset = useCallback(async (newValues?: Partial<T>) => {
    setValuesState(newValues ? { ...initialValues, ...newValues } : initialValues);
    setErrors({});
    setTouchedState({});
    setIsSubmitting(false);
    await clearDraft();
  }, [initialValues, clearDraft]);

  const handleSubmit = useCallback(
    (onSubmit: (values: T) => Promise<void> | void) => {
      return async () => {
        const allTouched: Partial<Record<keyof T, boolean>> = {};
        for (const key of Object.keys(configRef.current)) {
          allTouched[key as keyof T] = true;
        }
        setTouchedState(allTouched);

        if (!validateForm()) {
          return;
        }

        setIsSubmitting(true);
        try {
          await onSubmit(values);
        } finally {
          setIsSubmitting(false);
        }
      };
    },
    [validateForm, values]
  );

  const getFieldProps = useCallback(
    <K extends keyof T>(field: K) => ({
      value: values[field] as T[K],
      onChangeText: (value: string | number | boolean) => {
        // 根據欄位的初始值類型自動轉換輸入值
        const fieldConfig = configRef.current[field];
        const initialValue = fieldConfig?.initialValue;
        
        let typedValue: T[K];
        if (typeof initialValue === "number") {
          // 數字欄位：嘗試轉換為數字
          const num = parseFloat(String(value));
          typedValue = (isNaN(num) ? 0 : num) as T[K];
        } else if (typeof initialValue === "boolean") {
          // 布林欄位：轉換為布林值
          typedValue = Boolean(value) as T[K];
        } else {
          // 字串或其他類型：保持原樣
          typedValue = value as T[K];
        }
        
        setValue(field, typedValue);
        if (validateOnChange || touched[field]) {
          setTimeout(() => validateField(field), 0);
        }
      },
      onBlur: () => {
        setTouched(field, true);
        validateField(field);
      },
      error: touched[field] ? errors[field] : undefined,
    }),
    [errors, setTouched, setValue, touched, validateField, values, validateOnChange]
  );

  // 改用更高效的 isDirty 判斷方式，避免大型表單的效能問題
  const isDirty = useMemo(() => {
    const keys = Object.keys(values);
    for (const key of keys) {
      const currentValue = values[key as keyof T];
      const initialValue = initialValues[key as keyof T];
      
      // 對於物件和陣列，使用 JSON 比較（僅在需要時）
      if (typeof currentValue === "object" && currentValue !== null) {
        if (JSON.stringify(currentValue) !== JSON.stringify(initialValue)) {
          return true;
        }
      } else if (currentValue !== initialValue) {
        return true;
      }
    }
    return false;
  }, [values, initialValues]);

  const isValid = Object.keys(errors).length === 0;

  return {
    values,
    errors,
    touched,
    isValid,
    isDirty,
    isSubmitting,
    setValue,
    setValues,
    setError,
    setTouched,
    validateField,
    validateForm,
    reset,
    clearDraft,
    handleSubmit,
    getFieldProps,
  };
}

// ===== 預設驗證規則 =====

export const validators = {
  required: (message = "此欄位為必填"): ValidationRule<unknown> => ({
    validate: (value) => {
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      return value !== null && value !== undefined;
    },
    message,
  }),

  minLength: (min: number, message?: string): ValidationRule<string> => ({
    validate: (value) => value.length >= min,
    message: message ?? `最少需要 ${min} 個字元`,
  }),

  maxLength: (max: number, message?: string): ValidationRule<string> => ({
    validate: (value) => value.length <= max,
    message: message ?? `最多只能 ${max} 個字元`,
  }),

  email: (message = "請輸入有效的電子郵件"): ValidationRule<string> => ({
    // 使用更完整的 email 驗證正則表達式
    validate: (value) => {
      if (!value || value.trim().length === 0) return true; // 空值由 required 規則處理
      // RFC 5322 簡化版本
      const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
      return emailRegex.test(value.trim());
    },
    message,
  }),

  phone: (message = "請輸入有效的電話號碼"): ValidationRule<string> => ({
    validate: (value) => /^[\d\-+() ]{8,}$/.test(value),
    message,
  }),

  pattern: (regex: RegExp, message: string): ValidationRule<string> => ({
    validate: (value) => regex.test(value),
    message,
  }),

  min: (minValue: number, message?: string): ValidationRule<number> => ({
    validate: (value) => value >= minValue,
    message: message ?? `數值不能小於 ${minValue}`,
  }),

  max: (maxValue: number, message?: string): ValidationRule<number> => ({
    validate: (value) => value <= maxValue,
    message: message ?? `數值不能大於 ${maxValue}`,
  }),

  match: <T>(fieldName: string, message?: string): ValidationRule<T> => ({
    validate: (value, allValues) => value === allValues[fieldName],
    message: message ?? `必須與 ${fieldName} 相符`,
  }),

  custom: <T>(
    validateFn: (value: T, allValues: Record<string, unknown>) => boolean,
    message: string
  ): ValidationRule<T> => ({
    validate: validateFn,
    message,
  }),

  password: (options?: { minLength?: number; requireUppercase?: boolean; requireLowercase?: boolean; requireNumber?: boolean; requireSpecial?: boolean }): ValidationRule<string> => {
    const { 
      minLength = 8, 
      requireUppercase = true, 
      requireLowercase = true, 
      requireNumber = true, 
      requireSpecial = false 
    } = options ?? {};
    
    return {
      validate: (value) => {
        if (value.length < minLength) return false;
        if (requireUppercase && !/[A-Z]/.test(value)) return false;
        if (requireLowercase && !/[a-z]/.test(value)) return false;
        if (requireNumber && !/\d/.test(value)) return false;
        if (requireSpecial && !/[!@#$%^&*(),.?":{}|<>]/.test(value)) return false;
        return true;
      },
      message: `密碼需至少 ${minLength} 字元${requireUppercase ? "、含大寫字母" : ""}${requireLowercase ? "、含小寫字母" : ""}${requireNumber ? "、含數字" : ""}${requireSpecial ? "、含特殊符號" : ""}`,
    };
  },
};

export type PasswordStrength = "weak" | "medium" | "strong" | "very_strong";

export function getPasswordStrength(password: string): { strength: PasswordStrength; score: number; suggestions: string[] } {
  let score = 0;
  const suggestions: string[] = [];
  
  if (password.length >= 8) score += 1;
  else suggestions.push("密碼需至少 8 個字元");
  
  if (password.length >= 12) score += 1;
  
  if (/[a-z]/.test(password)) score += 1;
  else suggestions.push("加入小寫字母");
  
  if (/[A-Z]/.test(password)) score += 1;
  else suggestions.push("加入大寫字母");
  
  if (/\d/.test(password)) score += 1;
  else suggestions.push("加入數字");
  
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
  else suggestions.push("加入特殊符號可提高安全性");
  
  if (/(.)\1{2,}/.test(password)) {
    score -= 1;
    suggestions.push("避免連續重複字元");
  }
  
  let strength: PasswordStrength;
  if (score <= 2) strength = "weak";
  else if (score <= 4) strength = "medium";
  else if (score <= 5) strength = "strong";
  else strength = "very_strong";
  
  return { strength, score: Math.max(0, Math.min(100, score * 16)), suggestions };
}
