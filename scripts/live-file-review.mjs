#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_FILE = "apps/mobile/src/screens/AchievementsScreen.tsx";
const DEFAULT_INTERVAL_SECONDS = 10;

const TYPECHECK_CONTEXTS = [
  {
    name: "mobile",
    root: path.join(REPO_ROOT, "apps", "mobile"),
    command: ["pnpm", "--filter", "mobile", "typecheck"],
  },
  {
    name: "web",
    root: path.join(REPO_ROOT, "apps", "web"),
    command: ["pnpm", "--filter", "web", "typecheck"],
  },
  {
    name: "shared",
    root: path.join(REPO_ROOT, "packages", "shared"),
    command: ["pnpm", "--filter", "@campus/shared", "typecheck"],
  },
];

function printHelp() {
  console.log(
    [
      "Usage:",
      "  pnpm live-review:file --file apps/mobile/src/screens/AchievementsScreen.tsx --interval 10 --apply-safe-fixes",
      "",
      "Options:",
      "  --file <path>            File to monitor. Defaults to apps/mobile/src/screens/AchievementsScreen.tsx",
      "  --interval <seconds>     Poll interval in seconds. Defaults to 10",
      "  --apply-safe-fixes       Apply safe remove-only ESLint suggestions for unused identifiers",
      "  --once                   Run one review cycle and exit",
      "  --help                   Show this message",
    ].join("\n")
  );
}

function parseArgs(argv) {
  const options = {
    file: DEFAULT_FILE,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    applySafeFixes: false,
    once: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--help" || token === "-h") {
      options.help = true;
      continue;
    }

    if (token === "--apply-safe-fixes") {
      options.applySafeFixes = true;
      continue;
    }

    if (token === "--once") {
      options.once = true;
      continue;
    }

    if (token === "--file" || token === "--interval") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${token}`);
      }

      if (token === "--file") {
        options.file = value;
      } else {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`Invalid interval: ${value}`);
        }
        options.intervalSeconds = parsed;
      }

      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return options;
}

function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function isWithinPath(filePath, directory) {
  const relative = path.relative(directory, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function formatTimestamp(date = new Date()) {
  return date.toLocaleString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function hashContent(content) {
  return crypto.createHash("sha1").update(content).digest("hex");
}

async function readFileSnapshot(targetFile) {
  const [stats, content] = await Promise.all([
    fs.stat(targetFile),
    fs.readFile(targetFile, "utf8"),
  ]);

  return {
    mtimeMs: stats.mtimeMs,
    content,
    hash: hashContent(content),
  };
}

function toSignature(snapshot) {
  return `${snapshot.mtimeMs}:${snapshot.hash}`;
}

function runCommand(command, args, options = {}) {
  const cwd = options.cwd ?? REPO_ROOT;
  const env = { ...process.env, ...(options.env ?? {}) };

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function extractJsonPayload(output) {
  const trimmed = output.trim();
  if (!trimmed) {
    return "[]";
  }

  const startIndex = trimmed.indexOf("[");
  const endIndex = trimmed.lastIndexOf("]");
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("Unable to locate ESLint JSON payload.");
  }

  return trimmed.slice(startIndex, endIndex + 1);
}

async function runLint(targetFile) {
  const result = await runCommand("pnpm", [
    "exec",
    "eslint",
    "--format",
    "json",
    "--fix-dry-run",
    "--no-error-on-unmatched-pattern",
    targetFile,
  ]);

  if (result.code !== 0 && result.code !== 1) {
    throw new Error(`ESLint failed with exit code ${result.code ?? "unknown"}.\n${result.stderr || result.stdout}`);
  }

  const parsed = JSON.parse(extractJsonPayload(result.stdout));
  return parsed[0] ?? { filePath: targetFile, messages: [], warningCount: 0, errorCount: 0 };
}

function buildLintIssues(lintResult) {
  const issues = [];

  for (const message of lintResult.messages ?? []) {
    const ruleId = message.ruleId ?? "unknown";
    const severity = message.severity === 2 ? "error" : "warning";
    const line = message.line ?? 1;
    const column = message.column ?? 1;

    issues.push({
      key: `lint:${severity}:${ruleId}:${line}:${column}:${message.message}`,
      source: "lint",
      line,
      column,
      summary: `[${ruleId}] ${message.message}`,
      sortKey: `${String(line).padStart(6, "0")}:${String(column).padStart(6, "0")}:lint:${ruleId}`,
    });
  }

  return issues.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

function collectSafeFixes(lintResult) {
  const candidates = [];

  for (const message of lintResult.messages ?? []) {
    if (message.ruleId !== "@typescript-eslint/no-unused-vars") {
      continue;
    }

    if (!Array.isArray(message.suggestions)) {
      continue;
    }

    const suggestion = message.suggestions.find((item) => {
      const range = item?.fix?.range;
      return (
        typeof item?.desc === "string" &&
        item.desc.startsWith("Remove unused variable") &&
        item.fix?.text === "" &&
        Array.isArray(range) &&
        Number.isInteger(range[0]) &&
        Number.isInteger(range[1]) &&
        range[1] > range[0]
      );
    });

    if (!suggestion) {
      continue;
    }

    candidates.push({
      start: suggestion.fix.range[0],
      end: suggestion.fix.range[1],
      text: suggestion.fix.text,
      description: `${message.line ?? 1}:${message.column ?? 1} ${suggestion.desc}`,
    });
  }

  candidates.sort((left, right) => left.start - right.start || left.end - right.end);

  const accepted = [];
  let lastEnd = -1;

  for (const candidate of candidates) {
    if (candidate.start < lastEnd) {
      continue;
    }

    accepted.push(candidate);
    lastEnd = candidate.end;
  }

  return accepted;
}

function applyTextFixes(source, fixes) {
  let output = source;

  for (const fix of [...fixes].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, fix.start) + fix.text + output.slice(fix.end);
  }

  return output;
}

function detectTypecheckContext(targetFile) {
  return TYPECHECK_CONTEXTS.find((context) => isWithinPath(targetFile, context.root)) ?? null;
}

function extractTypecheckIssues(output, targetFile, context) {
  if (!context) {
    return [];
  }

  const repoRelative = normalizePath(path.relative(REPO_ROOT, targetFile));
  const workspaceRelative = normalizePath(path.relative(context.root, targetFile));
  const absolute = normalizePath(targetFile);
  const targetVariants = new Set([repoRelative, workspaceRelative, absolute]);
  const diagnostics = [];
  const lines = output.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(.*)\((\d+),(\d+)\): error TS(\d+): (.*)$/);
    if (!match) {
      continue;
    }

    const [, rawFile, rawLine, rawColumn, code, headline] = match;
    const normalizedFile = normalizePath(rawFile.trim());
    const details = [];
    let nextIndex = index + 1;

    while (nextIndex < lines.length && /^\s+/.test(lines[nextIndex])) {
      details.push(lines[nextIndex].trim());
      nextIndex += 1;
    }

    index = nextIndex - 1;

    if (!targetVariants.has(normalizedFile)) {
      continue;
    }

    const lineNumber = Number(rawLine);
    const columnNumber = Number(rawColumn);
    const summary = details.length > 0 ? `${headline} | ${details.join(" | ")}` : headline;

    diagnostics.push({
      key: `typecheck:${code}:${lineNumber}:${columnNumber}:${summary}`,
      source: "typecheck",
      line: lineNumber,
      column: columnNumber,
      summary: `[TS${code}] ${summary}`,
      sortKey: `${String(lineNumber).padStart(6, "0")}:${String(columnNumber).padStart(6, "0")}:typecheck:${code}`,
    });
  }

  return diagnostics.sort((left, right) => left.sortKey.localeCompare(right.sortKey));
}

async function runTypecheck(targetFile) {
  const context = detectTypecheckContext(targetFile);
  if (!context) {
    return { issues: [], skippedReason: "No configured typecheck workspace for this file." };
  }

  const [command, ...args] = context.command;
  const result = await runCommand(command, args);
  const combinedOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const issues = extractTypecheckIssues(combinedOutput, targetFile, context);

  return { issues, workspace: context.name };
}

function diffIssues(previousIssues, currentIssues) {
  const previousMap = new Map(previousIssues.map((issue) => [issue.key, issue]));
  const currentMap = new Map(currentIssues.map((issue) => [issue.key, issue]));

  const newIssues = currentIssues.filter((issue) => !previousMap.has(issue.key));
  const resolvedIssues = previousIssues.filter((issue) => !currentMap.has(issue.key));

  return { newIssues, resolvedIssues };
}

function formatIssue(issue) {
  return `${issue.line}:${issue.column} ${issue.summary}`;
}

function printSection(title, items) {
  console.log(`${title}:`);
  if (items.length === 0) {
    console.log("  - none");
    return;
  }

  for (const item of items) {
    console.log(`  - ${item}`);
  }
}

async function performReview({ targetFile, applySafeFixes, previousIssues, isBaseline }) {
  const initialSnapshot = await readFileSnapshot(targetFile);
  let lintResult = await runLint(targetFile);
  const autoFixed = [];
  let fileChangedDuringAnalysis = false;

  if (applySafeFixes) {
    const safeFixes = collectSafeFixes(lintResult);

    if (safeFixes.length > 0) {
      const latestSnapshot = await readFileSnapshot(targetFile);
      if (toSignature(initialSnapshot) !== toSignature(latestSnapshot)) {
        fileChangedDuringAnalysis = true;
        lintResult = await runLint(targetFile);
      } else {
        const nextContent = applyTextFixes(initialSnapshot.content, safeFixes);
        if (nextContent !== initialSnapshot.content) {
          await fs.writeFile(targetFile, nextContent, "utf8");
          autoFixed.push(...safeFixes.map((fix) => fix.description));
          lintResult = await runLint(targetFile);
        }
      }
    }
  }

  const lintIssues = buildLintIssues(lintResult);
  const typecheckResult = await runTypecheck(targetFile);
  const currentIssues = [...lintIssues, ...typecheckResult.issues].sort((left, right) => left.sortKey.localeCompare(right.sortKey));
  const { newIssues, resolvedIssues } = diffIssues(previousIssues, currentIssues);
  const snapshot = await readFileSnapshot(targetFile);

  console.log("");
  console.log("Live File Review");
  console.log(`target file: ${normalizePath(path.relative(REPO_ROOT, targetFile))}`);
  console.log(`detected at: ${formatTimestamp()}`);
  console.log(`mode: ${isBaseline ? "baseline" : "delta"}`);
  console.log(`new issues: ${isBaseline ? currentIssues.length : newIssues.length}`);
  console.log(`resolved issues: ${isBaseline ? 0 : resolvedIssues.length}`);
  console.log(`tracked unresolved total: ${currentIssues.length}`);
  if (typecheckResult.workspace) {
    console.log(`typecheck workspace: ${typecheckResult.workspace}`);
  }

  if (fileChangedDuringAnalysis) {
    console.log("note: file changed during analysis; skipped auto-fix for this cycle.");
  }

  if (typecheckResult.skippedReason) {
    console.log(`note: ${typecheckResult.skippedReason}`);
  }

  printSection("auto-fixed", autoFixed);
  const remainingManualItems = (isBaseline ? currentIssues : newIssues).map(formatIssue);
  printSection("remaining manual fixes", remainingManualItems);

  return {
    issues: currentIssues,
    signature: toSignature(snapshot),
  };
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function main() {
  let options;

  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }

  const targetFile = path.isAbsolute(options.file)
    ? options.file
    : path.resolve(process.cwd(), options.file);

  try {
    await fs.access(targetFile);
  } catch {
    console.error(`Target file not found: ${targetFile}`);
    process.exitCode = 1;
    return;
  }

  let previousIssues = [];
  let previousSignature = null;
  let firstRun = true;

  process.on("SIGINT", () => {
    console.log("\nStopping live file review.");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.log("\nStopping live file review.");
    process.exit(0);
  });

  while (true) {
    try {
      const snapshot = await readFileSnapshot(targetFile);
      const signature = toSignature(snapshot);

      if (firstRun || signature !== previousSignature) {
        const result = await performReview({
          targetFile,
          applySafeFixes: options.applySafeFixes,
          previousIssues,
          isBaseline: firstRun,
        });

        previousIssues = result.issues;
        previousSignature = result.signature;
        firstRun = false;
      }
    } catch (error) {
      console.error(`review error: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (options.once) {
      break;
    }

    await sleep(options.intervalSeconds * 1000);
  }
}

await main();
