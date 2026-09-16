import { analyzeText } from "./analysis.js";
import { loadReferenceData, MATA_CASE_STUDY } from "./landmark.js";

const $ = (id) => document.getElementById(id);

const EXAMPLE_FAKE = `MEMORANDUM OF LAW — excerpt (reconstructed for demonstration from the court's public order in Mata v. Avianca, 678 F. Supp. 3d 443 (S.D.N.Y. 2023)).

In opposition, Plaintiff relies on well-established aviation-law precedents. In Varghese v. China Southern Airlines Co., Ltd., 925 F.3d 1339 (11th Cir. 2019), the Eleventh Circuit held that an airline's admission of liability in a settlement communication is admissible. Similarly, Shaboon v. Egyptair, 2013 IL App (1st) 111279-U (Ill. App. Ct. 2013), applied federal preemption to international air-carrier claims. See also Peterson v. Iran Air, 905 F. Supp. 2d 121 (D.D.C. 2012); Martinez v. Delta Airlines, Inc., 2019 WL 4639462 (Tex. App. Sept. 25, 2019); Estate of Durden v. KLM Royal Dutch Airlines, 2017 WL 2418825 (Ga. Ct. App. June 5, 2017); and Miller v. United Airlines, Inc., 174 F.3d 366, 371-72 (2d Cir. 1999) (extending Montreal Convention protections). Zicherman v. Korean Air Lines Co., Ltd., 516 F.3d 1237, 1254 (11th Cir. 2008), confirms damages limitations. Taken together, these decisions compel denial of the motion to dismiss.`;

const EXAMPLE_REAL = `Large language models now mediate access to legal and scientific information. The Transformer architecture introduced in "Attention Is All You Need" (arXiv 1706.03762) underlies this shift, and the risks are documented: Bender et al.'s stochastic parrots paper (DOI 10.1145/3442188.3445922) and the empirical hallucination literature (PMID 36218125) both warn against offloading judgment to fluent systems. Regulators have responded: Regulation (EU) 2022/2065 imposes transparency duties on platforms, and the Equality Act 2010 continues to govern discriminatory outcomes in the UK. In U.S. law, Brown v. Board of Education, 347 U.S. 483 (1954), remains the canonical statement that separate is inherently unequal, and agencies rulemaking under 21 C.F.R. § 820.75 must validate automated processes. Citizens United v. Federal Election Commission, 558 U.S. 310 (2010), protected political speech by corporations.`;

const EXAMPLE_ESSAY = `The history of judicial review begins with Marbury v. Madison, 5 U.S. 137 (1803). Miranda v. Arizona, 384 U.S. 436 (1966), transformed police procedure by requiring warnings during custodial interrogation. Lochner v. New York, 198 U.S. 45 (1905), represents the substantive due process era. More recent scholarship (DOI 10.1017/S0003055422000946) analyzes the Court's legitimacy. On privacy, Katz v. United States, 389 U.S. 347 (1967), held that the Fourth Amendment protects people, not places. Studies show that public confidence tracks perceived neutrality. See also ter Ends: Judicial Review in Comparative Context, 88 Stat. 1234 (2025). Finally, Griswold v. Connecticut, 381 U.S. 479 (1965), established a right to privacy, and Texas v. Johnson, 491 U.S. 397 (1989), protected flag burning as speech under the First Amendment.`;

const verdictLabel = { green: "VERIFIED", amber: "UNVERIFIABLE", red: "FLAGGED" };

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function cardFor(c) {
  const card = el("div", `card ${c.verdict}`);
  const head = el("div", "card-head");
  head.appendChild(el("span", `badge ${c.verdict}`, verdictLabel[c.verdict]));
  head.appendChild(el("code", "raw", esc(c.raw)));
  head.appendChild(el("span", "kind", kindLabel(c.type)));
  card.appendChild(head);
  card.appendChild(el("p", "reason", esc(c.reason)));
  if (c.evidence) {
    const ev = el("div", "evidence");
    const bits = [];
    if (c.evidence.title) bits.push(`<b>${esc(c.evidence.title)}</b>`);
    if (c.evidence.year) bits.push(esc(String(c.evidence.year)));
    if (c.evidence.cite) bits.push(esc(c.evidence.cite));
    if (c.evidence.container) bits.push(esc(c.evidence.container));
    ev.innerHTML = bits.join(" · ");
    const link = c.evidence.url;
    if (link) {
      const a = el("a", "evlink", "open source ↗");
      a.href = link; a.target = "_blank"; a.rel = "noopener";
      ev.appendChild(a);
    }
    card.appendChild(ev);
  }
  if (c.watch) {
    card.appendChild(el("p", "watch", `Watchlist entry: <b>${esc(c.watch.name)}</b> — cited in the brief as “${esc(c.watch.cite)}”.`));
  }
  return card;
}

function kindLabel(t) {
  return {
    doi: "DOI", arxiv: "arXiv", pmid: "PubMed", cfr: "CFR", usc: "U.S. Code",
    caseCite: "reporter cite", caseName: "case name", ukAct: "UK act",
    euReg: "EU regulation", euDirective: "EU directive",
  }[t] || t;
}

function noteRow(n) {
  return el("div", `note ${n.severity}`, esc(n.note));
}

async function run() {
  const text = $("input").value.trim();
  if (!text) { $("input").focus(); return; }
  $("status").hidden = false;
  $("report").hidden = true;
  $("progress").style.width = "4%";
  $("statusText").textContent = "Loading verified reference data…";
  try {
    await loadReferenceData();
  } catch {
    $("statusText").textContent = "Reference data failed to load — check your connection and retry.";
    return;
  }
  $("statusText").textContent = "Analyzing…";
  let result;
  try {
    result = await analyzeText(text, {
      onProgress: (done, total) => {
        $("progress").style.width = Math.round((done / Math.max(1, total)) * 100) + "%";
        $("statusText").textContent = `Checked ${done}/${total} citations…`;
      },
    });
  } catch (e) {
    $("statusText").textContent = "Analysis error: " + e.message;
    return;
  }
  $("progress").style.width = "100%";
  setTimeout(() => { $("status").hidden = true; }, 400);

  $("scoreNum").textContent = result.score;
  $("dial").style.setProperty("--score", result.score);
  $("dial").className = "dial " + (result.score >= 80 ? "green" : result.score >= 50 ? "amber" : "red");
  $("cGreen").textContent = result.counts.green;
  $("cAmber").textContent = result.counts.amber;
  $("cRed").textContent = result.counts.red;
  $("cNotes").textContent = result.notes.length;

  const notesBox = $("notes");
  notesBox.innerHTML = "";
  for (const n of result.notes) notesBox.appendChild(noteRow(n));

  const box = $("citations");
  box.innerHTML = "";
  const order = { red: 0, amber: 1, green: 2 };
  for (const c of [...result.citations].sort((a, b) => order[a.verdict] - order[b.verdict])) {
    box.appendChild(cardFor(c));
  }
  if (!result.citations.length && !result.notes.length) {
    box.appendChild(el("p", "fineprint", "No recognizable citations found. CiteWarden judges citations, not general claims."));
  }
  $("verdictFine").textContent =
    `Checked ${result.citations.length} citation${result.citations.length === 1 ? "" : "s"} at ${new Date(result.checkedAt).toLocaleTimeString()}. ` +
    `Green = matched a live registry or the verified database. Amber = well-formed but unverifiable. Red = forensic violation, watchlist hit, or registry confirms non-existence.`;
  $("report").hidden = false;
  $("report").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("btnAnalyze").addEventListener("click", run);
$("btnExampleFake").addEventListener("click", () => { $("input").value = EXAMPLE_FAKE; });
$("btnExampleReal").addEventListener("click", () => { $("input").value = EXAMPLE_REAL; });
$("btnExampleEssay").addEventListener("click", () => { $("input").value = EXAMPLE_ESSAY; });
$("input").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
