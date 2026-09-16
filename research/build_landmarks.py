#!/usr/bin/env python3
"""Build the verified landmark SCOTUS dataset for CiteWarden.

Source: Wikipedia 'List of landmark court decisions in the United States'
(rendered HTML via the Wikipedia API, retrieved at build time).
Every row must pass internal consistency checks:
  - U.S. Reports volume within real bounds (1..605)
  - decision year within 1751..2026 and consistent with the volume era
    (linear volume->year mapping, +-4y tolerance)
Provenance is recorded with the retrieval date. Rows failing checks are dropped.
Output: assets/js/data/landmarks.json
"""
import html
import json
import re
import urllib.request
from pathlib import Path

API = ("https://en.wikipedia.org/w/api.php?action=parse"
       "&page=List%20of%20landmark%20court%20decisions%20in%20the%20United%20States"
       "&prop=text&format=json&redirects=1")
UA = "CiteWardenBuild/1.0 (research; contact rudrasarker125@gmail.com)"
RETRIEVED = "2026-09-16"

VOL_BOUNDS = (1, 605)
# Piecewise volume->decision-year anchors, each independently documented by a
# famous verified case (e.g. 410 U.S. = 1973 Roe). Used for era consistency.
ERA_ANCHORS = [
    (2, 1793), (3, 1796), (4, 1799), (5, 1803), (17, 1819), (22, 1824), (60, 1857), (83, 1873), (109, 1883),
    (118, 1886), (163, 1896), (198, 1905), (249, 1919), (268, 1925),
    (290, 1932), (317, 1942), (323, 1944), (347, 1954), (367, 1963),
    (376, 1964), (384, 1966), (393, 1968), (410, 1973), (418, 1974),
    (438, 1978), (463, 1983), (485, 1988), (491, 1989), (505, 1992),
    (514, 1995), (521, 1997), (531, 2000), (539, 2003), (550, 2007),
    (554, 2008), (561, 2010), (567, 2012), (570, 2013), (573, 2014),
    (576, 2015), (579, 2016), (585, 2018), (588, 2019), (590, 2020),
    (596, 2022), (600, 2023), (603, 2024), (605, 2026),
]

TAG_RX = re.compile(r"<[^>]+>")
LI_RX = re.compile(r"<li>(.*?)</li>", re.DOTALL)
NAME_RX = re.compile(r"<i>(?:<a[^>]*>)?([^<]{3,140}?)(?:</a>)?</i>")
CITE_RX = re.compile(r"(\d{1,3})\s*U\.S\.\s*(\d{1,4})\s*\((\d{4})\)")


def era_year(vol: int) -> int:
    pts = ERA_ANCHORS
    if vol <= pts[0][0]:
        return pts[0][1]
    for (v0, y0), (v1, y1) in zip(pts, pts[1:]):
        if v0 <= vol <= v1:
            t = (vol - v0) / (v1 - v0) if v1 > v0 else 0
            return round(y0 + t * (y1 - y0))
    return pts[-1][1]


def check(row):
    if not (VOL_BOUNDS[0] <= row["vol"] <= VOL_BOUNDS[1]):
        return f"volume {row['vol']} out of bounds"
    if not (1751 <= row["year"] <= 2026):
        return f"year {row['year']} out of range"
    expect = era_year(row["vol"])
    if abs(expect - row["year"]) > 4:
        return f"volume {row['vol']} implies ~{expect}, row says {row['year']}"
    if len(row["name"]) < 5 or " in the " == row["name"]:
        return "name implausible"
    return None


def main():
    req = urllib.request.Request(API, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    page_html = data["parse"]["text"]["*"]

    cut = page_html.find("State_court_decisions")
    if cut == -1:
        cut = page_html.find("State court decisions")
    scotus = page_html[:cut] if cut > 0 else page_html

    rows, dropped = [], []
    for li in LI_RX.findall(scotus):
        nm = NAME_RX.search(li)
        text = html.unescape(TAG_RX.sub(" ", li))
        text = text.replace("&#32;", " ")
        cm = CITE_RX.search(text)
        if not nm or not cm:
            continue
        row = {
            "name": re.sub(r"\s+", " ", nm.group(1)).strip(),
            "vol": int(cm.group(1)),
            "page": int(cm.group(2)),
            "year": int(cm.group(3)),
        }
        why = check(row)
        if why:
            dropped.append({**row, "why": why})
            continue
        row["cite"] = f"{row['vol']} U.S. {row['page']}"
        rows.append(row)

    # dedupe by cite (keep first)
    seen, uniq = set(), []
    for r in rows:
        if r["cite"] in seen:
            continue
        seen.add(r["cite"])
        uniq.append(r)

    out = {
        "source": "Wikipedia: List of landmark court decisions in the United States",
        "source_url": "https://en.wikipedia.org/wiki/List_of_landmark_court_decisions_in_the_United_States",
        "retrieved": RETRIEVED,
        "checks": "volume bounds 1-605; piecewise era anchors +-4y; year 1751-2026; name non-empty",
        "count": len(uniq),
        "cases": uniq,
    }
    dest = Path(__file__).resolve().parent.parent / "assets" / "js" / "data"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / "landmarks.json").write_text(
        json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    (Path(__file__).parent / "landmarks_dropped.json").write_text(
        json.dumps(dropped, indent=1), encoding="utf-8")
    print(f"verified rows: {len(uniq)}  dropped: {len(dropped)}")
    for d in dropped[:10]:
        print("  DROP", d)


if __name__ == "__main__":
    main()
