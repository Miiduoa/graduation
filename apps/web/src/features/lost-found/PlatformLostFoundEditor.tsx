'use client';

import { useState } from 'react';
import { NUNI_LOST_FOUND_CONTACT_NOTE } from '@campus/shared/src/nuniLostFound';
import { lostFoundFormFields, type LostFoundWriteFields } from '@campus/shared/src/lostFoundFields';
import { Button } from '@/components/ui/Button';
import {
  LostFoundForm,
  validateLostFoundForm,
  type LostFoundFormErrors,
} from '@/components/lost-found/LostFoundForm';
import styles from '@/components/lost-found/LostFound.module.css';

export function PlatformLostFoundEditor({
  initial,
  busy,
  pending,
  disabled,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: LostFoundWriteFields;
  busy: boolean;
  pending?: boolean;
  disabled: boolean;
  submitLabel: string;
  onSubmit: (fields: LostFoundWriteFields) => void;
  onCancel?: () => void;
}) {
  const [fields, setFields] = useState(initial);
  const [errors, setErrors] = useState<LostFoundFormErrors>({});
  return (
    <div className={styles.stack}>
      <LostFoundForm
        value={fields}
        errors={errors}
        busy={busy}
        disabled={disabled || pending}
        submitLabel={submitLabel}
        onChange={setFields}
        onCancel={pending ? undefined : onCancel}
        contactVisibilityNote={NUNI_LOST_FOUND_CONTACT_NOTE}
        statusMessage={
          pending
            ? '內容已鎖定，請先確認同一筆操作的結果。'
            : '送出前的內容只保留在目前畫面；離開前請先確認。'
        }
        onSubmit={() => {
          const next = validateLostFoundForm(fields);
          setErrors(next);
          if (Object.keys(next).length === 0) onSubmit(lostFoundFormFields(fields));
        }}
      />
      {pending && (
        <Button variant="primary" disabled={busy || disabled} onClick={() => onSubmit(fields)}>
          {busy ? '正在確認…' : '重試並確認結果'}
        </Button>
      )}
    </div>
  );
}
