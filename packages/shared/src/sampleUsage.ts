import { calculateCredits } from "./creditAudit";
import { mockCourses, demoEnrollments, mockGradRuleTemplateV1 } from "./mockData";

const coursesById = Object.fromEntries(mockCourses.map((c) => [c.id, c]));

const res = calculateCredits({
  template: mockGradRuleTemplateV1,
  coursesById,
  enrollments: demoEnrollments,
});

console.log(res);
