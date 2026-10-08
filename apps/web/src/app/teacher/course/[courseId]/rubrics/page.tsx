import {
  UnavailableCourseTool,
  type CourseToolProps,
} from '@/components/teaching/UnavailableCourseTool';

export default function Page(props: CourseToolProps) {
  return <UnavailableCourseTool {...props} title="評分規準" />;
}
