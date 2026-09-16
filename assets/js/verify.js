// CiteWarden — live verification layer.
// Browser-side calls to open, CORS-enabled public APIs. Every endpoint here was
// verified to return access-control-allow-origin:* at build time (2026-09-16):
//   - api.crossref.org  (DOIs)
//   - api.openalex.org  (works incl. arXiv-mirror DOIs 10.48550/arxiv.*)
//   - eutils.ncbi.nlm.nih.gov (PubMed)
//   - www.ecfr.gov      (US Code of Federal Regulations)
//   - en.wikipedia.org  (with &origin=* — UK/EU act existence)

const TIMEOUT_MS = 12000;

async function fetchJson(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", ...headers } });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, status: r.status, data: await r.json() };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  } finally {
    clearTimeout(t);
  }
}

function abstractFromOpenAlex(w) {
  if (!w?.abstract_inverted_index) return null;
  const pos = new Map();
  for (const [word, idxs] of Object.entries(w.abstract_inverted_index)) {
    for (const i of idxs) pos.set(i, word);
  }
  const words = [...pos.entries()].sort((a, b) => a[0] - b[0]).map(([, wd]) => wd);
  const s = words.join(" ");
  return s.length > 320 ? s.slice(0, 317) + "…" : s;
}

// --- DOI → Crossref (primary), OpenAlex (fallback) ---
export async function verifyDoi(doi) {
  const cr = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (cr.ok && cr.data?.status === "ok") {
    const m = cr.data.message;
    const year = m.issued?.["date-parts"]?.[0]?.[0];
    const abstract = m.abstract ? String(m.abstract).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 320) : null;
    return {
      verdict: "green",
      reason: "Registered with Crossref (publisher-deposited metadata).",
      evidence: { title: m.title?.[0], year, container: m["container-title"]?.[0], url: m.URL || `https://doi.org/${doi}`, abstract },
    };
  }
  const oa = await fetchJson(`https://api.openalex.org/works/doi:${doi}`);
  if (oa.ok && oa.data?.id) {
    return {
      verdict: "green",
      reason: "Indexed in OpenAlex (scholarly record).",
      evidence: { title: oa.data.title, year: oa.data.publication_year, url: `https://doi.org/${doi}`, abstract: abstractFromOpenAlex(oa.data) },
    };
  }
  if (cr.status === 404 && oa.status === 404) {
    return {
      verdict: "red",
      reason: "Not registered with Crossref and absent from OpenAlex — the DOI does not resolve to any real publication.",
    };
  }
  return { verdict: "amber", reason: "Verification service unreachable; format is valid." };
}

// --- arXiv ID → OpenAlex DOI mirror (arXiv assigns 10.48550/arxiv.*) ---
export async function verifyArxiv(id) {
  const oa = await fetchJson(`https://api.openalex.org/works/doi:10.48550/arxiv.${id}`);
  if (oa.ok && oa.data?.id) {
    return {
      verdict: "green",
      reason: "Matches an arXiv paper via its registered DOI (OpenAlex).",
      evidence: { title: oa.data.title, year: oa.data.publication_year, url: `https://arxiv.org/abs/${id}` },
    };
  }
  return {
    verdict: "amber",
    reason:
      "No OpenAlex record for this arXiv ID; arXiv's own API lacks browser CORS so a live pull is not possible offline. Verify manually:",
    evidence: { url: `https://arxiv.org/abs/${id}` },
  };
}

// --- PMID → PubMed E-utilities ---
export async function verifyPmid(id) {
  const r = await fetchJson(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${id}&retmode=json&tool=citewarden`
  );
  const rec = r.ok && r.data?.result?.[String(id)];
  if (rec && rec.title) {
    return {
      verdict: "green",
      reason: "Exists in PubMed (NLM).",
      evidence: { title: rec.title, year: rec.pubdate, url: `https://pubmed.ncbi.nlm.nih.gov/${id}/` },
    };
  }
  if (r.ok) return { verdict: "red", reason: "PubMed has no record of this PMID." };
  return { verdict: "amber", reason: "PubMed unreachable; format is valid." };
}

// --- CFR section → eCFR versioner API ---
// Root of the structure payload IS the tree node ({type, identifier, children}).
function structureHasPart(node, ident) {
  if (Array.isArray(node)) return node.some((n) => structureHasPart(n, ident));
  if (!node || typeof node !== "object") return false;
  if (node.type === "part" && String(node.identifier) === ident) return true;
  return Array.isArray(node.children) && node.children.some((n) => structureHasPart(n, ident));
}

const cfrDateCache = null;

export async function verifyCfr(title, section) {
  const t = Number(title);
  if (!(t >= 1 && t <= 54)) {
    return { verdict: "red", reason: `CFR title ${title} does not exist (titles run 1–54).` };
  }
  if (!/^\d+(\.\d+)*$/.test(section)) {
    return { verdict: "red", reason: `CFR section "${section}" is malformed.` };
  }
  // 1) resolve the title's latest coverage date
  const titles = await fetchJson("https://www.ecfr.gov/api/versioner/v1/titles.json");
  let date = null;
  if (titles.ok && Array.isArray(titles.data?.titles)) {
    const row = titles.data.titles.find((x) => Number(x.number) === t);
    if (row?.up_to_date_as_of) date = row.up_to_date_as_of;
    if (row?.reserved) {
      return { verdict: "red", reason: `CFR title ${title} is reserved (does not exist).` };
    }
  }
  if (!date) return { verdict: "amber", reason: "eCFR unreachable; format is valid." };
  // 2) walk the structure tree for the part
  const r = await fetchJson(`https://www.ecfr.gov/api/versioner/v1/structure/${date}/title-${t}.json`);
  if (r.ok && r.data) {
    const top = section.split(".")[0];
    if (structureHasPart(r.data, top)) {
      return {
        verdict: "green",
        reason: `CFR title ${t} part ${top} exists in the official eCFR (current as of ${date}).`,
        evidence: { url: `https://www.ecfr.gov/current/title-${t}/part-${top}` },
      };
    }
    return {
      verdict: "red",
      reason: `CFR title ${t} exists but has no part ${top} in the official edition of ${date}.`,
    };
  }
  if (r.status === 404) {
    return { verdict: "red", reason: `CFR title ${t} does not exist in the eCFR.` };
  }
  return { verdict: "amber", reason: "eCFR unreachable; format is valid." };
}

// --- UK/EU act existence via Wikipedia (origin=* enables CORS) ---
export async function verifyUKAct(name, year, wikiUrl) {
  const title = `${name} ${year}`;
  const r = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&titles=${encodeURIComponent(title)}`
  );
  if (r.ok && r.data?.query) {
    const pages = Object.values(r.data.query.pages);
    if (pages.length && !pages[0].missing) {
      return {
        verdict: "green",
        reason: "Encyclopedic record confirms this act exists.",
        evidence: { url: wikiUrl },
      };
    }
    return { verdict: "red", reason: `No record found for "${title}".` };
  }
  return { verdict: "amber", reason: "Lookup unreachable; format is valid." };
}

// --- Plain-language explanation for verified cases (live encyclopedic summary) ---
export async function fetchPlainSummary(articleTitle) {
  const r = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(articleTitle)}`
  );
  if (r.ok && r.data?.query) {
    const pages = Object.values(r.data.query.pages);
    const extract = pages[0]?.extract;
    if (extract && extract.length > 60) {
      const s = extract.replace(/\s+/g, " ").trim();
      return s.length > 380 ? s.slice(0, 377) + "…" : s;
    }
  }
  return null;
}

// --- CourtListener live case lookup (optional free token) ---
// The citation-lookup endpoint resolves ANY reporter cite to its real case.
// Without a token the endpoint 401s; callers fall back to forensics + DB.
export async function verifyCaseCiteLive(cite, token) {
  if (!token) return null;
  const r = await fetchJson(
    `https://www.courtlistener.com/api/rest/v4/citation-lookup/?citation=${encodeURIComponent(cite)}`,
    { Authorization: `Token ${token}` }
  );
  if (r.ok && Array.isArray(r.data) && r.data.length) {
    const m = r.data[0];
    const meta = m.cite || m.meta || {};
    const name = meta.caseName || m.caseName || "";
    const year = meta.decisionYear || (meta.decisionDate ? String(meta.decisionDate).slice(0, 4) : undefined);
    if (name) {
      return {
        verdict: "green",
        reason: "Resolved live in the CourtListener case-law database (free.law).",
        evidence: {
          title: name,
          year,
          url: meta.docketId ? `https://www.courtlistener.com/docket/${meta.docketId}/` : "https://www.courtlistener.com/",
        },
        liveYear: year ? Number(year) : undefined,
      };
    }
  }
  if (r.ok && Array.isArray(r.data) && r.data.length === 0) {
    return {
      verdict: "red",
      reason: "CourtListener's live database contains no such reporter citation.",
      evidence: { url: "https://www.courtlistener.com/" },
    };
  }
  return null; // unreachable or token invalid → fall back silently
}

export async function verifyAll(citations, helpers, concurrency = 4) {
  const results = new Map();
  let i = 0;
  async function worker() {
    while (i < citations.length) {
      const c = citations[i++];
      results.set(c.type + "|" + c.key, await helpers.verifyOne(c));
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
