import { collection, doc, type CollectionReference, type DocumentReference, type Firestore } from "firebase/firestore";

function assertPathSegments(
  pathSegments: string[],
  kind: "collection" | "document"
): [string, ...string[]] {
  if (pathSegments.length === 0) {
    throw new Error(`Cannot resolve empty Firestore ${kind} path`);
  }

  const shouldBeOdd = kind === "collection";
  const isValid = shouldBeOdd ? pathSegments.length % 2 === 1 : pathSegments.length % 2 === 0;
  if (!isValid) {
    throw new Error(`Invalid Firestore ${kind} path: ${pathSegments.join("/")}`);
  }

  const [first, ...rest] = pathSegments;
  return [first, ...rest];
}

export function normalizeCollectionPathSegments(pathSegments: string[]): [string, ...string[]] {
  return assertPathSegments(pathSegments, "collection");
}

export function normalizeDocPathSegments(pathSegments: string[]): [string, ...string[]] {
  return assertPathSegments(pathSegments, "document");
}

export function collectionFromSegments(
  firestore: Firestore,
  pathSegments: string[]
): CollectionReference {
  const [first, ...rest] = normalizeCollectionPathSegments(pathSegments);
  return collection(firestore, first, ...rest);
}

export function docFromSegments(
  firestore: Firestore,
  pathSegments: string[]
): DocumentReference {
  const [first, ...rest] = normalizeDocPathSegments(pathSegments);
  return doc(firestore, first, ...rest);
}
