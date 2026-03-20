import {
  normalizeCollectionPathSegments,
  normalizeDocPathSegments,
} from "../../data/firestorePath";

describe("mobile firestore path helpers", () => {
  it("accepts collection paths with an odd number of segments", () => {
    expect(normalizeCollectionPathSegments(["schools", "nchu", "announcements"])).toEqual([
      "schools",
      "nchu",
      "announcements",
    ]);
  });

  it("accepts document paths with an even number of segments", () => {
    expect(normalizeDocPathSegments(["schools", "nchu"])).toEqual(["schools", "nchu"]);
  });

  it("rejects invalid collection paths", () => {
    expect(() => normalizeCollectionPathSegments(["schools", "nchu"])).toThrow(
      "Invalid Firestore collection path"
    );
  });

  it("rejects invalid document paths", () => {
    expect(() => normalizeDocPathSegments(["schools", "nchu", "announcements"])).toThrow(
      "Invalid Firestore document path"
    );
  });
});
