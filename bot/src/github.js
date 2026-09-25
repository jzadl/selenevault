// Local-filesystem .sman storage: reads/writes files directly in REPO_ROOT
// and commits via git (auth via gh CLI).

import { readFile, writeFile, mkdir } from "node:fs/promises";
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
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function git(env, args) {
  // Auth via gh CLI (logged in as a user with repo+workflow scopes).
  // Absolute path: systemd services have a minimal PATH.
  const helper = "/usr/bin/gh auth git-credential";
  return execFileAsync("git",
    ["-C", repoRoot(env), "-c", "credential.helper=", "-c", `credential.helper=${helper}`, ...args],
    { env: gitEnv(env), timeout: 60000 });
}

async function commitAndPush(env, files, message) {
  await git(env, ["-c", "user.name=svault-bot", "-c", "user.email=svault-bot@local",
    "add", "--", ...files]);
  const { stdout: status } = await git(env, ["status", "--porcelain", "--", ...files]);
  if (!status.trim()) return { pushed: false }; // nothing changed
  await git(env, ["-c", "user.name=svault-bot", "-c", "user.email=svault-bot@local",
    "commit", "-m", message, "--", ...files]);
  // Rebase onto remote first: plain push fails if origin moved meanwhile.
  try {
    await git(env, ["pull", "--rebase", "origin", "main"]);
  } catch (err) {
    try {
      await git(env, ["rebase", "--abort"]);
    } catch {}
    throw new Error("could not sync with origin, please retry (" + gitErrTail(err) + ")");
  }
  try {
    await git(env, ["push", "origin", "main"]);
  } catch (err) {
    throw new Error("git push failed (" + gitErrTail(err) + ")");
  }
  return { pushed: true };
}

function gitErrTail(err) {
  const out = String((err && err.stderr) || (err && err.message) || err || "").trim();
  return out.slice(-200) || "unknown git error";
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
  // Trash backup: removed blocks accumulate in trash/<file>, same commit.
  const trashFile = "trash/" + file;
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  let trash = "";
  try {
    trash = await readFile(path.join(repoRoot(env), trashFile), "utf-8");
  } catch {}
  trash = trash.replace(/\s*$/, "") + "\n\n# removed " + stamp + "\n" + oldBlock.trim() + "\n";
  await mkdir(path.join(repoRoot(env), "trash"), { recursive: true });
  await writeFile(path.join(repoRoot(env), trashFile), trash, "utf-8");
  return commitAndPush(env, [file, trashFile], commitMessage);
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

export function entryToRawBlock(entry, fields) {
  const lines = [];
  for (const field of fields) {
    const value = entry[field];
    if (value === null || value === undefined || value === "") continue;
    lines.push(field + ": " + value);
  }
  return lines.join("\n");
}
