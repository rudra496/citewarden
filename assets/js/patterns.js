// CiteWarden — forensic pattern engine.
// Offline checks that catch fabricated citations without any network access:
// volume bounds, volume-era consistency, year sanity, format checks, and a
// known-fabricated watchlist (Mata v. Avianca docket, verified primary source).

import { eraYearForVolume, USC_VOL_MAX, matchKnownFabricated } from "./landmark.js";

export const CURRENT_YEAR = 2026;

// Upper bounds are deliberately generous: a bound violation must be a certainty,
// never a guess. F.3d is ~vol 1050 by 2026; S. Ct. ~186; F. Supp. 3d ~650.
export const REPORTER_META = {
  "U.S.": { first: 1, last: USC_VOL_MAX, label: "United States Reports" },
  "F.3d": { first: 1, last: 1100, label: "Federal Reporter, 3rd" },
  "F.2d": { first: 1, last: 999, label: "Federal Reporter, 2nd" },
  "F.": { first: 1, last: 200, label: "Federal Reporter (1st)" },
  "S. Ct.": { first: 1, last: 250, label: "Supreme Court Reporter" },
  "F. Supp. 2d": { first: 1, last: 1050, label: "Federal Supplement 2nd" },
  "F. Supp. 3d": { first: 1, last: 800, label: "Federal Supplement 3rd" },
};

// Reporters that only exist after a certain year — catches e.g. "402 F.3d 55 (1961)".
export const REPORTER_MIN_YEAR = { "F.3d": 1992, "F. Supp. 3d": 2013, "F. Supp. 2d": 1998 };

// Severity: "red" = fabricated / impossible; "amber" = plausible but unverified;
// "green" set by verify.js when a live or DB match succeeds.
export function checkCaseCite(cite) {
  const meta = REPORTER_META[cite.reporter];
  if (meta && (cite.volume < meta.first || cite.volume > meta.last)) {
    return {
      severity: "red",
      reason: `${meta.label} volume ${cite.volume} does not exist (real range ${meta.first}–${meta.last}).`,
    };
  }
  if (cite.year != null) {
    if (cite.year < 1751 || cite.year > CURRENT_YEAR) {
      return { severity: "red", reason: `Decision year ${cite.year} is impossible.` };
    }
    if (meta && cite.year < (REPORTER_MIN_YEAR[cite.reporter] ?? 0)) {
      return {
        severity: "red",
        reason: `${meta.label} did not exist in ${cite.year} (first published ${REPORTER_MIN_YEAR[cite.reporter]}).`,
      };
    }
    if (cite.reporter === "U.S.") {
      const eraStart = eraYearForVolume(cite.volume);
      if (cite.year < eraStart - 4) {
        return {
          severity: "red",
          reason: `U.S. Reports vol. ${cite.volume} did not exist in ${cite.year} (that volume is from ~${eraStart}).`,
        };
      }
    }
  }
  if (meta && cite.page < 1) {
    return { severity: "red", reason: `Page number ${cite.page} is invalid.` };
  }
  return {
    severity: "amber",
    reason: "Well-formed citation; not in the shipped landmark database and no live case-law lookup configured.",
  };
}

export function checkCaseName(nameCite) {
  const fake = matchKnownFabricated(nameCite.claimant, nameCite.defendant);
  if (fake) {
    return {
      severity: "red",
      reason: `This exact case is on the documented fabrication watchlist: listed as non-existent in ${"Mata v. Avianca"}, 678 F. Supp. 3d 443 (S.D.N.Y. 2023) ¶36.`,
      watch: fake,
    };
  }
  return null; // no opinion — other layers decide
}

export function checkUsc(cite) {
  const t = Number(cite.title);
  if (!(t >= 1 && t <= 54)) {
    return { severity: "red", reason: `U.S. Code title ${cite.title} does not exist (titles run 1–54).` };
  }
  return null;
}

export function checkCfr(cite) {
  const t = Number(cite.title);
  if (!(t >= 1 && t <= 54)) {
    return { severity: "red", reason: `CFR title ${cite.title} does not exist (titles run 1–54).` };
  }
  if (!/^\d+(\.\d+)*$/.test(cite.section)) {
    return { severity: "red", reason: `CFR section "${cite.section}" is malformed.` };
  }
  return null;
}

export function checkEuReg(cite) {
  if (cite.year < 1958 || cite.year > CURRENT_YEAR) {
    return { severity: "red", reason: `EU regulation year ${cite.year} is impossible.` };
  }
  return null;
}

// Whole-text heuristics.
export function textForensics(text, citations) {
  const notes = [];
  if (/\[\s*citation needed\s*\]|\[citation\]|XX\s*U\.S\.\s*XXX/i.test(text)) {
    notes.push({ severity: "amber", note: "Placeholder citation artifacts found in text." });
  }
  const years = {};
  for (const c of citations) {
    if (c.type === "caseCite" && c.year != null) {
      const k = `${c.volume} ${c.reporter} ${c.page}`;
      if (years[k] && years[k] !== c.year) {
        notes.push({ severity: "red", note: `Same citation "${k}" appears with conflicting years ${years[k]} and ${c.year}.` });
      }
      years[k] = c.year;
    }
  }
  if (citations.length > 0 && citations.length / Math.max(1, text.split(/\s+/).length / 120) > 25) {
    notes.push({ severity: "amber", note: "Unusually dense citation rate for the text length." });
  }
  if (/\b(studies show|research shows|experts (say|agree)|it is widely known)\b.*?\b(that|how|why)\b/gi.test(text)) {
    notes.push({ severity: "amber", note: "Unattributed authoritative claims detected (\"studies show…\")." });
  }
  return notes;
}
