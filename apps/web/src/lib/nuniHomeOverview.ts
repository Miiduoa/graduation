import { createNuniClasses, type NuniTransport } from '@campus/shared/src/nuni';
import type { HomeData, HomeTask } from './homeOverview';

export async function loadNuniHomeData(
  transport: NuniTransport,
  platformAccountId: string,
): Promise<HomeData> {
  const classes = createNuniClasses(transport, platformAccountId);
  const memberships = await classes.list();
  const active = memberships.filter((course) => course.state === 'active');
  const courses = active.map((course) => ({
    id: course.id,
    name: course.title,
    role: course.memberRole,
    unreadCount: 0,
    href: `/classroom/course/${encodeURIComponent(course.id)}`,
  }));
  const tasks: HomeTask[] = [];
  // Bound requests when an account belongs to many courses. A failed course read
  // rejects the overview so an incomplete list never claims all work is done.
  const studying = courses.filter((course) => course.role === 'student');
  for (let start = 0; start < studying.length; start += 4) {
    const batch = await Promise.all(
      studying.slice(start, start + 4).map(async (course) => {
        const assignments = await classes.assignments(course.id);
        return assignments
          .filter((assignment) => assignment.state === 'open' && !assignment.mySubmission)
          .map((assignment) => ({
            id: assignment.id,
            courseId: course.id,
            courseName: course.name,
            title: assignment.title,
            dueAt: assignment.dueAt,
            href: `${course.href}#assignment-${encodeURIComponent(assignment.id)}`,
            acceptsLate: true,
          }));
      }),
    );
    tasks.push(...batch.flat());
  }
  tasks.sort(
    (first, second) =>
      (first.dueAt ? Date.parse(first.dueAt) : Infinity) -
      (second.dueAt ? Date.parse(second.dueAt) : Infinity),
  );
  return {
    courses,
    tasks,
    unreadCount: 0,
    archivedCount: memberships.length - active.length,
  };
}
