// Local-filesystem replacement for the GitHub Contents API.
// Reads/writes .sman files directly in REPO_ROOT and commits via git.
// createNotifyIssue still uses the GitHub Issues API (feeds notify-telegram.yml).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function repoRoot(env) {
  return env.REPO_ROOT || "/home/main/projects/selenevault";
}

function gitEnv(env) {
  return {
    ...process.env,
    GITHUB_TOKEN: env.GITHUB_TOKEN || process.env.GITHUB_TOKEN || "",
    GIT_ASKPASS: path.join(repoRoot(env), "bot", ".git-askpass.sh"),
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function git(env, args) {
  return execFileAsync("git", ["-C", repoRoot(env), ...args], { env: gitEnv(env), timeout: 60000 });
}

async function commitAndPush(env, files, message) {
  await git(env, ["-c", "user.name=svault-bot", "-c", "user.email=svault-bot@local",
    "add", "--", ...files]);
  const { stdout: status } = await git(env, ["status", "--porcelain", "--", ...files]);
  if (!status.trim()) return { pushed: false }; // nothing changed
  await git(env, ["-c", "user.name=svault-bot", "-c", "user.email=svault-bot@local",
    "commit", "-m", message, "--", ...files]);
  await git(env, ["pull", "--ff-only", "origin", "main"]).catch(() => {});
  await git(env, ["push", "origin", "main"]);
  return { pushed: true };
}

export async function getFileContent(env, file) {
  const content = await readFile(path.join(repoRoot(env), file), "utf-8");
  return { content, sha: null };
}

export async function appendSmanEntry(env, file, block, commitMessage) {
  const { content } = await getFileContent(env, file);
  const newContent = content.replace(/\s*$/, "") + "\n\n" + block + "\n";
  await writeFile(path.join(repoRoot(env), file), newContent, "utf-8");
  return commitAndPush(env, [file], commitMessage);
}

export async function updateSmanEntry(env, file, oldBlock, newBlock, commitMessage) {
  const { content } = await getFileContent(env, file);
  const newContent = content.replace(oldBlock, newBlock);
  if (newContent === content) {
    throw new Error("Entry not found in file content");
  }
  await writeFile(path.join(repoRoot(env), file), newContent, "utf-8");
  return commitAndPush(env, [file], commitMessage);
}

export async function removeSmanEntry(env, file, oldBlock, commitMessage) {
  const { content } = await getFileContent(env, file);
  const pattern = oldBlock + "\n";
  let newContent = content.replace(pattern, "");
  if (newContent === content) {
    newContent = content.replace(oldBlock, "");
  }
  if (newContent === content) {
    throw new Error("Entry not found in file content");
  }
  newContent = newContent.replace(/\n{3,}/g, "\n\n");
  await writeFile(path.join(repoRoot(env), file), newContent, "utf-8");
  return commitAndPush(env, [file], commitMessage);
}

// Recent "ADD: <name> by <creator> to <file>" commit subjects (for /slatest).
export async function getRecentAdds(env, limit = 100) {
  try {
    const { stdout } = await git(env, ["log", `--max-count=${limit}`, "--format=%s"]);
    return stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function githubFetch(env, apiBase, apiPath, options = {}) {
  const headers = {
    Authorization: "token " + env.GITHUB_TOKEN,
    "User-Agent": "svault-bot",
    Accept: "application/vnd.github+json",
    ...options.headers,
  };
  return fetch(apiBase + apiPath, { ...options, headers });
}

export async function createNotifyIssue(env, text) {
  const apiBase = env.GITHUB_API_BASE || "https://api.github.com/repos/jzadl/selenevault";
  const res = await githubFetch(env, apiBase, "/issues", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "notify", body: text, labels: ["svault-notify"] }),
  });
  return res.json();
}

export function entryToRawBlock(entry, fields) {
  const lines = [];
  for (const field of fields) {
    const value = entry[field];
    if (value === null || value === undefined || value === "") continue;
    lines.push(field + ": " + value);
  }
  return lines.join("\n");
}
