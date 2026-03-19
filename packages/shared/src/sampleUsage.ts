import { calculateCredits } from "./creditAudit";
import { mockCourses, demoEnrollments, mockGradRuleTemplateV1 } from "./mockData";

// Simple non-runtime helper for examples / manual testing.
// This file is not meant to be imported by app bundles.
export function getDemoCreditAuditResult() {
  const coursesById = Object.fromEntries(mockCourses.map((c) => [c.id, c]));

  return calculateCredits({
    template: mockGradRuleTemplateV1,
    coursesById,
    enrollments: demoEnrollments,
  });
}
