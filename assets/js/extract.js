// CiteWarden — citation extractor
// Pulls every recognizable citation out of free text and normalizes it.
// Zero dependencies: runs in browser and node (vitest).

const RX = {
  doi: /10\.\d{4,9}\/[^\s"'<>()\u00A0]+/g,
  arxiv: /\barxiv\s*[:\s]*([0-9]{4}\.[0-9]{4,5})(v\d+)?/gi,
  pmid: /\bPMID\s*[:\s]*([0-9]{5,9})\b/g,
  cfr: /\b(\d{1,3})\s*C\.?\s*F\.?\s*R\.?\s*(?:§+\s*)?((?:\d+)(?:\.\d+)*)/g,
  usc: /\b(\d{1,2})\s*U\.?\s*S\.?\s*C\.?\s*(?:§+\s*)?((?:\d+)(?:\-\d+)?(?:\([a-z0-9]+\))*)/g,
  reporter: /\b(\d{1,4})\s+(U\.S\.|F\.3d|F\.2d|F\.|S\.\s?Ct\.|F\.\s?Supp\.(?:\s?2d|\s?3d)?)\s+(\d{1,5})\s*(?:\((\d{4})\))?/g,
  caseName: /\b([A-Z][A-Za-z.'\u2019-]+(?:[,\s]+(?:of|the|de|re|[A-Z])[A-Za-z.'\u2019-]*){0,4})\s+v(?:s)?\.\s+([A-Z][A-Za-z.'\u2019-]+(?:[,\s]+(?:of|the|de|re|[A-Z])[A-Za-z.'\u2019-]*){0,4})/g,
  ukAct: /\b([A-Z][A-Za-z'()&.-]+(?:\s+[A-Z][A-Za-z'()&.-]+){0,7})\s+(Act|Order|Regulations|Rules|Measure)\s+(\d{4})\b/g,
  euReg: /\bRegulation\s*\((EU|EC)\)\s*(\d{4})\/(\d{1,5})/g,
  euDirective: /\bDirective\s*(\d{2,4})\/(\d{1,3})\/(EC|EU)/g,
};

const REPORTER_META = {
  "U.S.": { first: 1, last: 605, era: [[1, 1754], [605, 2026]] },
  "F.3d": { first: 1, last: 200, era: [[1, 1992], [200, 2026]] },
  "F.2d": { first: 1, last: 999, era: [[1, 1924], [999, 1993]] },
  "F.": { first: 1, last: 200, era: [[1, 1880], [200, 1924]] },
  "S. Ct.": { first: 1, last: 250, era: [[1, 1882], [250, 2026]] },
  "F. Supp. 2d": { first: 1, last: 900, era: [[1, 1998], [900, 2014]] },
  "F. Supp. 3d": { first: 1, last: 700, era: [[1, 2013], [700, 2026]] },
};

export function extractCitations(text) {
  const found = [];
  const push = (c) => found.push(c);

  // DOIs — strip trailing punctuation that regex may swallow
  for (const m of matchAll(RX.doi, text)) {
    const raw = m[0].replace(/[.,;:]+$/, "");
    push({ type: "doi", raw, key: raw.toLowerCase(), index: m.index });
  }

  for (const m of matchAll(RX.arxiv, text)) {
    push({ type: "arxiv", raw: m[0].trim(), key: m[1] + (m[2] || ""), index: m.index, id: m[1] });
  }

  for (const m of matchAll(RX.pmid, text)) {
    push({ type: "pmid", raw: m[0].trim(), key: "pmid:" + m[1], index: m.index, id: m[1] });
  }

  for (const m of matchAll(RX.cfr, text)) {
    push({ type: "cfr", raw: m[0].trim(), key: `cfr:${m[1]}:${m[2]}`, index: m.index, title: m[1], section: m[2] });
  }

  for (const m of matchAll(RX.usc, text)) {
    const title = m[1];
    if (Number(title) >= 1 && Number(title) <= 54) {
      push({ type: "usc", raw: m[0].trim(), key: `usc:${title}:${m[2]}`, index: m.index, title, section: m[2] });
    }
  }

  for (const m of matchAll(RX.reporter, text)) {
    const reporter = m[2];
    push({
      type: "caseCite", raw: m[0].trim(), key: `case:${m[1]}:${reporter}:${m[3]}:${m[4] || ""}`,
      index: m.index, volume: Number(m[1]), reporter, page: Number(m[3]), year: m[4] ? Number(m[4]) : null,
    });
  }

  // Case names — skip ones that overlap a reporter cite (Roe v. Wade, 410 U.S. 113)
  const LEAD_CONTEXT = /^(?:in|see|but|and|accord|cf|also|citing|quoted|similarly|further|moreover|eg|e\.g)[.,]?\s+/i;
  const caseSpans = [];
  for (const m of matchAll(RX.caseName, text)) {
    let claimant = m[1].trim(), defendant = m[2].trim();
    let start = m.index;
    // The greedy continuation can swallow leading context ("In Varghese v. …",
    // "Similarly, Shaboon v. …"); peel it off and re-anchor the raw span at
    // the real party name. "In re …" captions are legitimate and stay intact.
    if (
      LEAD_CONTEXT.test(claimant) &&
      !/^in\s+re\b/i.test(claimant)
    ) {
      const stripped = claimant.replace(LEAD_CONTEXT, "").trim();
      if (stripped && !STOP_WORDS_CASES.has(stripped.split(/\s+/)[0].toLowerCase())) {
        const idx = m[0].indexOf(stripped);
        start = idx >= 0 ? m.index + idx : m.index;
        claimant = stripped;
      }
    }
    if (STOP_WORDS_CASES.has(claimant.toLowerCase()) || STOP_WORDS_CASES.has(defendant.toLowerCase())) continue;
    caseSpans.push([start, m.index + m[0].length]);
    push({
      type: "caseName", raw: `${claimant} v. ${defendant}`, key: `name:${claimant}:v:${defendant}`.toLowerCase(),
      index: start, claimant, defendant,
    });
  }

  for (const m of matchAll(RX.ukAct, text)) {
    const name = m[1].trim();
    if (UK_ACT_FALSE_POSITIVES.has(name.toLowerCase())) continue;
    push({ type: "ukAct", raw: m[0].trim(), key: `uk:${name}:${m[3]}`.toLowerCase(), index: m.index, name, year: Number(m[3]), kind: m[2] });
  }

  for (const m of matchAll(RX.euReg, text)) {
    push({ type: "euReg", raw: m[0].trim(), key: `eu:reg:${m[1]}:${m[2]}/${m[3]}`.toLowerCase(), index: m.index, union: m[1], year: Number(m[2]), num: m[3] });
  }

  for (const m of matchAll(RX.euDirective, text)) {
    push({ type: "euDirective", raw: m[0].trim(), key: `eu:dir:${m[3]}:${m[1]}/${m[2]}`.toLowerCase(), index: m.index, year: m[1], num: m[2], union: m[3] });
  }

  // dedupe identical keys, keep first
  const seen = new Set();
  const out = [];
  for (const c of found) {
    if (c.type === "caseName" && caseSpans.some(([a, b]) => c.index >= a - 2 && c.index < b)) {
      // still include, but reporter cites in same span are the stronger signal
    }
    if (seen.has(c.type + "|" + c.key)) continue;
    seen.add(c.type + "|" + c.key);
    out.push(c);
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

// Reporter-era plausibility: does the stated year match the reporter volume era?
export function reporterEraCheck(cite) {
  const meta = REPORTER_META[cite.reporter];
  if (!meta) return { plausible: true, note: "unknown reporter" };
  const vol = cite.volume, yr = cite.year;
  if (vol < meta.first || vol > meta.last) {
    return { plausible: false, reason: `${cite.reporter} volume ${vol} is outside the real range (${meta.first}\u2013${meta.last}).` };
  }
  if (yr == null) return { plausible: true };
  if (yr < 1754 || yr > CURRENT_YEAR) return { plausible: false, reason: `Decision year ${yr} is impossible.` };
  const eraStart = eraYearForVolume(meta.era, vol);
  if (yr < eraStart - 3) {
    return { plausible: false, reason: `${cite.reporter} vol. ${vol} did not exist in ${yr} (that volume began ~${eraStart}).` };
  }
  return { plausible: true };
}

function eraYearForVolume(era, vol) {
  // era = [[firstVol, startYear], [lastVol, endYear]] — linear interpolation of real publication years
  const [v0, y0] = era[0], [v1, y1] = era[1];
  const t = (vol - v0) / Math.max(1, v1 - v0);
  return Math.round(y0 + t * (y1 - y0));
}

function matchAll(rx, text) {
  const out = [];
  const r = new RegExp(rx.source, rx.flags.includes("g") ? rx.flags : rx.flags + "g");
  let m;
  while ((m = r.exec(text)) !== null) {
    out.push(m);
    if (m.index === r.lastIndex) r.lastIndex++;
  }
  return out;
}

const CURRENT_YEAR = 2026;

const STOP_WORDS_CASES = new Set([
  "the", "and", "in", "on", "see", "cf", "id", "citing", "quoted", "accord", "compare",
  "but", "nor", "for", "per", "ante", "supra", "e.g", "i.e", "also",
]);

const UK_ACT_FALSE_POSITIVES = new Set([
  "affordable care act", "dream act", "freedom of information act", "usa freedom act",
]);

export const REPORTER_BOUNDS = REPORTER_META;
