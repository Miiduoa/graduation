import { Suspense } from 'react';
import { OralExamPlayground } from './OralExamPlayground';

export default function OralExamDemoPage() {
  return (
    <Suspense fallback={<p role="status">載入口試示範工作區…</p>}>
      <OralExamPlayground />
    </Suspense>
  );
}
