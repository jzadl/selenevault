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

export async function appendSmanEntry(env, file, block, commitMessage) {
  const apiBase = env.GITHUB_API_BASE;
  const token = env.GITHUB_TOKEN;
  const headers = {
    Authorization: `token ${token}`,
    "User-Agent": "svault-bot",
    Accept: "application/vnd.github+json",
  };

  const getRes = await fetch(`${apiBase}/contents/${file}?ref=main`, { headers });
  if (!getRes.ok) {
    const body = await getRes.text();
    throw new Error(`GitHub GET ${getRes.status}: ${body.slice(0, 300)}`);
  }
  const getData = await getRes.json();
  const currentContent = decodeBase64(getData.content);
  const sha = getData.sha;

  const newContent = currentContent.replace(/\s*$/, "") + "\n\n" + block + "\n";

  const putRes = await fetch(`${apiBase}/contents/${file}`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: commitMessage,
      content: encodeBase64(newContent),
      sha,
      branch: "main",
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.text();
    throw new Error(`GitHub PUT ${putRes.status}: ${body.slice(0, 300)}`);
  }
  return putRes.json();
}

export async function createNotifyIssue(env, text) {
  const apiBase = env.GITHUB_API_BASE;
  const token = env.GITHUB_TOKEN;
  const res = await fetch(`${apiBase}/issues`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      "User-Agent": "svault-bot",
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title: "notify", body: text, labels: ["svault-notify"] }),
  });
  return res.json();
}
