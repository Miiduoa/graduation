import { useRef, useState } from 'react';
import { cleanCourse } from '@campus/shared';
import { CourseEditor } from '../../../apps/web/src/components/timetable/CourseEditor';
import { preferredScrollBehavior } from '../../../apps/web/src/lib/scrollBehavior';

const initial = cleanCourse({
  id: 'interface-course',
  name: '資料結構與演算法設計',
  day: 1,
  start: 3,
  end: 4,
  teacher: '林老師',
  room: '資訊大樓 I208',
});

/** Real editing UI, with local course data and no persistence or school API. */
export function CourseEditing() {
  const [open, setOpen] = useState(false);
  const [course, setCourse] = useState(initial);
  const [busy, setBusy] = useState(false);
  const target = useRef<HTMLHeadingElement>(null);
  const [scrollResult, setScrollResult] = useState<{ before: number; after: number } | null>(null);

  function begin() {
    setCourse(initial);
    setBusy(false);
    setOpen(true);
  }

  return (
    <section aria-label="課程編輯驗收">
      <h1>課程編輯與接續</h1>
      <p className="fixture-copy">使用實際課程編輯視窗與本機合成資料，儲存動作只模擬等待狀態。</p>
      <button type="button" className="btn primary" onClick={begin}>編輯範例課程</button>
      {open && (
        <CourseEditor
          course={course}
          courses={[initial]}
          existing
          busy={busy}
          feedback=""
          onChange={setCourse}
          onSave={() => setBusy(true)}
          onRemove={() => setOpen(false)}
          onCancel={() => setOpen(false)}
          courseWorkHref="/course/interface-course#assignment-work-a"
        />
      )}
      <div className="fixture-controls">
        <p className="fixture-copy">下方動作使用課表匯入、作業與測驗共用的捲動偏好。</p>
        <button
          type="button"
          className="btn"
          onClick={() => {
            const before = target.current!.getBoundingClientRect().top;
            target.current!.scrollIntoView({ behavior: preferredScrollBehavior(), block: 'start' });
            // Capture synchronously: reduced motion must finish immediately,
            // while ordinary smooth scrolling is allowed to animate afterward.
            setScrollResult({ before, after: target.current!.getBoundingClientRect().top });
          }}
        >
          查看捲動結果
        </button>
        <div style={{ height: 1200 }} aria-hidden="true" />
        <h2 ref={target} tabIndex={-1}>捲動結果</h2>
        <output
          aria-label="捲動位置紀錄"
          data-before={scrollResult?.before}
          data-after={scrollResult?.after}
        >
          {scrollResult ? '已記錄此次定位' : '等待定位'}
        </output>
        <div style={{ height: 1000 }} aria-hidden="true" />
      </div>
    </section>
  );
}
