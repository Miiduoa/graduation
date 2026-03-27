import { describe, expect, it } from "vitest";

import { resolveSchoolPageContext } from "./pageContext";

describe("resolveSchoolPageContext", () => {
  it("always resolves to Providence University even when other school params are provided", () => {
    const context = resolveSchoolPageContext({
      school: "TCU",
      schoolId: "tw-taichung-uni-b",
    });

    expect(context.schoolId).toBe("pu");
    expect(context.schoolCode).toBe("PU");
    expect(context.schoolName).toBe("靜宜大學");
    expect(context.schoolContext).toEqual({
      code: "PU",
      id: "pu",
    });
    expect(context.schoolSearch).toBe("?school=PU&schoolId=pu");
  });

  it("falls back to Providence University when no usable school context is provided", () => {
    const context = resolveSchoolPageContext({
      school: "TCU",
    });

    expect(context.schoolId).toBe("pu");
    expect(context.schoolName).toBe("靜宜大學");
    expect(context.schoolSearch).toBe("?school=PU&schoolId=pu");
  });
});
