import { CourseAttendance } from '@/components/CourseAttendance';

export default async function AttendancePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  return <CourseAttendance courseId={courseId} />;
}
