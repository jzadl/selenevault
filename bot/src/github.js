function decodeBase64(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function githubFetch(env, path, options = {}) {
  const headers = {
    Authorization: "token " + env.GITHUB_TOKEN,
    "User-Agent": "svault-bot",
    Accept: "application/vnd.github+json",
    ...options.headers,
  };
  return fetch(env.GITHUB_API_BASE + path, { ...options, headers });
}

async function getFileContent(env, file) {
  const res = await githubFetch(env, "/contents/" + file + "?ref=main");
  if (!res.ok) {
    const body = await res.text();
    throw new Error("GitHub GET " + res.status + ": " + body.slice(0, 300));
  }
  const data = await res.json();
  return {
    content: decodeBase64(data.content),
    sha: data.sha,
  };
}

async function putFileContent(env, file, content, sha, commitMessage) {
  const res = await githubFetch(env, "/contents/" + file, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content: encodeBase64(content),
      sha,
      branch: "main",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error("GitHub PUT " + res.status + ": " + body.slice(0, 300));
  }
  return res.json();
}

export async function appendSmanEntry(env, file, block, commitMessage) {
  const { content, sha } = await getFileContent(env, file);
  const newContent = content.replace(/\s*$/, "") + "\n\n" + block + "\n";
  return putFileContent(env, file, newContent, sha, commitMessage);
}

export async function updateSmanEntry(env, file, oldBlock, newBlock, commitMessage) {
  const { content, sha } = await getFileContent(env, file);
  const newContent = content.replace(oldBlock, newBlock);
  if (newContent === content) {
    throw new Error("Entry not found in file content");
  }
  return putFileContent(env, file, newContent, sha, commitMessage);
}

export async function removeSmanEntry(env, file, oldBlock, commitMessage) {
  const { content, sha } = await getFileContent(env, file);
  const pattern = oldBlock + "\n";
  let newContent = content.replace(pattern, "");
  if (newContent === content) {
    newContent = content.replace(oldBlock, "");
  }
  if (newContent === content) {
    throw new Error("Entry not found in file content");
  }
  newContent = newContent.replace(/\n{3,}/g, "\n\n");
  return putFileContent(env, file, newContent, sha, commitMessage);
}

export async function createNotifyIssue(env, text) {
  const res = await githubFetch(env, "/issues", {
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

export function findEntryBlock(content, entryName, maintainer) {
  const blocks = content.split(/\n\n+/);
  for (const block of blocks) {
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    const maintMatch = block.match(/^maintainer:\s*(.+)$/m);
    if (nameMatch && maintMatch) {
      if (
        nameMatch[1].trim().toLowerCase() === entryName.trim().toLowerCase() &&
        maintMatch[1].trim().toLowerCase() === maintainer.trim().toLowerCase()
      ) {
        return block.trim();
      }
    }
  }
  return null;
}

export function findEntryBlocks(content, entryName) {
  const blocks = content.split(/\n\n+/);
  const matches = [];
  for (const block of blocks) {
    const nameMatch = block.match(/^name:\s*(.+)$/m);
    if (nameMatch && nameMatch[1].trim().toLowerCase().includes(entryName.trim().toLowerCase())) {
      matches.push(block.trim());
    }
  }
  return matches;
}
