// CiteWarden — labeled self-audit fixtures + live accuracy harness.
// The tool audits itself in the browser: every fixture carries the verdict
// class a correct engine must produce (using ONLY offline layers — forensics +
// landmark DB + watchlist — so the audit is reproducible without network).
// Real citations are drawn from the verified landmark DB; fabricated ones are
// synthetic constructions (labeled as such) that violate real bounds/eras.

import { extractCitations } from "./extract.js";
import { checkCaseCite, checkCaseName } from "./patterns.js";
import { findLandmarkByCite, findLandmarkByName, loadReferenceData } from "./landmark.js";

// Fixtures are built FROM the verified landmark DB (never hardcoded), so a
// green expectation always corresponds to a row the DB genuinely contains.
export async function buildFixtures() {
  const { landmarks } = await loadReferenceData();
  const cases = landmarks.cases.filter((c) => c.cite.includes(" U.S. ")).slice(0, 8);
  const fixtures = [];
  for (const c of cases) {
    const [vol, page] = [c.cite.split(" U.S. ")[0], c.cite.split(" U.S. ")[1]];
    const text = `The holding in ${c.name}, ${vol} U.S. ${page} (${c.year}), remains central.`;
    fixtures.push({ text, expect: "green", why: `${c.cite} is a verified landmark cite` });
  }
  // Synthetic fabrications (never real): volume beyond U.S. max; F.3d before 1992;
  // era contradiction; watchlist names from the Mata order (public record).
  const fakes = [
    ["Under Keeler v. Superior Court, 770 U.S. 999 (2019), the rule is clear.", "red", "U.S. vol 770 > 605 (does not exist)"],
    ["Per Meridian Bank v. Canady, 42 F.3d 210 (1961), jurisdiction was proper.", "red", "F.3d did not exist in 1961"],
    ["In Halstead v. Granger, 410 U.S. 999 (1960), the Court held otherwise.", "red", "era: vol 410 is from ~1973"],
    ["The panel relied on Varghese v. China Southern Airlines Co., Ltd. for the standard.", "red", "Mata watchlist (order ¶36)"],
    ["Citing Estate of Durden v. KLM Royal Dutch Airlines, plaintiff sought damages.", "red", "Mata watchlist (order ¶36)"],
    ["As in Martinez v. Delta Airlines, Inc., preemption defeated the claim.", "red", "Mata watchlist (order ¶36)"],
  ];
  for (const [text, expect, why] of fakes) {
    fixtures.push({ text, expect, why });
  }
  return fixtures;
}

// Offline-only verdict for a fixture text (deterministic, no network).
export function offlineVerdicts(text) {
  const out = [];
  for (const c of extractCitations(text)) {
    if (c.type === "caseCite") {
      const hit = findLandmarkByCite(c.volume, c.page);
      if (hit && (c.year == null || Math.abs(c.year - hit.year) <= 1)) out.push("green");
      else out.push(checkCaseCite(c).severity);
    } else if (c.type === "caseName") {
      const forensic = checkCaseName(c);
      if (forensic) out.push("red");
      else if (findLandmarkByName(`${c.claimant} v. ${c.defendant}`)) out.push("green");
    }
  }
  return out;
}

export async function runSelfAudit() {
  const FIXTURES = await buildFixtures();
  const rows = [];
  const stats = { total: FIXTURES.length, green: { correct: 0, missed: 0 }, red: { correct: 0, missed: 0 }, wrongClaims: 0 };
  for (const f of FIXTURES) {
    const verdicts = offlineVerdicts(f.text);
    const saw = verdicts.includes(f.expect) ? f.expect : verdicts[0] || "none";
    const ok = verdicts.includes(f.expect);
    if (f.expect === "green") ok ? stats.green.correct++ : stats.green.missed++;
    if (f.expect === "red") ok ? stats.red.correct++ : stats.red.missed++;
    if (!ok) stats.wrongClaims++;
    rows.push({ text: f.text.slice(0, 90), expect: f.expect, saw, ok, why: f.why });
  }
  stats.accuracy = Math.round(((stats.total - stats.wrongClaims) / stats.total) * 1000) / 10;
  return { stats, rows };
}
