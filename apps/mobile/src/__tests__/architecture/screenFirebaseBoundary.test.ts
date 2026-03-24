import fs from "node:fs";
import path from "node:path";

const {
  allowedScreenDirectFirebaseImports,
} = require("../../../firebase-screen-boundaries.js") as {
  allowedScreenDirectFirebaseImports: string[];
};

function listScreenFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listScreenFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".tsx")) {
      files.push(entryPath);
    }
  }

  return files;
}

function toRepoPath(filePath: string): string {
  const relative = path.relative(process.cwd(), filePath).split(path.sep).join("/");
  return `apps/mobile/${relative}`;
}

describe("screen Firebase boundaries", () => {
  it("only allows direct Firebase imports in the explicit allowlist", () => {
    const screenDir = path.join(process.cwd(), "src", "screens");
    const screenFiles = listScreenFiles(screenDir);
    const restrictedImportPatterns = [
      /from ["']firebase\/firestore["']/,
      /from ["']\.\.\/firebase["']/,
    ];

    const offenders = screenFiles
      .map((filePath) => {
        const source = fs.readFileSync(filePath, "utf8");
        const repoPath = toRepoPath(filePath);
        const hasRestrictedImport = restrictedImportPatterns.some((pattern) => pattern.test(source));
        return hasRestrictedImport && !allowedScreenDirectFirebaseImports.includes(repoPath) ? repoPath : null;
      })
      .filter((value): value is string => value !== null);

    const staleAllowlistEntries = allowedScreenDirectFirebaseImports.filter((repoPath) => {
      const localPath = repoPath.replace(/^apps\/mobile\//, "");
      const fullPath = path.join(process.cwd(), localPath);
      if (!fs.existsSync(fullPath)) return true;
      const source = fs.readFileSync(fullPath, "utf8");
      return !restrictedImportPatterns.some((pattern) => pattern.test(source));
    });

    expect(offenders).toEqual([]);
    expect(staleAllowlistEntries).toEqual([]);
  });
});
