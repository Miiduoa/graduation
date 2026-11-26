import { LOST_FOUND_CATEGORIES } from '@/lib/lostFound';
import { Select } from '@/components/ui/Input';

const options = [
  { value: '', label: '全部分類' },
  ...LOST_FOUND_CATEGORIES.map(({ id, label }) => ({ value: id, label })),
];

export function LostFoundCategoryFilter({
  value,
  onChange,
}: {
  value?: string;
  onChange: (category: string | undefined) => void;
}) {
  return (
    <Select
      label="物品分類"
      value={value ?? ''}
      options={options}
      onChange={(event) => onChange(event.target.value || undefined)}
    />
  );
}
