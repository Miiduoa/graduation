import { useMemo, useState } from 'react';
import type { NuniFoodMenuItem } from '@campus/shared/src/nuniFood';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  FOOD_ORDER_PHRASE_MAX_LENGTH,
  previewFoodOrderAddition,
} from '@campus/shared/src/foodOrderPhrase';
import styles from './Food.module.css';

export function FoodQuickAdd({
  items,
  cart,
  disabled,
  onApply,
}: {
  items: NuniFoodMenuItem[];
  cart: Record<string, { quantity: number }>;
  disabled: boolean;
  onApply(lines: { itemId: string; quantity: number }[]): void;
}) {
  const [text, setText] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState('');
  const basket = useMemo(() => {
    const selected = new Map<string, number>();
    for (const [id, line] of Object.entries(cart)) {
      if (line.quantity !== 0) selected.set(id, line.quantity);
    }
    return selected;
  }, [cart]);
  const preview = useMemo(
    () => previewFoodOrderAddition(text, items, basket),
    [text, items, basket],
  );
  const available = items.filter(
    (item) => item.available && item.allowedActions.includes('add-to-quote'),
  );
  if (!available.length) return null;

  const amounts = preview.ok
    ? preview.lines.map((line) => `${line.name}共 ${line.quantity} 份`).join('、')
    : '';

  return (
    <form
      className={`${styles.panel} ${styles.quickAdd}`}
      aria-label="快速選餐"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !text.trim()) return;
        setAttempted(true);
        if (!preview.ok) return;
        onApply(preview.lines);
        setNotice(`已加入：${amounts}。`);
        setText('');
        setAttempted(false);
      }}
    >
      <Input
        label="輸入餐點與份數"
        placeholder={available
          .slice(0, 2)
          .map((item, index) => item.name + (index ? '一份' : '兩份'))
          .join('、')}
        hint="多道餐點可用頓號隔開。加入後可選口味、填備註。"
        maxLength={FOOD_ORDER_PHRASE_MAX_LENGTH}
        value={text}
        disabled={disabled}
        error={attempted && !preview.ok ? preview.message : undefined}
        onChange={(event) => {
          setText(event.target.value);
          setAttempted(false);
          setNotice('');
        }}
      />
      {preview.ok && (
        <p className={styles.preview} aria-live="polite">
          加入後：{amounts}
        </p>
      )}
      <div className={styles.bar}>
        <Button type="submit" disabled={disabled || !text.trim()}>
          加入已選餐點
        </Button>
        {notice && <p role="status">{notice}</p>}
      </div>
    </form>
  );
}
