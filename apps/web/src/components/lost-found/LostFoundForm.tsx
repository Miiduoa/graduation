'use client';

import { useId } from 'react';
import { Input, Textarea, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  CONTACT_VISIBILITY_NOTE,
  LOST_FOUND_CATEGORIES,
  type LostFoundWriteFields,
} from '@/lib/lostFound';
import styles from './LostFound.module.css';

export type LostFoundFormErrors = Partial<Record<keyof LostFoundWriteFields | 'form', string>>;

type Props = {
  value: LostFoundWriteFields;
  errors?: LostFoundFormErrors;
  busy?: boolean;
  submitLabel: string;
  onChange: (next: LostFoundWriteFields) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  disabled?: boolean;
  statusMessage?: string;
};

export function validateLostFoundForm(value: LostFoundWriteFields): LostFoundFormErrors {
  const errors: LostFoundFormErrors = {};
  if (value.type !== 'lost' && value.type !== 'found') errors.type = '請選擇遺失或拾獲。';
  if (!value.title.trim()) errors.title = '請填寫標題。';
  else if (value.title.trim().length > 80) errors.title = '標題請勿超過 80 字。';
  if (!value.description.trim()) errors.description = '請填寫說明。';
  else if (value.description.trim().length > 2000) errors.description = '說明請勿超過 2,000 字。';
  if (!value.category.trim()) errors.category = '請選擇分類。';
  if (!value.location.trim()) errors.location = '請填寫地點。';
  else if (value.location.trim().length > 120) errors.location = '地點請勿超過 120 字。';
  if (!value.date.trim()) errors.date = '請選擇日期。';
  else if (!Number.isFinite(new Date(value.date).getTime())) errors.date = '日期格式不正確。';
  if ((value.contactInfo ?? '').trim().length > 200) {
    errors.contactInfo = '聯絡方式請勿超過 200 字。';
  }
  return errors;
}

export function LostFoundForm({
  value,
  errors = {},
  busy = false,
  submitLabel,
  onChange,
  onSubmit,
  onCancel,
  disabled = false,
  statusMessage,
}: Props) {
  const formId = useId();
  const locked = busy || disabled;

  function patch<K extends keyof LostFoundWriteFields>(key: K, next: LostFoundWriteFields[K]) {
    onChange({ ...value, [key]: next });
  }

  return (
    <form
      className={styles.form}
      aria-busy={busy || undefined}
      onSubmit={(event) => {
        event.preventDefault();
        if (!locked) onSubmit();
      }}
      noValidate
    >
      <p className={styles.notice}>{CONTACT_VISIBILITY_NOTE}</p>
      <p className={styles.muted}>
        請在說明寫清楚物品特徵；若需提供照片，可透過聯絡方式與對方約定如何分享。
      </p>

      <div className={styles.formRow}>
        <Select
          id={`${formId}-type`}
          label="類型"
          value={value.type}
          error={errors.type}
          disabled={locked}
          options={[
            { value: 'lost', label: '遺失' },
            { value: 'found', label: '拾獲' },
          ]}
          onChange={(event) => patch('type', event.target.value as 'lost' | 'found')}
        />
        <Select
          id={`${formId}-category`}
          label="分類"
          value={value.category}
          error={errors.category}
          disabled={locked}
          options={LOST_FOUND_CATEGORIES.map((row) => ({ value: row.id, label: row.label }))}
          onChange={(event) => patch('category', event.target.value)}
        />
      </div>

      <Input
        id={`${formId}-title`}
        label="標題"
        value={value.title}
        error={errors.title}
        disabled={locked}
        maxLength={80}
        autoComplete="off"
        onChange={(event) => patch('title', event.target.value)}
      />

      <Textarea
        id={`${formId}-description`}
        label="說明"
        value={value.description}
        error={errors.description}
        disabled={locked}
        maxLength={2000}
        rows={5}
        onChange={(event) => patch('description', event.target.value)}
      />

      <div className={styles.formRow}>
        <Input
          id={`${formId}-location`}
          label="地點"
          value={value.location}
          error={errors.location}
          disabled={locked}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => patch('location', event.target.value)}
        />
        <Input
          id={`${formId}-date`}
          label="日期"
          type="date"
          value={value.date.slice(0, 10)}
          error={errors.date}
          disabled={locked}
          onChange={(event) => patch('date', event.target.value)}
        />
      </div>

      <Input
        id={`${formId}-contact`}
        label="聯絡方式（選填）"
        value={value.contactInfo ?? ''}
        error={errors.contactInfo}
        hint="例如校內信箱或通訊軟體帳號。留白並送出即表示清除聯絡方式。"
        disabled={locked}
        maxLength={200}
        autoComplete="off"
        onChange={(event) => patch('contactInfo', event.target.value)}
      />

      {errors.form ? (
        <p className={styles.error} role="alert">
          {errors.form}
        </p>
      ) : null}
      {statusMessage ? (
        <p className={styles.muted} role="status">
          {statusMessage}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button type="submit" variant="primary" loading={busy} disabled={locked}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
            取消
          </Button>
        ) : null}
      </div>
    </form>
  );
}
