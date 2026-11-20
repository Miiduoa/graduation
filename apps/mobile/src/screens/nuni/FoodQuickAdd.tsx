import React, { useMemo, useState } from 'react';
import {
  FOOD_ORDER_PHRASE_MAX_LENGTH,
  previewFoodOrderAddition,
} from '@campus/shared/src/foodOrderPhrase';
import type { NuniFoodMenuItem } from '@campus/shared/src/nuniFoodTypes';
import { FoodButton, FoodCard, FoodField, FoodText } from './NuniFoodUi';

export function FoodQuickAdd({
  items,
  selected,
  disabled,
  onAdd,
}: {
  items: NuniFoodMenuItem[];
  selected: [string, { quantity: string }][];
  disabled: boolean;
  onAdd(lines: { itemId: string; quantity: number }[]): void;
}) {
  const [text, setText] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [notice, setNotice] = useState('');
  const result = useMemo(() => {
    const quantities = new Map(selected.map(([id, line]) => [id, Number(line.quantity)]));
    return previewFoodOrderAddition(text, items, quantities);
  }, [text, items, selected]);
  const available = items.filter(
    (item) => item.available && item.allowedActions.includes('add-to-quote'),
  );
  if (!available.length) return null;
  const example = available
    .slice(0, 2)
    .map((item, i) => item.name + (i ? '一份' : '兩份'))
    .join('、');
  const amounts = result.ok
    ? result.lines.map((line) => `${line.name}共 ${line.quantity} 份`).join('、')
    : '';

  return (
    <FoodCard>
      <FoodText title>快速選餐</FoodText>
      <FoodText subdued>{`例如「${example}」。口味與備註可在購物籃調整。`}</FoodText>
      <FoodField
        label="輸入餐點與份數"
        max={FOOD_ORDER_PHRASE_MAX_LENGTH}
        value={text}
        disabled={disabled}
        onChange={(value) => {
          setText(value);
          setAttempted(false);
          setNotice('');
        }}
      />
      {result.ok ? <FoodText status>{`加入後：${amounts}`}</FoodText> : null}
      {attempted && result.ok === false ? <FoodText alert>{result.message}</FoodText> : null}
      <FoodButton
        disabled={disabled || !text.trim()}
        onPress={() => {
          if (disabled || !text.trim()) return;
          if (!result.ok) {
            setAttempted(true);
            return;
          }
          onAdd(result.lines);
          setNotice(`已加入：${amounts}。`);
          setText('');
          setAttempted(false);
        }}
      >
        加入已選餐點
      </FoodButton>
      {notice ? <FoodText status>{notice}</FoodText> : null}
    </FoodCard>
  );
}
