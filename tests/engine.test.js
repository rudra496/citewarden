import { describe, it, expect } from "vitest";
import { extractCitations, reporterEraCheck } from "../assets/js/extract.js";
import { checkCaseCite, checkCaseName, checkUsc, checkCfr, textForensics } from "../assets/js/patterns.js";
import { eraYearForVolume, matchKnownFabricated, findLandmarkByCite, setReferenceData } from "../assets/js/landmark.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const landmarks = JSON.parse(readFileSync(join(here, "../assets/js/data/landmarks.json"), "utf-8"));
const ukEu = JSON.parse(readFileSync(join(here, "../assets/js/data/uk_eu_acts.json"), "utf-8"));
setReferenceData({ landmarks, ukEu });

describe("extraction", () => {
  it("finds DOIs and strips trailing punctuation", () => {
    const c = extractCitations("As shown in 10.1038/nature12373, and also 10.48550/arXiv.1706.03762.");
    const dois = c.filter((x) => x.type === "doi");
    expect(dois.map((d) => d.raw)).toEqual(["10.1038/nature12373", "10.48550/arXiv.1706.03762"]);
  });

  it("finds arXiv ids and PMIDs", () => {
    const c = extractCitations("arXiv:1706.03762 and arXiv 2312.05636v2, plus PMID: 27913995.");
    expect(c.find((x) => x.type === "arxiv").id).toBe("1706.03762");
    expect(c.find((x) => x.type === "arxiv" && x.key === "2312.05636v2")).toBeTruthy();
    expect(c.find((x) => x.type === "pmid").id).toBe("27913995");
  });

  it("finds CFR and U.S. Code cites", () => {
    const c = extractCitations("Under 21 C.F.R. § 820.75 and 18 U.S.C. § 1030(a)(1).");
    const cfr = c.find((x) => x.type === "cfr");
    const usc = c.find((x) => x.type === "usc");
    expect(cfr.title).toBe("21"); expect(cfr.section).toBe("820.75");
    expect(usc.title).toBe("18");
  });

  it("finds reporter cites with years", () => {
    const c = extractCitations("Roe v. Wade, 410 U.S. 113 (1973), and later F.3d cites like 925 F.3d 1339 (11th Cir. 2019).");
    const caseCites = c.filter((x) => x.type === "caseCite");
    expect(caseCites).toHaveLength(2);
    expect(caseCites[0].volume).toBe(410);
    expect(caseCites[0].reporter).toBe("U.S.");
    expect(caseCites[0].year).toBe(1973);
  });

  it("finds case names including the Mata fabrications", () => {
    const c = extractCitations("See Varghese v. China Southern Airlines Co., Ltd., and Estate of Durden v. KLM Royal Dutch Airlines.");
    const names = c.filter((x) => x.type === "caseName");
    expect(names).toHaveLength(2);
  });

  it("dedupes identical citations", () => {
    const c = extractCitations("10.1038/nature12373 was great. Again: 10.1038/nature12373.");
    expect(c.filter((x) => x.type === "doi")).toHaveLength(1);
  });

  it("rejects impossible U.S. Code titles", () => {
    const c = extractCitations("Under 99 U.S.C. § 1234.");
    const usc = c.find((x) => x.type === "usc");
    expect(usc).toBeUndefined(); // title 99 filtered at extraction
  });
});

describe("forensics", () => {
  it("flags U.S. Reports volumes above the real maximum", () => {
    const v = checkCaseCite({ volume: 700, reporter: "U.S.", page: 1, year: 2025 });
    expect(v.severity).toBe("red");
  });

  it("flags F.3d cites dated before F.3d existed", () => {
    const v = checkCaseCite({ volume: 42, reporter: "F.3d", page: 100, year: 1961 });
    expect(v.severity).toBe("red");
    expect(v.reason).toMatch(/did not exist/i);
  });

  it("flags U.S. volume/year era contradictions", () => {
    const v = checkCaseCite({ volume: 410, reporter: "U.S.", page: 113, year: 1960 });
    expect(v.severity).toBe("red");
  });

  it("accepts a plausible unverified cite as amber", () => {
    const v = checkCaseCite({ volume: 925, reporter: "F.3d", page: 1339, year: 2019 });
    expect(v.severity).toBe("amber");
  });

  it("matches every Mata fabrication on the watchlist", () => {
    const pairs = [
      ["Varghese", "China Southern Airlines Co., Ltd."],
      ["Shaboon", "Egyptair"],
      ["Peterson", "Iran Air"],
      ["Martinez", "Delta Airlines, Inc."],
      ["Estate of Durden", "KLM Royal Dutch Airlines"],
      ["Miller", "United Airlines, Inc."],
    ];
    for (const [a, b] of pairs) {
      expect(matchKnownFabricated(a, b), `${a} v. ${b}`).toBeTruthy();
    }
  });

  it("does not put real cases on the fabrication watchlist", () => {
    expect(matchKnownFabricated("Roe", "Wade")).toBeFalsy();
    expect(matchKnownFabricated("Brown", "Board of Education")).toBeFalsy();
  });

  it("flags impossible USC and CFR titles", () => {
    expect(checkUsc({ title: "99" }).severity).toBe("red");
    expect(checkUsc({ title: "18" })).toBeNull();
    expect(checkCfr({ title: "88", section: "1.1" }).severity).toBe("red");
    expect(checkCfr({ title: "21", section: "820.75" })).toBeNull();
  });

  it("detects conflicting years for the same citation", () => {
    const notes = textForensics("", [
      { type: "caseCite", volume: 410, reporter: "U.S.", page: 113, year: 1973 },
      { type: "caseCite", volume: 410, reporter: "U.S.", page: 113, year: 1999 },
    ]);
    expect(notes.some((n) => n.severity === "red" && /conflicting years/.test(n.note))).toBe(true);
  });
});

describe("reference data integrity", () => {
  it("landmark database passes its own bounds and era checks", () => {
    expect(landmarks.count).toBe(landmarks.cases.length);
    expect(landmarks.count).toBeGreaterThan(400);
    for (const c of landmarks.cases) {
      const vol = Number(c.cite.split(" ")[0]);
      expect(vol, c.name).toBeGreaterThanOrEqual(1);
      expect(vol, c.name).toBeLessThanOrEqual(605);
      expect(c.year, c.name).toBeGreaterThanOrEqual(1791);
      expect(c.year, c.name).toBeLessThanOrEqual(2026);
      // Names come from a curated source; in rem / ex parte / collective names
      // legitimately lack "v." (e.g. The Paquete Habana, Civil Rights Cases).
      expect(c.name, c.name).toMatch(/^[A-Z0-9"']/);
    }
  });

  it("Roe, Miranda and Brown are present with correct cites", () => {
    expect(findLandmarkByCite(410, 113)?.name).toMatch(/Roe/);
    expect(findLandmarkByCite(384, 436)?.name).toMatch(/Miranda/);
    expect(findLandmarkByCite(347, 483)?.name).toMatch(/Brown/);
  });

  it("era mapping is anchored on independently known volumes", () => {
    expect(eraYearForVolume(410)).toBe(1973);
    expect(eraYearForVolume(60)).toBe(1857);
    expect(eraYearForVolume(347)).toBeCloseTo(1954, 0);
  });

  it("UK/EU statute list only contains verified rows", () => {
    expect(ukEu.uk.length).toBeGreaterThanOrEqual(5);
    expect(ukEu.eu.length).toBeGreaterThanOrEqual(3);
    for (const a of ukEu.uk) expect(a.url).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
    for (const a of ukEu.eu) expect(a.url).toMatch(/^https:\/\/eur-lex\.europa\.eu\/eli\/reg\//);
  });
});
