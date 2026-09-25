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
