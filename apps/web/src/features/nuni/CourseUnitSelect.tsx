import type { NuniUnit } from '@campus/shared/src/nuni';

export function CourseUnitSelect({ units }: { units: NuniUnit[] | null }) {
  if (units === null) {
    return <p role="status">章節清單尚未取得；目前發布的內容會先列在未分類。</p>;
  }
  if (!units.length) {
    return <p>目前沒有章節。可先發布未分類內容，或到「學習路徑」建立章節。</p>;
  }
  return (
    <label>
      所屬章節（選填）
      <select name="unitId" defaultValue="">
        <option value="">未分類</option>
        {[...units].sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, 'zh-TW')).map((unit) => (
          <option key={unit.id} value={unit.id}>{unit.title}</option>
        ))}
      </select>
    </label>
  );
}
