// Shared entry metadata + field:value filters.
// Explicit .sman fields (android/gapps/issues) win; note-based heuristics
// are the fallback. Mirrors the frontend logic in index.html/app/index.html.

export function entryAndroid(e) {
  if (e.android !== undefined && e.android !== null && String(e.android).trim() !== "") {
    return String(e.android).trim();
  }
  const text = (e.note || "") + " " + (e.version || "");
  const m = text.match(/android\s+(\d+)/i) || text.match(/#a(\d\d?)\b/i);
  return m ? m[1] : "";
}

export function entryGapps(e) {
  if (e.gapps !== undefined && e.gapps !== null && String(e.gapps).trim() !== "") {
    return String(e.gapps).trim().toLowerCase();
  }
  const t = ((e.note || "") + " " + (e.version || "") + " " + (e.url || "")).toLowerCase();
  const mentionsGapps = /(gapps|google services|google-services|play ?store|\bgms\b)/.test(t)
    && !/no[\s-]?gapps|without gapps/.test(t);
  if (/\bvanilla\b/.test(t)) return mentionsGapps ? "mixed" : "vanilla";
  return mentionsGapps ? "gapps" : "unknown";
}

const ISSUE_RE = /\bbug\s*:|known bugs?|known issues?|\bbroken\b|\blag\w*\b|\bcrash\w*\b|doesn'?t (pass|work)|incompatible\b/i;

export function entryHasIssues(e) {
  if (e.issues !== undefined && e.issues !== null && String(e.issues).trim() !== "") {
    return true;
  }
  return ISSUE_RE.test(e.note || "");
}

export const FILTER_KEYS = ["by", "vendor", "date", "android", "gapps"];

// Splits "rom by:hasan android:14 lineage" into { category, filters, query }.
// Category is only consumed when it is the very first token.
export function parseSearchArgs(arg, categoryFiles) {
  const tokens = String(arg || "").trim().split(/\s+/).filter(Boolean);
  let category = null;
  let rest = tokens;
  if (rest.length && categoryFiles[rest[0].toLowerCase()]) {
    category = rest[0].toLowerCase();
    rest = rest.slice(1);
  }
  const filters = {};
  const queryParts = [];
  for (const tok of rest) {
    const m = tok.match(/^([a-zA-Z]+):(\S+)$/);
    if (m && FILTER_KEYS.includes(m[1].toLowerCase())) {
      filters[m[1].toLowerCase()] = m[2].toLowerCase();
    } else {
      queryParts.push(tok);
    }
  }
  return { category, filters, query: queryParts.join(" ") };
}

export function matchesFilters(entry, filters) {
  if (filters.by && !(entry.maintainer || "").toLowerCase().includes(filters.by)) return false;
  if (filters.vendor && (entry.vendor || "").toLowerCase() !== filters.vendor) return false;
  if (filters.date && !(entry.date || "").startsWith(filters.date)) return false;
  if (filters.android && entryAndroid(entry) !== filters.android) return false;
  if (filters.gapps) {
    const g = entryGapps(entry);
    if (g === "mixed") {
      if (filters.gapps !== "gapps" && filters.gapps !== "vanilla") return false;
    } else if (g !== filters.gapps) return false;
  }
  return true;
}

export function filtersSummary(filters) {
  return Object.entries(filters).map(([k, v]) => `${k}:${v}`).join(" ");
}

// Typo-tolerant name match (Levenshtein on words): "linege" finds LineageOS.
export function lev(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (!la) return lb;
  if (!lb) return la;
  let prev = [];
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[lb];
}

export function fuzzyNameHit(name, query) {
  const qc = (query || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (qc.length < 4) return false;
  const limit = qc.length >= 6 ? 2 : 1;
  const words = (name || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  return words.some((w) => {
    if (lev(w, qc) <= limit) return true;
    // Compound words ("lineageos"): compare against prefixes too.
    for (let len = Math.max(4, qc.length - 2); len <= Math.min(w.length, qc.length + 2); len++) {
      if (lev(w.slice(0, len), qc) <= limit) return true;
    }
    return false;
  });
}
