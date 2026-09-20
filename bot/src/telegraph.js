const TELEGRAPH_API = "https://api.telegra.ph";

let cachedAccessToken = null;

async function getAccessToken(env) {
  if (cachedAccessToken) return cachedAccessToken;
  if (env.TELEGRAPH_ACCESS_TOKEN) {
    cachedAccessToken = env.TELEGRAPH_ACCESS_TOKEN;
    return cachedAccessToken;
  }

  const res = await fetch(`${TELEGRAPH_API}/createAccount`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      short_name: "svault",
      author_name: "svault",
      author_url: "https://svault.jzadl.xyz",
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegraph createAccount failed: ${JSON.stringify(data)}`);
  cachedAccessToken = data.result.access_token;
  return cachedAccessToken;
}

function isUrl(line) {
  return /^https?:\/\/\S+$/.test(line.trim());
}

function textToNodes(plainText) {
  const paragraphs = plainText.split("\n\n").map((p) => p.trim()).filter(Boolean);
  return paragraphs.map((p) => {
    const linesInParagraph = p.split("\n");
    const children = [];
    linesInParagraph.forEach((line, i) => {
      if (i > 0) children.push({ tag: "br" });
      if (isUrl(line)) {
        children.push({ tag: "a", attrs: { href: line.trim() }, children: [line.trim()] });
      } else {
        children.push(line);
      }
    });
    return { tag: "p", children };
  });
}

export async function publishTelegraphPage(env, title, plainText) {
  const accessToken = await getAccessToken(env);
  const content = textToNodes(plainText);

  const res = await fetch(`${TELEGRAPH_API}/createPage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      access_token: accessToken,
      title: title.slice(0, 256),
      author_name: "svault",
      content,
      return_content: false,
    }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegraph createPage failed: ${JSON.stringify(data)}`);
  return data.result.url;
}
