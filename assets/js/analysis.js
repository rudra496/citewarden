// CiteWarden — analysis orchestrator.
// Combines extraction → forensic checks → landmark DB → live verification
// into one per-citation verdict plus an overall integrity score.

import { extractCitations } from "./extract.js";
import {
  checkCaseCite, checkCaseName, checkUsc, checkCfr, checkEuReg, textForensics,
} from "./patterns.js";
import {
  findLandmarkByCite, findLandmarkByName, findUKAct, findEUAct,
} from "./landmark.js";
import { verifyDoi, verifyArxiv, verifyPmid, verifyCfr, verifyUKAct, verifyCaseCiteLive } from "./verify.js";

// Optional CourtListener token (live case-law for ALL reporter cites).
// Stored in localStorage by the UI; when absent, offline layers decide.
let courtListenerToken = null;
export function setCourtListenerToken(t) {
  courtListenerToken = (t || "").trim() || null;
}
export function getCourtListenerToken() {
  return courtListenerToken;
}

async function verifyOne(c) {
  switch (c.type) {
    case "doi":
      return verifyDoi(c.raw);
    case "arxiv":
      return verifyArxiv(c.id);
    case "pmid":
      return verifyPmid(c.id);
    case "cfr":
      return verifyCfr(c.title, c.section);
    case "ukAct": {
      const known = findUKAct(c.name, c.year, c.kind);
      if (known) return verifyUKAct(c.name, c.year, known.url);
      return { verdict: "amber", reason: "Well-formed act citation; not in the verified statute list." };
    }
    case "caseCite": {
      const hit = findLandmarkByCite(c.volume, c.page);
      if (hit) {
        const yearOk = c.year == null || Math.abs(c.year - hit.year) <= 1;
        return yearOk
          ? { verdict: "green", reason: "Exact match in the verified landmark database (464 cases, build-time sourced).", evidence: { title: hit.name, year: hit.year } }
          : { verdict: "red", reason: `Volume/page belong to ${hit.name} (${hit.year}), but the text says ${c.year}.`, evidence: { title: hit.name, year: hit.year } };
      }
      // live lookup (when a token is configured) resolves any other real cite
      const live = await verifyCaseCiteLive(`${c.volume} ${c.reporter} ${c.page}`, courtListenerToken);
      if (live) {
        if (live.verdict === "green" && c.year != null && live.liveYear &&
            Math.abs(c.year - live.liveYear) > 2) {
          return {
            verdict: "red",
            reason: `The citation exists (${live.evidence.title}, ${live.liveYear}) but the text dates it to ${c.year}.`,
            evidence: live.evidence,
          };
        }
        return live;
      }
      return checkCaseCite(c); // bounds + era forensics decide
    }
    case "caseName": {
      const forensic = checkCaseName(c);
      if (forensic) return { verdict: "red", reason: forensic.reason, watch: forensic.watch };
      const hit = findLandmarkByName(`${c.claimant} v. ${c.defendant}`);
      if (hit) return { verdict: "green", reason: `Matches verified landmark case: ${hit.name} (${hit.cite}, ${hit.year}).`, evidence: { title: hit.name, cite: hit.cite, year: hit.year } };
      return null; // name-only citations are too weak to judge — mark unjudged
    }
    case "euReg":
    case "euDirective": {
      const hit = findEUAct(c.raw);
      if (hit) return { verdict: "green", reason: "Verified EU regulation (ELI id confirmed at build time).", evidence: { url: hit.url } };
      return checkEuReg(c);
    }
    case "usc": {
      const bad = checkUsc(c);
      if (bad) return bad;
      return { verdict: "amber", reason: "Valid U.S. Code title/section format; live U.S.C. checking is not available offline (link provided)." };
    }
    default:
      return null;
  }
}

const SEVERITY_RANK = { red: 0, amber: 1, green: 2 };
const dedupe = (cites) => {
  const seen = new Set();
  return cites.filter((c) => {
    const k = c.type + "|" + c.key;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export async function analyzeText(text, { onProgress } = {}) {
  const raw = extractCitations(text);
  const citations = dedupe(raw);
  const notes = textForensics(text, citations);

  const judged = [];
  let done = 0;
  for (const c of citations) {
    const live = await verifyOne(c);
    done++;
    if (onProgress && done % 3 === 0) onProgress(done, citations.length);
    judged.push({ ...c, ...(live || { verdict: "amber", reason: "Not enough signal to judge a name-only mention." }) });
  }
  if (onProgress) onProgress(citations.length, citations.length);

  // Case-name mentions that were flagged red should absorb their reporter cite
  // when the same fake citation string appears — the extractor will already
  // have the reporter cite separately, both end up red, which is correct.

  const counts = { green: 0, amber: 0, red: 0 };
  for (const j of judged) counts[j.verdict]++;
  for (const n of notes) counts[n.severity] = (counts[n.severity] || 0) + 1;

  const total = judged.length;
  const score = Math.max(
    0,
    Math.min(100,
      total === 0
        ? (notes.some((n) => n.severity === "red") ? 40 : 100)
        : Math.round(100 - (counts.red / total) * 100 - (counts.amber / total) * 30)
    )
  );

  return {
    score,
    counts,
    total,
    citations: judged,
    notes,
    checkedAt: new Date().toISOString(),
  };
}
