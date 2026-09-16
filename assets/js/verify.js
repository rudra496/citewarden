// CiteWarden — live verification layer.
// Browser-side calls to open, CORS-enabled public APIs. Every endpoint here was
// verified to return access-control-allow-origin:* at build time (2026-09-16):
//   - api.crossref.org  (DOIs)
//   - api.openalex.org  (works incl. arXiv-mirror DOIs 10.48550/arxiv.*)
//   - eutils.ncbi.nlm.nih.gov (PubMed)
//   - www.ecfr.gov      (US Code of Federal Regulations)
//   - en.wikipedia.org  (with &origin=* — UK/EU act existence)

const TIMEOUT_MS = 12000;

async function fetchJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, status: r.status, data: await r.json() };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  } finally {
    clearTimeout(t);
  }
}

// --- DOI → Crossref (primary), OpenAlex (fallback) ---
export async function verifyDoi(doi) {
  const cr = await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
  if (cr.ok && cr.data?.status === "ok") {
    const m = cr.data.message;
    const year = m.issued?.["date-parts"]?.[0]?.[0];
    return {
      verdict: "green",
      reason: "Registered with Crossref (publisher-deposited metadata).",
      evidence: { title: m.title?.[0], year, container: m["container-title"]?.[0], url: m.URL || `https://doi.org/${doi}` },
    };
  }
  const oa = await fetchJson(`https://api.openalex.org/works/doi:${doi}`);
  if (oa.ok && oa.data?.id) {
    return {
      verdict: "green",
      reason: "Indexed in OpenAlex (scholarly record).",
      evidence: { title: oa.data.title, year: oa.data.publication_year, url: `https://doi.org/${doi}` },
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
    reason: "No OpenAlex record for this arXiv ID (very new submissions may lag); format is valid.",
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

// --- CFR section → eCFR structure API ---
export async function verifyCfr(title, section) {
  const top = section.split(".")[0];
  const date = "current";
  // existence check: the versioner structure endpoint for the title contains part lists
  const r = await fetchJson(
    `https://www.ecfr.gov/api/versioner/v1/structure/${date}/title-${title}.json?level=part`
  );
  if (r.ok && r.data?.structure) {
    const flat = JSON.stringify(r.data.structure);
    const partRe = new RegExp(`"type":"part"[^}]*?"identifier":"${top}"`);
    if (partRe.test(flat)) {
      return {
        verdict: "green",
        reason: `CFR title ${title} part ${top} exists in the current eCFR (official gov text).`,
        evidence: { url: `https://www.ecfr.gov/current/title-${title}/part-${top}` },
      };
    }
    return {
      verdict: "red",
      reason: `CFR title ${title} exists but has no part ${top} in the current edition.`,
    };
  }
  if (r.status === 404) {
    return { verdict: "red", reason: `CFR title ${title} does not exist in the current eCFR.` };
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
