import { describe, expect, it } from "vitest";

import { resolveSchoolPageContext } from "./pageContext";

describe("resolveSchoolPageContext", () => {
  it("prefers schoolId over ambiguous school code", () => {
    const context = resolveSchoolPageContext({
      school: "TCU",
      schoolId: "tw-taichung-uni-b",
    });

    expect(context.schoolId).toBe("tw-taichung-uni-b");
    expect(context.schoolCode).toBe("TCU");
    expect(context.schoolName).toBe("台中大學（示範B）");
    expect(context.schoolContext).toEqual({
      code: "TCU",
      id: "tw-taichung-uni-b",
    });
    expect(context.schoolSearch).toBe("?school=TCU&schoolId=tw-taichung-uni-b");
  });

  it("falls back to the default school when only an ambiguous code is provided", () => {
    const context = resolveSchoolPageContext({
      school: "TCU",
    });

    expect(context.schoolId).toBe("tw-demo-uni");
    expect(context.schoolName).toBe("示範大學");
    expect(context.schoolSearch).toBe("?school=DEMO&schoolId=tw-demo-uni");
  });
});
