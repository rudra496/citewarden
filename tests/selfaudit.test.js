import { describe, it, expect, beforeAll } from "vitest";
import { runSelfAudit, offlineVerdicts, buildFixtures } from "../assets/js/selfaudit.js";
import { setReferenceData } from "../assets/js/landmark.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const landmarks = JSON.parse(readFileSync(join(here, "../assets/js/data/landmarks.json"), "utf-8"));
const ukEu = JSON.parse(readFileSync(join(here, "../assets/js/data/uk_eu_acts.json"), "utf-8"));
setReferenceData({ landmarks, ukEu });

describe("self-audit harness", () => {
  it("achieves 100% on its labeled fixtures", async () => {
    const { stats } = await runSelfAudit();
    expect(stats.wrongClaims).toBe(0);
    expect(stats.accuracy).toBe(100);
    expect(stats.green.correct).toBeGreaterThanOrEqual(8);
    expect(stats.red.correct).toBeGreaterThanOrEqual(6);
  });

  it("builds green fixtures only from rows the DB actually contains", async () => {
    const fixtures = await buildFixtures();
    for (const f of fixtures.filter((x) => x.expect === "green")) {
      const m = f.text.match(/(\d+) U\.S\. (\d+)/);
      expect(m, f.text).toBeTruthy();
      expect(landmarks.cases.some((c) => c.cite === `${m[1]} U.S. ${m[2]}`), f.text).toBe(true);
    }
  });

  it("offline verdicts flag every watchlist name", () => {
    expect(offlineVerdicts("See Varghese v. China Southern Airlines Co., Ltd. for the test.")).toContain("red");
    expect(offlineVerdicts("See Roe v. Wade for the test.")).toContain("green");
  });
});
