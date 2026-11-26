import Link from 'next/link';
import { NuniNextStep } from '@/components/NuniNextStep';
import { platformLostFoundHref } from '@/features/lost-found/platformLostFoundUi';
import { type LostFoundItem } from '@/lib/lostFound';
import { lostFoundListCategory, lostFoundListHref } from '@/lib/lostFoundListNavigation';

export function LostFoundNextStep({
  item,
  source,
}: {
  item: Pick<LostFoundItem, 'schoolId' | 'title' | 'type' | 'category' | 'status'>;
  source: 'school' | 'platform';
}) {
  const category = lostFoundListCategory(item.category);
  if (!category || (item.status !== 'open' && item.status !== 'active')) return null;
  const type = item.type === 'lost' ? 'found' : 'lost';
  const filters = { category, type, status: 'open' } as const;
  const href =
    source === 'school'
      ? lostFoundListHref(item.schoolId, { source, ...filters })
      : platformLostFoundHref(item.schoolId, 'list', undefined, filters);
  return (
    <NuniNextStep
      reason={
        type === 'found'
          ? `「${item.title}」還在尋找中，可以看看同校有沒有人拾獲同類物品。`
          : `你刊登了「${item.title}」，可以看看同校有誰正在找同類物品。`
      }
    >
      <Link className="btn" href={href}>
        {type === 'found' ? '查看同類拾獲物' : '查看同類遺失物'}
      </Link>
    </NuniNextStep>
  );
}
