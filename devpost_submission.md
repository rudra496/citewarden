# Devpost Submission Draft — LexHack 2026 (CiteWarden)

> Prepared 2026-09-16. Paste into the Devpost "Start a Project" submission form.
> FINAL SUBMIT only after Rudra Sir's explicit OK.

## Project name
CiteWarden

## Short summary (~600 chars)
AI writes fluent citations that do not exist. In Mata v. Avianca, 678 F. Supp. 3d 443 (S.D.N.Y. 2023),
lawyers were sanctioned $5,000 for filing six ChatGPT-invented court decisions. CiteWarden is the
checking layer: paste any text and it extracts every citation (DOIs, PMIDs, arXiv IDs, CFR parts,
U.S. reporter cites, case names, UK acts, EU regulations), verifies each against live registries
(Crossref, OpenAlex, PubMed, eCFR) plus a 464-case verified landmark database, and runs a forensic
engine that catches impossible volumes, era contradictions, and the exact six fabricated cases from
the Mata docket. Transparent integrity score, evidence link per citation, zero backend.

## Problem & solution
**Problem:** Generative AI fabricates citations with total confidence. Courts sanction lawyers;
students cite papers that don't exist; fact-checkers drown. The failure mode is structural: an LLM
cannot know whether the reference it generated resolves to a real document.

**Solution:** CiteWarden reads text the way a paranoid reference librarian would:
1. Extract — 10 citation families recognized in one pass.
2. Verify live — Crossref → OpenAlex for DOIs; PubMed for PMIDs; OpenAlex arXiv mirror for preprints;
   official eCFR for regulatory parts; Wikipedia record checks for statutes.
3. Verify offline — a build-time-verified database of 464 landmark U.S. cases (volume, page, year, name).
4. Forensics — reporter volume bounds (a cite to vol. 700 U.S. cannot exist), reporters cited before
   their first publication year (F.3d cited to 1961), decision years contradicting the volume era,
   same-cite/conflicting-year collisions, and the documented Mata fabrication watchlist.
5. Score — 100 − 100·(red/total) − 30·(amber/total): fully explainable, per-citation evidence trail.

The key honesty rule: amber means "well-formed but unverifiable" — we never guess. Red requires a
forensic impossibility, a registry 404, or a documented watchlist hit.

## What makes it real (not a demo)
- The six fabricated citations in the built-in example are transcribed verbatim from the published
  order (Berkeley Law archive PDF; docket 1:22-cv-01461, Judge P. Kevin Castel — verified via
  CourtListener API). Load the example and all six go red; the two real citations in the same brief
  stay amber — the distinction is real.
- Every shipped data row passed machine checks at build time (scripts in research/). Rows that could
  not be verified (EU AI Act, EU Data Act) were dropped, not guessed.
- 19 automated tests include data-integrity guards (the landmark DB must pass its own bounds/era checks).

## Tech stack
Vanilla ES modules (no framework, no build step), service-worker PWA (offline app shell + cached
databases), vitest, Python (build-time verification scripts), GitHub Pages. Live APIs: Crossref,
OpenAlex, NCBI E-utilities, eCFR versioner, MediaWiki (origin=* CORS). Zero backend, zero tracking:
text never leaves the browser except citation strings sent as read-only registry queries.

## Links
- Live app: https://rudra496.github.io/citewarden/
- Repo: https://github.com/rudra496/citewarden
- Evidence & provenance log: https://github.com/rudra496/citewarden/blob/main/docs/EVIDENCE.md
- Demo video (2:04, 4.5 MB, English narration + burned captions):
  - hosted in-repo: https://github.com/rudra496/citewarden/blob/main/video/CiteWarden_LexHack_Demo.mp4
  - direct MP4: https://raw.githubusercontent.com/rudra496/citewarden/main/video/CiteWarden_LexHack_Demo.mp4
  - (also upload to YouTube unlisted on the form if a video URL field is required)

## Judging-criteria mapping (LexHack rubric)
- Real-World Impact & Feasibility (25%): attacks the single most documented AI-in-law failure mode;
  deployable today as a static site; useful to clinics, students, journalists.
- Technical Execution (25%): working extraction/verification/forensics pipeline, 19/19 tests,
  five live registry integrations, verifiable evidence trail.
- UX & Design (20%): paste → score → color-ranked citation cards in under 10 seconds; one-click
  examples; every verdict explained in plain language.
- Innovation (15%): volume-era forensics + documented-fabrication watchlist = catching fakes without
  any network; the Mata case study is built into the product, not a slide.
- Presentation (15%): this write-up + evidence log + 3-minute video with the real sanctioned brief.

## Track
Primary: AI Safety, Ethics & Governance. Secondary: Access to Justice & Civic Tech.
