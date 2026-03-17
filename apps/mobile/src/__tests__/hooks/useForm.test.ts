import { renderHook, act } from '@testing-library/react-native';
import { useForm, validators } from '../../hooks/useForm';

describe('useForm', () => {
  const basicConfig = {
    email: { initialValue: '' },
    password: { initialValue: '' },
  };

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useForm(basicConfig));

    expect(result.current.values).toEqual({ email: '', password: '' });
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
    expect(result.current.isValid).toBe(true);
    expect(result.current.isDirty).toBe(false);
    expect(result.current.isSubmitting).toBe(false);
  });

  it('should update value with setValue', () => {
    const { result } = renderHook(() => useForm(basicConfig));

    act(() => {
      result.current.setValue('email', 'test@example.com');
    });

    expect(result.current.values.email).toBe('test@example.com');
  });

  it('should update multiple values with setValues', () => {
    const { result } = renderHook(() => useForm(basicConfig));

    act(() => {
      result.current.setValues({
        email: 'test@example.com',
        password: 'secret123',
      });
    });

    expect(result.current.values).toEqual({
      email: 'test@example.com',
      password: 'secret123',
    });
  });

  it('should track dirty state', () => {
    const { result } = renderHook(() => useForm(basicConfig));

    expect(result.current.isDirty).toBe(false);

    act(() => {
      result.current.setValue('email', 'changed');
    });

    expect(result.current.isDirty).toBe(true);
  });

  it('should reset form to initial values', () => {
    const { result } = renderHook(() => useForm(basicConfig));

    act(() => {
      result.current.setValue('email', 'changed@example.com');
      result.current.setTouched('email', true);
      result.current.setError('email', 'Error message');
    });

    expect(result.current.values.email).toBe('changed@example.com');

    act(() => {
      result.current.reset();
    });

    expect(result.current.values).toEqual({ email: '', password: '' });
    expect(result.current.errors).toEqual({});
    expect(result.current.touched).toEqual({});
  });

  it('should reset with new values', () => {
    const { result } = renderHook(() => useForm(basicConfig));

    act(() => {
      result.current.reset({ email: 'new@example.com' });
    });

    expect(result.current.values.email).toBe('new@example.com');
    expect(result.current.values.password).toBe('');
  });

  describe('validation', () => {
    const configWithRules = {
      email: {
        initialValue: '',
        rules: [
          validators.required('Email is required'),
          validators.email('Invalid email format'),
        ],
      },
      password: {
        initialValue: '',
        rules: [
          validators.required('Password is required'),
          validators.minLength(6, 'Password must be at least 6 characters'),
        ],
      },
    };

    it('should validate single field', () => {
      const { result } = renderHook(() => useForm(configWithRules));

      act(() => {
        result.current.setValue('email', '');
        const isValid = result.current.validateField('email');
        expect(isValid).toBe(false);
      });

      expect(result.current.errors.email).toBe('Email is required');
    });

    it('should pass validation with valid value', () => {
      const { result } = renderHook(() => useForm(configWithRules));

      act(() => {
        result.current.setValue('email', 'test@example.com');
      });

      let isValid = false;
      act(() => {
        isValid = result.current.validateField('email');
      });

      expect(isValid).toBe(true);
      expect(result.current.errors.email).toBeUndefined();
    });

    it('should validate entire form', () => {
      const { result } = renderHook(() => useForm(configWithRules));

      act(() => {
        const isValid = result.current.validateForm();
        expect(isValid).toBe(false);
      });

      expect(result.current.errors.email).toBe('Email is required');
      expect(result.current.errors.password).toBe('Password is required');
    });

    it('should pass form validation with valid values', () => {
      const { result } = renderHook(() => useForm(configWithRules));

      act(() => {
        result.current.setValues({
          email: 'test@example.com',
          password: 'password123',
        });
      });

      act(() => {
        const isValid = result.current.validateForm();
        expect(isValid).toBe(true);
      });

      expect(result.current.errors).toEqual({});
    });

    it('should set custom error', () => {
      const { result } = renderHook(() => useForm(basicConfig));

      act(() => {
        result.current.setError('email', 'Custom error');
      });

      expect(result.current.errors.email).toBe('Custom error');

      act(() => {
        result.current.setError('email', null);
      });

      expect(result.current.errors.email).toBeUndefined();
    });
  });

  describe('touched state', () => {
    it('should track touched fields', () => {
      const { result } = renderHook(() => useForm(basicConfig));

      expect(result.current.touched.email).toBeUndefined();

      act(() => {
        result.current.setTouched('email', true);
      });

      expect(result.current.touched.email).toBe(true);
    });
  });

  describe('getFieldProps', () => {
    it('should return field props', () => {
      const { result } = renderHook(() => useForm(basicConfig));

      const emailProps = result.current.getFieldProps('email');

      expect(emailProps.value).toBe('');
      expect(typeof emailProps.onChangeText).toBe('function');
      expect(typeof emailProps.onBlur).toBe('function');
      expect(emailProps.error).toBeUndefined();
    });

    it('should update value on change', () => {
      const { result } = renderHook(() => useForm(basicConfig));

      act(() => {
        result.current.getFieldProps('email').onChangeText('new@example.com');
      });

      expect(result.current.values.email).toBe('new@example.com');
    });

    it('should set touched and validate on blur', () => {
      const configWithRules = {
        email: {
          initialValue: '',
          rules: [validators.required('Required')],
        },
      };

      const { result } = renderHook(() => useForm(configWithRules));

      act(() => {
        result.current.getFieldProps('email').onBlur();
      });

      expect(result.current.touched.email).toBe(true);
      expect(result.current.errors.email).toBe('Required');
    });

    it('should show error only when touched', () => {
      const configWithRules = {
        email: {
          initialValue: '',
          rules: [validators.required('Required')],
        },
      };

      const { result } = renderHook(() => useForm(configWithRules));

      expect(result.current.getFieldProps('email').error).toBeUndefined();

      act(() => {
        result.current.setTouched('email', true);
        result.current.validateField('email');
      });

      expect(result.current.getFieldProps('email').error).toBe('Required');
    });
  });

  describe('handleSubmit', () => {
    it('should call onSubmit with valid form', async () => {
      const onSubmit = jest.fn();
      const { result } = renderHook(() => useForm(basicConfig));

      act(() => {
        result.current.setValues({
          email: 'test@example.com',
          password: 'password',
        });
      });

      await act(async () => {
        await result.current.handleSubmit(onSubmit)();
      });

      expect(onSubmit).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password',
      });
    });

    it('should not call onSubmit with invalid form', async () => {
      const onSubmit = jest.fn();
      const configWithRules = {
        email: {
          initialValue: '',
          rules: [validators.required('Required')],
        },
      };

      const { result } = renderHook(() => useForm(configWithRules));

      await act(async () => {
        await result.current.handleSubmit(onSubmit)();
      });

      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('should set isSubmitting during submission', async () => {
      const onSubmit = jest.fn(
        () => new Promise((resolve) => setTimeout(resolve, 50))
      );
      const { result } = renderHook(() => useForm(basicConfig));

      expect(result.current.isSubmitting).toBe(false);

      const submitPromise = result.current.handleSubmit(onSubmit)();
      
      await act(async () => {
        await submitPromise;
      });

      expect(onSubmit).toHaveBeenCalled();
      expect(result.current.isSubmitting).toBe(false);
    });

    it('should mark all fields as touched on submit', async () => {
      const configWithRules = {
        email: {
          initialValue: '',
          rules: [validators.required('Required')],
        },
        password: {
          initialValue: '',
          rules: [validators.required('Required')],
        },
      };

      const { result } = renderHook(() => useForm(configWithRules));

      await act(async () => {
        await result.current.handleSubmit(jest.fn())();
      });

      expect(result.current.touched.email).toBe(true);
      expect(result.current.touched.password).toBe(true);
    });
  });

  describe('transform', () => {
    it('should apply transform function', () => {
      const config = {
        username: {
          initialValue: '',
          transform: (value: string) => value.toLowerCase().trim(),
        },
      };

      const { result } = renderHook(() => useForm(config));

      act(() => {
        result.current.setValue('username', '  TEST User  ');
      });

      expect(result.current.values.username).toBe('test user');
    });
  });
});

describe('validators', () => {
  describe('required', () => {
    const rule = validators.required('Field is required');

    it('should fail for empty string', () => {
      expect(rule.validate('', {})).toBe(false);
    });

    it('should fail for whitespace only', () => {
      expect(rule.validate('   ', {})).toBe(false);
    });

    it('should pass for non-empty string', () => {
      expect(rule.validate('value', {})).toBe(true);
    });

    it('should fail for empty array', () => {
      expect(rule.validate([], {})).toBe(false);
    });

    it('should pass for non-empty array', () => {
      expect(rule.validate([1, 2], {})).toBe(true);
    });

    it('should fail for null', () => {
      expect(rule.validate(null, {})).toBe(false);
    });

    it('should fail for undefined', () => {
      expect(rule.validate(undefined, {})).toBe(false);
    });
  });

  describe('minLength', () => {
    const rule = validators.minLength(3);

    it('should fail for shorter string', () => {
      expect(rule.validate('ab', {})).toBe(false);
    });

    it('should pass for exact length', () => {
      expect(rule.validate('abc', {})).toBe(true);
    });

    it('should pass for longer string', () => {
      expect(rule.validate('abcd', {})).toBe(true);
    });
  });

  describe('maxLength', () => {
    const rule = validators.maxLength(5);

    it('should pass for shorter string', () => {
      expect(rule.validate('abc', {})).toBe(true);
    });

    it('should pass for exact length', () => {
      expect(rule.validate('abcde', {})).toBe(true);
    });

    it('should fail for longer string', () => {
      expect(rule.validate('abcdef', {})).toBe(false);
    });
  });

  describe('email', () => {
    const rule = validators.email();

    it('should pass for valid email', () => {
      expect(rule.validate('test@example.com', {})).toBe(true);
    });

    it('should pass for email with subdomain', () => {
      expect(rule.validate('test@mail.example.com', {})).toBe(true);
    });

    it('should pass for email with plus sign', () => {
      expect(rule.validate('test+tag@example.com', {})).toBe(true);
    });

    it('should fail for invalid email', () => {
      expect(rule.validate('invalid-email', {})).toBe(false);
    });

    it('should fail for email without domain', () => {
      expect(rule.validate('test@', {})).toBe(false);
    });

    it('should pass for empty string (use required for non-empty)', () => {
      expect(rule.validate('', {})).toBe(true);
    });
  });

  describe('phone', () => {
    const rule = validators.phone();

    it('should pass for valid phone', () => {
      expect(rule.validate('0912345678', {})).toBe(true);
    });

    it('should pass for phone with dashes', () => {
      expect(rule.validate('02-1234-5678', {})).toBe(true);
    });

    it('should pass for international format', () => {
      expect(rule.validate('+886-912-345-678', {})).toBe(true);
    });

    it('should fail for short number', () => {
      expect(rule.validate('12345', {})).toBe(false);
    });
  });

  describe('pattern', () => {
    const rule = validators.pattern(/^[A-Z]\d{9}$/, 'Invalid ID format');

    it('should pass for matching pattern', () => {
      expect(rule.validate('A123456789', {})).toBe(true);
    });

    it('should fail for non-matching pattern', () => {
      expect(rule.validate('123456789', {})).toBe(false);
    });
  });

  describe('min', () => {
    const rule = validators.min(10);

    it('should pass for greater value', () => {
      expect(rule.validate(15, {})).toBe(true);
    });

    it('should pass for equal value', () => {
      expect(rule.validate(10, {})).toBe(true);
    });

    it('should fail for smaller value', () => {
      expect(rule.validate(5, {})).toBe(false);
    });
  });

  describe('max', () => {
    const rule = validators.max(100);

    it('should pass for smaller value', () => {
      expect(rule.validate(50, {})).toBe(true);
    });

    it('should pass for equal value', () => {
      expect(rule.validate(100, {})).toBe(true);
    });

    it('should fail for greater value', () => {
      expect(rule.validate(150, {})).toBe(false);
    });
  });

  describe('match', () => {
    const rule = validators.match<string>('password', 'Passwords must match');

    it('should pass when values match', () => {
      expect(rule.validate('secret123', { password: 'secret123' })).toBe(true);
    });

    it('should fail when values do not match', () => {
      expect(rule.validate('secret123', { password: 'different' })).toBe(false);
    });
  });

  describe('custom', () => {
    const rule = validators.custom<string>(
      (value) => value.startsWith('https://'),
      'URL must start with https://'
    );

    it('should pass for valid value', () => {
      expect(rule.validate('https://example.com', {})).toBe(true);
    });

    it('should fail for invalid value', () => {
      expect(rule.validate('http://example.com', {})).toBe(false);
    });
  });
});
