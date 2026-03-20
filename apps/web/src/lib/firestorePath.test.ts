import { describe, expect, it } from "vitest";

import {
  normalizeCollectionPathSegments,
  normalizeDocPathSegments,
} from "./firestorePath";

describe("web firestore path helpers", () => {
  it("accepts collection paths with an odd number of segments", () => {
    expect(normalizeCollectionPathSegments(["schools", "nthu", "groups"])).toEqual([
      "schools",
      "nthu",
      "groups",
    ]);
  });

  it("accepts document paths with an even number of segments", () => {
    expect(normalizeDocPathSegments(["schools", "nthu"])).toEqual(["schools", "nthu"]);
  });

  it("rejects invalid collection paths", () => {
    expect(() => normalizeCollectionPathSegments(["schools", "nthu"])).toThrow(
      "Invalid Firestore collection path"
    );
  });

  it("rejects invalid document paths", () => {
    expect(() => normalizeDocPathSegments(["schools", "nthu", "groups"])).toThrow(
      "Invalid Firestore document path"
    );
  });
});
