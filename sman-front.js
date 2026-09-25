// Shared frontend logic for the landing (/) and the Telegram Mini App (/app).
// The page must set window.FRONT_OPTS = { fetchPrefix, syncUrl } first,
// then call init() after this script loads.
const FETCH_PREFIX = (window.FRONT_OPTS && window.FRONT_OPTS.fetchPrefix) || "";
const SYNC_URL = !window.FRONT_OPTS || window.FRONT_OPTS.syncUrl !== false;


function esc(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const files = ["rom.sman","kernels.sman","recovery.sman","firmware.sman","ports.sman","tools.sman","guides.sman","channels.sman"];

const CATEGORY_LABELS = {
  "rom.sman": "ROMs",
  "kernels.sman": "Kernels",
  "recovery.sman": "Recovery",
  "firmware.sman": "Firmware",
  "ports.sman": "Ports",
  "tools.sman": "Tools",
  "guides.sman": "Guides",
  "channels.sman": "Channels",
};

function categoryLabel(f) {
  return CATEGORY_LABELS[f] || f;
}

function stripVersion(name) {
  let base = name;
  base = base.replace(/\s*[\(\[][^)\]]*[\)\]]\s*/g, " ");
  base = base.replace(/\bv?\d+(\.\d+){1,3}[a-z]?\b.*$/i, "");
  base = base.replace(/\b\d{4}[.\-]\d{1,2}[.\-]\d{1,2}\b.*$/, "");
  base = base.replace(/\b\d{8}\b.*$/, "");
  return base.trim() || (name || "").trim();
}

function compact(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const GENERIC_SUFFIXES = new Set(["project", "official", "unofficial", "edition", "release", "build",
  "plus", "lite", "pro", "max", "ultra", "turbo", "go", "ui", "legacy", "android"]);

function namesMatch(nameA, nameB) {
  const a = stripVersion(nameA);
  const b = stripVersion(nameB);
  const ca = compact(a);
  const cb = compact(b);
  if (!ca || !cb) return false;
  if (ca === cb) return true;
  const [shorter, longer] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  const shorterOriginal = ca.length <= cb.length ? a : b;
  const longerOriginal = ca.length <= cb.length ? b : a;
    if (longer.startsWith(shorter)) {
    const shorterWordCount = shorterOriginal.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).length;
    const longerWords = longerOriginal.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
    const extraWords = longerWords.slice(shorterWordCount);
    // A single extra trailing word is usually a codename/maintainer/variant
    // of the same family (Elysium, Tango, Uday, legacy, ...).
    if (extraWords.length === 1) return true;
    if (extraWords.length > 0 && extraWords.every(w => GENERIC_SUFFIXES.has(w))) return true;
    }
  return false;
}

function clusterEntries(entries) {
  const clusters = [];
  entries.forEach(e => {
    let best = null;
    for (const cluster of clusters) {
      if (namesMatch(e.name, cluster.representative)) { best = cluster; break; }
    }
    if (best) {
      best.entries.push(e);
    } else {
      clusters.push({ representative: e.name, entries: [e] });
    }
  });
  return clusters.map(c => c.entries);
}

function parseAndroid(e) {
  if (e.android !== undefined && e.android !== null && String(e.android).trim() !== "") {
    return String(e.android).trim();
  }
  const text = (e.note || "") + " " + (e.version || "");
  const m = text.match(/android\s+(\d+)/i) || text.match(/#a(\d\d?)\b/i);
  return m ? m[1] : "";
}

function parseGapps(e) {
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

function hasIssues(e) {
  if (e.issues !== undefined && e.issues !== null && String(e.issues).trim() !== "") {
    return true;
  }
  return ISSUE_RE.test(e.note || "");
}

function badgesHtml(items) {
  const arr = Array.isArray(items) ? items : [items];
  const versions = [...new Set(arr.map(parseAndroid).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const flavors = [...new Set(arr.map(parseGapps).filter(g => g === "gapps" || g === "vanilla"))];
  let s = "";
  if (versions.length) s += ` <span class="badge">A${versions.join("/A")}</span>`;
  if (flavors.length === 1) s += ` <span class="badge">${flavors[0] === "gapps" ? "GApps" : "Vanilla"}</span>`;
  else if (flavors.length > 1) s += ` <span class="badge">GApps·Vanilla</span>`;
  return s;
}

function issuesBadge(e) {
  return hasIssues(e) ? ` <span class="badge warn">issues</span>` : "";
}

const NEW_DAYS = 14;

function entryDateStr(e) {
  const m = (e.date || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function isNew(e) {
  const d = entryDateStr(e);
  if (!d) return false;
  const days = (Date.now() - new Date(d + "T00:00:00Z").getTime()) / 864e5;
  return days >= 0 && days <= NEW_DAYS;
}

function newBadge(e) {
  return isNew(e) ? ` <span class="badge new">NEW</span>` : "";
}

function groupMaxDate(items) {
  let max = "";
  (Array.isArray(items) ? items : [items]).forEach(e => {
    const d = entryDateStr(e);
    if (d && d > max) max = d;
  });
  return max;
}

function entryHtml(e, id) {
  const search = (e.name+" "+e.maintainer+" "+e.note).toLowerCase();
  return `<div class="entry" id="${id}" data-search="${esc(search)}" data-creator="${esc(e.maintainer||"")}" data-vendor="${esc(e.vendor||"")}" data-android="${esc(parseAndroid(e))}" data-gapps="${esc(parseGapps(e))}" data-issues="${hasIssues(e) ? "1" : ""}" data-date="${esc(entryDateStr(e))}">
    <b>${esc(e.name||"")}</b>${issuesBadge(e)}${newBadge(e)} ${esc(e.version||"")}
    <div class="meta">${esc(e.maintainer||"")} ${e.date?"| "+esc(e.date):""} ${e.vendor?"| "+esc(e.vendor):""} <button class="copybtn" data-copy="${id}" title="Copy link to this entry">#</button></div>
    <div>${esc(e.note||"")}</div>
    ${e.url ? `<a href="${esc(e.url)}" target="_blank">${esc(e.url)}</a>` : ""}
  </div>`;
}

function singleGroupHtml(f, e, id, ord) {
  const search = (e.name+" "+e.maintainer+" "+e.note).toLowerCase();
  return `<details class="group" data-ord="${ord}" data-maxdate="${esc(entryDateStr(e))}" data-category="${esc(f)}" data-search="${esc(search)}" data-creator="${esc(e.maintainer||"")}" data-vendor="${esc(e.vendor||"")}" data-android="${esc(parseAndroid(e))}" data-gapps="${esc(parseGapps(e))}" data-issues="${hasIssues(e) ? "1" : ""}">
    <summary>${esc(e.name||"")}${badgesHtml(e)}${newBadge(e)} <span class="count">(1 build)</span></summary>
    <div class="entries">${entryHtml(e, id)}</div>
  </details>`;
}

const allCreators = new Set();
const allVendors = new Set();
const allAndroids = new Set();
const allCategories = [];
const fileCounts = {};

async function load(){
  let html = "";
  let totalEntries = 0;
  for(const f of files){
    try {
      const text = await (await fetch(FETCH_PREFIX + f)).text();
      const {entries} = parseSman(text);
      totalEntries += entries.length;
      html += `<h2 id="cat-${f.replace(".sman", "")}">${categoryLabel(f)} (${entries.length})</h2>`;
      allCategories.push(f);
      fileCounts[f] = entries.length;

      const fbase = f.replace(".sman", "");
      let eidx = 0;
      let gidx = 0;
      const nextId = () => `e-${fbase}-${eidx++}`;

      if (f === "channels.sman" || f === "guides.sman") {
        entries.forEach(e => {
          if (e.maintainer) allCreators.add(e.maintainer);
          if (e.vendor) allVendors.add(e.vendor);
          const a = parseAndroid(e);
          if (a) allAndroids.add(a);
          html += singleGroupHtml(f, e, nextId(), gidx++);
        });
        continue;
      }

      entries.forEach(e => {
        if (e.maintainer) allCreators.add(e.maintainer);
        if (e.vendor) allVendors.add(e.vendor);
        const a = parseAndroid(e);
        if (a) allAndroids.add(a);
      });

      const clusters = clusterEntries(entries);

      clusters.forEach(groupEntries => {
        groupEntries.sort((a, b) => (b.date||"").localeCompare(a.date||""));

        if (groupEntries.length === 1) {
          html += singleGroupHtml(f, groupEntries[0], nextId(), gidx++);
          return;
        }

        const displayName = groupEntries[0].name || "";
        const search = groupEntries.map(e => (e.name+" "+e.maintainer+" "+e.note).toLowerCase()).join(" ");
        const creators = [...new Set(groupEntries.map(e => e.maintainer).filter(Boolean))].join(",");
        const vendors = [...new Set(groupEntries.map(e => e.vendor).filter(Boolean))].join(",");
        const ids = groupEntries.map(() => nextId());
        const newHere = groupEntries.some(isNew) ? ` <span class="badge new">NEW</span>` : "";
        html += `<details class="group" data-ord="${gidx++}" data-maxdate="${esc(groupMaxDate(groupEntries))}" data-category="${esc(f)}" data-search="${esc(search)}" data-creator="${esc(creators)}" data-vendor="${esc(vendors)}">
          <summary>${esc(displayName)}${badgesHtml(groupEntries)}${newHere} <span class="count">(${groupEntries.length} builds)</span></summary>
          <div class="entries">${groupEntries.map((en, i) => entryHtml(en, ids[i])).join("")}</div>
        </details>`;
      });
    } catch(err) {
      console.error("Error loading " + f, err);
    }
  }
  document.getElementById("out").innerHTML = html;
  populateFilters();
  const totalEl = document.getElementById("total-count");
  if (totalEl) totalEl.textContent = ` · ${totalEntries} builds`;
}

function normalizeCreator(name) {
  return (name || "").trim().toLowerCase();
}

// Typo-tolerant name match (Levenshtein on words): "linege" finds LineageOS.
function lev(a, b) {
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

function fuzzyNameHit(entry, q) {
  const qc = (q || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (qc.length < 4) return false;
  const limit = qc.length >= 6 ? 2 : 1;
  const b = entry.querySelector ? entry.querySelector("b") : null;
  const words = ((b ? b.textContent : "") || "").toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  return words.some(w => {
    if (lev(w, qc) <= limit) return true;
    // Compound words ("lineageos"): compare against prefixes too.
    for (let len = Math.max(4, qc.length - 2); len <= Math.min(w.length, qc.length + 2); len++) {
      if (lev(w.slice(0, len), qc) <= limit) return true;
    }
    return false;
  });
}

function splitCollaborators(name) {
  return (name || "")
    .split(/\s+(?:and|&|x)\s+/i)
    .map(s => s.trim())
    .filter(Boolean);
}

function populateFilters(){
  const creatorSelect = document.getElementById("filter-creator");
  const creatorDisplay = new Map();
  [...allCreators].forEach(c => {
    splitCollaborators(c).forEach(individual => {
      const key = normalizeCreator(individual);
      const existing = creatorDisplay.get(key);
      if (!existing || individual.length < existing.length) creatorDisplay.set(key, individual);
    });
  });
  [...creatorDisplay.entries()].sort((a,b) => a[1].localeCompare(b[1])).forEach(([key, display]) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = display;
    creatorSelect.appendChild(opt);
  });

  const vendorSelect = document.getElementById("filter-vendor");
  [...allVendors].sort().forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    vendorSelect.appendChild(opt);
  });

  const androidSelect = document.getElementById("filter-android");
  [...allAndroids].sort((a, b) => Number(a) - Number(b)).forEach(a => {
    const opt = document.createElement("option");
    opt.value = a;
    opt.textContent = "Android " + a;
    androidSelect.appendChild(opt);
  });
}

// Categories with the full filter set; kernels/recovery get vendor only;
// guides/channels get search+creator only.
const FULL_FILTER_CATS = ["rom.sman", "firmware.sman", "ports.sman", "tools.sman"];
const VENDOR_FILTER_CATS = [...FULL_FILTER_CATS, "kernels.sman", "recovery.sman"];

let activeCategory = null;

function buildTabs(){
  const nav = document.getElementById("tabs");
  allCategories.forEach(f => {
    const b = document.createElement("button");
    b.dataset.cat = f;
    b.textContent = `${categoryLabel(f)} (${fileCounts[f] || 0})`;
    b.addEventListener("click", () => selectCategory(f));
    nav.appendChild(b);
  });
}

function updateFilterVisibility(){
  const full = FULL_FILTER_CATS.includes(activeCategory);
  const withVendor = VENDOR_FILTER_CATS.includes(activeCategory);
  document.querySelector(".filters").style.display = activeCategory === "firmware.sman" ? "none" : "";
  document.getElementById("filter-vendor").style.display = withVendor ? "" : "none";
  ["filter-android", "filter-gapps"].forEach(id => {
    document.getElementById(id).style.display = full ? "" : "none";
  });
  document.getElementById("filter-noissues").closest("label").style.display = full ? "" : "none";
}

function selectCategory(f, pushUrl = true){
  activeCategory = f;
  document.querySelectorAll("#tabs button").forEach(b => {
    b.classList.toggle("active", b.dataset.cat === f);
  });
  document.querySelectorAll("#out > h2").forEach(h => {
    h.style.display = (h.id === "cat-" + f.replace(".sman", "")) ? "" : "none";
  });
  updateFilterVisibility();
  applyFilters();
  if (pushUrl) {
    const url = new URL(window.location);
    url.searchParams.set("category", f);
    history.replaceState(null, "", url);
  }
}

function entryMatches(entry, q, creator, vendor, android, gapps, noissues) {
  const matchesSearch = !q || (entry.dataset.search || "").includes(q) || fuzzyNameHit(entry, q);
  const entryCreators = (entry.dataset.creator || "").split(",").flatMap(splitCollaborators).map(normalizeCreator);
  const matchesCreator = !creator || entryCreators.includes(creator);
  const matchesVendor = !vendor || (entry.dataset.vendor || "").split(",").includes(vendor);
  const matchesAndroid = !android || (entry.dataset.android || "").split(",").includes(android);
  const matchesGapps = !gapps || (entry.dataset.gapps || "") === gapps || ((entry.dataset.gapps || "") === "mixed" && (gapps === "gapps" || gapps === "vanilla"));
  const matchesIssues = !noissues || (entry.dataset.issues || "") !== "1";
  return matchesSearch && matchesCreator && matchesVendor && matchesAndroid && matchesGapps && matchesIssues;
}

function applyFilters(){
  const q = document.getElementById("search").value.toLowerCase();
  const category = activeCategory;
  const creator = document.getElementById("filter-creator").value;
  const vendor = document.getElementById("filter-vendor").value;
  const android = document.getElementById("filter-android").value;
  const gapps = document.getElementById("filter-gapps").value;
  const noissues = document.getElementById("filter-noissues").checked;

  // Every entry lives inside a .group now, so filters apply per entry:
  // non-matching entries hide even inside a matching group.
  let visibleGroups = 0;
  document.querySelectorAll(".group").forEach(el => {
    if (category && el.dataset.category !== category) {
      el.style.display = "none";
      return;
    }
    let anyVisible = false;
    el.querySelectorAll(":scope > .entries > .entry").forEach(entry => {
      const visible = entryMatches(entry, q, creator, vendor, android, gapps, noissues);
      entry.style.display = visible ? "" : "none";
      if (visible) anyVisible = true;
    });
    el.style.display = anyVisible ? "" : "none";
    if (anyVisible) visibleGroups++;
    if (anyVisible && (q || creator || vendor || android || gapps || noissues) && el.tagName === "DETAILS") el.open = true;
  });

  const emptyEl = document.getElementById("empty");
  if (emptyEl) emptyEl.style.display = visibleGroups ? "none" : "";

  if (!SYNC_URL) return;
  const url = new URL(window.location);
  if (q) url.searchParams.set("q", document.getElementById("search").value); else url.searchParams.delete("q");
  if (category) url.searchParams.set("category", category); else url.searchParams.delete("category");
  if (creator) url.searchParams.set("creator", creator); else url.searchParams.delete("creator");
  if (vendor) url.searchParams.set("vendor", vendor); else url.searchParams.delete("vendor");
  if (android) url.searchParams.set("android", android); else url.searchParams.delete("android");
  if (gapps) url.searchParams.set("gapps", gapps); else url.searchParams.delete("gapps");
  if (noissues) url.searchParams.set("noissues", "1"); else url.searchParams.delete("noissues");
  history.replaceState(null, "", url);
}

document.getElementById("search").addEventListener("input", applyFilters);
document.getElementById("filter-creator").addEventListener("change", applyFilters);
document.getElementById("filter-vendor").addEventListener("change", applyFilters);
document.getElementById("filter-android").addEventListener("change", applyFilters);
document.getElementById("filter-gapps").addEventListener("change", applyFilters);
document.getElementById("filter-noissues").addEventListener("change", applyFilters);

const resetBtn = document.getElementById("reset-filters");
if (resetBtn) resetBtn.addEventListener("click", () => {
  document.getElementById("search").value = "";
  ["filter-creator", "filter-vendor", "filter-android", "filter-gapps"].forEach(id => {
    document.getElementById(id).value = "";
  });
  document.getElementById("filter-noissues").checked = false;
  applyFilters();
});

// "/" focuses search (desktop convenience, ignored while typing).
document.addEventListener("keydown", ev => {
  if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const t = ev.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
  ev.preventDefault();
  document.getElementById("search").focus();
});

document.addEventListener("click", ev => {
  const btn = ev.target.closest ? ev.target.closest("[data-copy]") : null;
  if (!btn) return;
  const link = window.location.origin + window.location.pathname + "#" + btn.dataset.copy;
  const done = () => {
    const old = btn.textContent;
    btn.textContent = "ok";
    setTimeout(() => { btn.textContent = old; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(link).then(done).catch(() => window.prompt("Copy link:", link));
  } else {
    window.prompt("Copy link:", link);
  }
});

function revealHashTarget(){
  const hash = (window.location.hash || "").replace(/^#/, "");
  if (!hash.startsWith("e-")) return false;
  const target = document.getElementById(hash);
  if (!target) return false;
  const group = target.closest(".group");
  if (group) {
    if (group.dataset.category && group.dataset.category !== activeCategory) {
      selectCategory(group.dataset.category, false);
    }
    group.style.display = "";
    group.open = true;
    target.style.display = "";
  }
  setTimeout(() => {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("flash");
    setTimeout(() => target.classList.remove("flash"), 2200);
  }, 100);
  return true;
}

async function init(){
  await load();
  buildTabs();
  const params = new URLSearchParams(window.location.search);
  const q = params.get("q");
  const category = params.get("category");
  const creator = params.get("creator");
  const vendor = params.get("vendor");
  const android = params.get("android");
  const gapps = params.get("gapps");
  const noissues = params.get("noissues");

  if (q) document.getElementById("search").value = q;
  if (creator) document.getElementById("filter-creator").value = creator;
  if (vendor) document.getElementById("filter-vendor").value = vendor;
  if (android) document.getElementById("filter-android").value = android;
  if (gapps) document.getElementById("filter-gapps").value = gapps;
  if (noissues) document.getElementById("filter-noissues").checked = true;

  selectCategory(allCategories.includes(category) ? category : "rom.sman", false);

  if (q || creator || vendor || android || gapps || noissues) {
    applyFilters();
    setTimeout(() => {
      const firstVisible = [...document.querySelectorAll(".entry, .group")].find(el => el.style.display !== "none");
      if (firstVisible) firstVisible.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 100);
  } else {
    revealHashTarget();
  }
}


