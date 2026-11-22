import { useEffect, useState, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { AppFrame } from '../../../apps/web/src/components/AppFrame';
import { TeacherToday } from '../../../apps/web/src/components/today/TeacherToday';
import { Button } from '../../../apps/web/src/components/ui/Button';
import {
  AssignmentFilePicker,
  AssignmentFilePreview,
  useAssignmentFilePreviews,
  type LocalAssignmentFile,
} from '../../../apps/web/src/features/nuni/AssignmentFileFields';
import {
  ReviewModal,
  CreateGroupModal,
  CourseReviewSection,
  StudyGroupSection,
} from '../../../apps/web/src/app/community/_components/StudyBuddyTab';
import type { CommunityFormDisplay } from '../../../apps/web/src/app/community/_components/useCommunityFormSession';
import { taskFlowWrites } from './task-flow-boundaries';
import home from '../../../apps/web/src/app/home.module.css';
import '../../../apps/web/src/app/globals.css';

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get('theme') === 'dark' ? 'dark' : 'light';
if (params.get('text') === '200') document.documentElement.style.fontSize = '200%';
if (params.get('motion') === 'reduce') document.documentElement.dataset.reducedMotion = 'true';

const canvas = document.createElement('canvas');
canvas.width = 480;
canvas.height = 2400;
const drawing = canvas.getContext('2d')!;
for (let band = 0; band < 12; band += 1) {
  drawing.fillStyle = band % 2 === 0 ? '#e8f1ee' : '#d5e5df';
  drawing.fillRect(0, band * 200, 480, 200);
  drawing.fillStyle = '#234b3c';
  drawing.font = '24px sans-serif';
  drawing.fillText(`Synthetic assignment / ${band + 1}`, 24, band * 200 + 90);
}
const longImage: LocalAssignmentFile = {
  key: 'synthetic-tall-assignment',
  kind: 'image',
  file: new File(['synthetic-preview-only'], '課程筆記長圖.png', { type: 'image/png' }),
  previewUrl: canvas.toDataURL('image/png'),
};
const now = new Date('2026-11-21T09:00:00+08:00');
const course = {
  id: 'synthetic-teaching-course',
  name: '資訊系統設計與實作',
  role: 'owner-teacher',
  unreadCount: 0,
  href: '/classroom/course/synthetic-teaching-course?campus=pu',
};
type TimetableStatus = ComponentProps<typeof TeacherToday>['timetableStatus'];
type CourseState = 'ready' | 'loading' | 'error' | 'empty';

function TaskFlowFixture() {
  const [timetableStatus, setTimetableStatus] = useState<TimetableStatus>('loading');
  const [courseState, setCourseState] = useState<CourseState>('ready');
  const [reviewRequired, setReviewRequired] = useState(false);
  const [files, setFiles] = useState<LocalAssignmentFile[]>([]);
  const [reviewDisplay, setReviewDisplay] = useState<CommunityFormDisplay>('closed');
  const [groupDisplay, setGroupDisplay] = useState<CommunityFormDisplay>('closed');
  const [completed, setCompleted] = useState('');
  const [timetableRetries, setTimetableRetries] = useState(0);
  const [courseRetries, setCourseRetries] = useState(0);
  useAssignmentFilePreviews(files);
  useEffect(() => {
    Object.assign(window, {
      __taskFlowQA: {
        setTimetableStatus,
        setCourseState,
        settle: taskFlowWrites.settle,
        snapshot: () => ({
          synthetic: true,
          timetableStatus,
          courseState,
          timetableRetries,
          courseRetries,
          completed,
          files: files.map(({ file, kind }) => ({ name: file.name, kind, type: file.type })),
          writes: taskFlowWrites.snapshot(),
        }),
      },
    });
  }, [timetableStatus, courseState, timetableRetries, courseRetries, completed, files]);

  return (
    <AppFrame contentId="task-flow-content" pageClassName={home.todayPage}>
      <TeacherToday
        now={now}
        unsigned={false}
        timetableStatus={timetableStatus}
        timetableSchoolId="pu"
        classes={
          timetableStatus === 'ready'
            ? [
                {
                  id: 'synthetic-class',
                  title: course.name,
                  location: '任垣樓 101',
                  startAt: Date.parse('2026-11-21T10:10:00+08:00'),
                  endAt: Date.parse('2026-11-21T12:00:00+08:00'),
                },
              ]
            : []
        }
        onRetryTimetable={() => setTimetableRetries((count) => count + 1)}
        upcomingTodos={[]}
        teachingCourses={courseState === 'empty' ? [] : [course]}
        coursesLoading={courseState === 'loading'}
        coursesError={courseState === 'error' ? '部分課程資料尚未讀到，請重試。' : ''}
        onRetryCourses={() => setCourseRetries((count) => count + 1)}
        timetableHref="/timetable?campus=pu"
        importHref="/import?kind=timetable&campus=pu"
      />
      <section className={home.section} aria-label="附件選擇驗收">
        <h2>作業附件</h2>
        <AssignmentFilePicker
          files={files}
          onChange={setFiles}
          reviewRequired={reviewRequired}
          onReviewRequiredChange={setReviewRequired}
        />
      </section>
      <section className={home.section} aria-label="長圖預覽驗收">
        <h2>預覽課程筆記</h2>
        <AssignmentFilePreview files={[longImage]} />
      </section>
      <section className={home.section} aria-label="社群表單驗收">
        <h2>課程交流</h2>
        <div className="fixture-buttons">
          <Button onClick={() => setReviewDisplay('open')}>寫課程評價</Button>
          <Button onClick={() => setGroupDisplay('open')}>建立讀書會</Button>
        </div>
        {completed && <p role="status">{completed}</p>}
      </section>
      <section className={home.section} aria-label="課程評價父層驗收">
        <h2>課程評價</h2>
        <CourseReviewSection schoolId="pu" myUid="synthetic-teacher" />
      </section>
      <section className={home.section} aria-label="讀書會父層驗收">
        <h2>讀書會</h2>
        <StudyGroupSection schoolId="pu" myUid="synthetic-teacher" myName="合成老師" />
      </section>
      <section className="fixture-controls" aria-label="任務流程驗收控制">
        <p>以上均為真實產品元件；帳號、課程與資料寫入使用獨立合成資料。</p>
        <div className="fixture-buttons">
          {(['loading', 'error', 'empty', 'unsigned-scope', 'ready'] as const).map((status) => (
            <Button key={status} onClick={() => setTimetableStatus(status)}>
              課表：{status}
            </Button>
          ))}
        </div>
      </section>
      {reviewDisplay !== 'closed' && (
        <ReviewModal
          open={reviewDisplay === 'open'}
          schoolId="pu"
          myUid="synthetic-teacher"
          onClose={(reason) => setReviewDisplay(reason === 'retain' ? 'retained-hidden' : 'closed')}
          onSubmitted={() => {
            setCompleted('合成評價已完成');
            setReviewDisplay('closed');
          }}
        />
      )}
      {groupDisplay !== 'closed' && (
        <CreateGroupModal
          open={groupDisplay === 'open'}
          schoolId="pu"
          myUid="synthetic-teacher"
          myName="合成老師"
          onClose={(reason) => setGroupDisplay(reason === 'retain' ? 'retained-hidden' : 'closed')}
          onCreated={() => {
            setCompleted('合成讀書會已完成');
            setGroupDisplay('closed');
          }}
        />
      )}
    </AppFrame>
  );
}

createRoot(document.getElementById('root')!).render(<TaskFlowFixture />);
