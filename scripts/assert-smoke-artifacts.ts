#!/usr/bin/env bun

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { updateCommentBody } from "../src/github/operations/comment-logic";

const FAKE_GITHUB_ACTIONS_TOKEN = ["ghs", "_", "a".repeat(36)].join("");
const FAKE_GITHUB_PAT = ["github", "pat", "test", "fake", "token"].join("_");
const FAKE_BEARER_VALUE = ["test", "bearer", "token"].join("-");
const FAKE_BEARER_HEADER = ["Bearer", FAKE_BEARER_VALUE].join(" ");
const FAKE_SECRETS = [
  "custom-model-secret-test-value",
  FAKE_GITHUB_ACTIONS_TOKEN,
  FAKE_BEARER_HEADER,
  FAKE_GITHUB_PAT,
];

interface WorkflowArtifact {
  name?: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(root: string): Promise<string[]> {
  if (!(await exists(root))) return [];

  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return walk(path);
      return [path];
    }),
  );

  return files.flat();
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

async function listRunArtifacts(
  repository: string,
  runId: string,
  token: string,
): Promise<WorkflowArtifact[]> {
  const artifacts: WorkflowArtifact[] = [];

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(
      `https://api.github.com/repos/${repository}/actions/runs/${runId}/artifacts?per_page=100&page=${page}`,
      {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
        },
      },
    );

    if (!response.ok) {
      throw new Error(`Failed to list artifacts: ${response.status}`);
    }

    const body = (await response.json()) as {
      artifacts?: WorkflowArtifact[];
    };
    const pageArtifacts = body.artifacts ?? [];
    artifacts.push(...pageArtifacts);

    if (pageArtifacts.length < 100) break;
  }

  return artifacts;
}

async function assertNoDebugArtifacts(tempDir: string) {
  const debugDir = join(tempDir, "droid-debug-artifacts");
  const rawFactoryDir = join(tempDir, ".factory");

  if (await exists(debugDir)) {
    throw new Error(
      `Expected no redacted debug artifact directory: ${debugDir}`,
    );
  }

  if (await exists(rawFactoryDir)) {
    throw new Error(
      `Expected no copied raw Factory directory: ${rawFactoryDir}`,
    );
  }

  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;

  if (!token || !repository || !runId) {
    if (process.env.GITHUB_ACTIONS) {
      throw new Error(
        "Missing GITHUB_TOKEN, GITHUB_REPOSITORY, or GITHUB_RUN_ID for artifact check",
      );
    }

    return;
  }

  const artifacts = await listRunArtifacts(repository, runId, token);
  const leakedArtifact = artifacts.find(
    (artifact) =>
      artifact.name?.startsWith("droid-debug-") ||
      artifact.name?.startsWith("droid-review-debug-"),
  );

  if (leakedArtifact?.name) {
    throw new Error(`Unexpected Droid debug artifact: ${leakedArtifact.name}`);
  }
}

async function assertRedactedBundle(root: string) {
  const expectedList = await readFile(
    join(
      import.meta.dir,
      "..",
      "test",
      "fixtures",
      "debug-artifacts",
      "expected-redacted-files.txt",
    ),
    "utf8",
  );
  const expectedFiles = expectedList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const files = await walk(root);
  const relativeFiles = new Set(
    files.map((file) => normalizePath(relative(root, file))),
  );

  for (const expectedFile of expectedFiles) {
    if (!relativeFiles.has(expectedFile)) {
      throw new Error(`Missing redacted debug artifact: ${expectedFile}`);
    }
  }

  const rawPaths = [
    "factory/settings.json",
    "factory/settings.local.json",
    "factory/mcp.json",
    "factory/cache",
    "factory/plugins",
    "factory/bin",
  ];

  for (const rawPath of rawPaths) {
    if (relativeFiles.has(rawPath) || (await exists(join(root, rawPath)))) {
      throw new Error(`Unexpected raw debug artifact path: ${rawPath}`);
    }
  }

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const fakeSecret of FAKE_SECRETS) {
      if (content.includes(fakeSecret)) {
        throw new Error(
          `Unredacted fake secret ${fakeSecret} found in ${file}`,
        );
      }
    }
  }
}

function assertNeutralHeader() {
  const result = updateCommentBody({
    currentBody: "Droid is working...\n\nGenerated body mentioning @octocat.",
    actionFailed: false,
    executionDetails: { duration_ms: 74000 },
    jobUrl: "https://github.com/owner/repo/actions/runs/1",
    triggerUsername: "octocat",
    mentionTriggerUser: false,
  });

  if (!result.includes("**Droid finished the task in 1m 14s**")) {
    throw new Error(`Neutral completion header missing:\n${result}`);
  }

  if (result.includes("Droid finished @octocat")) {
    throw new Error(
      `Completion header still mentions trigger user:\n${result}`,
    );
  }

  if (!result.includes("Generated body mentioning @octocat.")) {
    throw new Error(`Existing body mention was not preserved:\n${result}`);
  }
}

async function main() {
  const [mode, target] = process.argv.slice(2);

  if (mode === "no-debug") {
    if (!target) throw new Error("no-debug mode requires RUNNER_TEMP path");
    await assertNoDebugArtifacts(target);
    return;
  }

  if (mode === "redacted") {
    if (!target) throw new Error("redacted mode requires artifact directory");
    await assertRedactedBundle(target);
    return;
  }

  if (mode === "neutral-header") {
    assertNeutralHeader();
    return;
  }

  throw new Error(
    `Usage: assert-smoke-artifacts.ts <no-debug|redacted|neutral-header> [path]`,
  );
}

await main();
