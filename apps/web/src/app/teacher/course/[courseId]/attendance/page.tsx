import { CourseAttendance } from '@/components/CourseAttendance';
import type { SchoolSearchParams } from '@/lib/pageContext';

export default async function AttendancePage({
  params,
  searchParams,
}: {
  params: Promise<{ courseId: string }>;
  searchParams?: Promise<SchoolSearchParams>;
}) {
  const { courseId } = await params;
  return (
    <CourseAttendance
      courseId={courseId}
      audience="teacher"
      searchParams={searchParams ? await searchParams : undefined}
    />
  );
}
