#!/usr/bin/env python3
"""CiteWarden build-time landmark verification.

Verifies every candidate SCOTUS citation against Justia's citation-exact URL
(supreme.justia.com/cases/federal/us/{vol}/{page}/), extracts the real case
name + year from the page, and emits verified JSON. Rows that fail are dropped
and reported. Zero-hallucination discipline: only verified rows ship.
"""
import json
import re
import time
import urllib.request

CANDIDATES = [
    # (name_as_commonly_cited, vol, page, expected_year)
    ("Roe v. Wade", 410, 113, 1973),
    ("Doe v. Bolton", 410, 179, 1973),
    ("New York Times Co. v. Sullivan", 376, 254, 1964),
    ("Brown v. Board of Education", 347, 483, 1954),
    ("Plessy v. Ferguson", 163, 537, 1896),
    ("Miranda v. Arizona", 384, 436, 1966),
    ("Mapp v. Ohio", 367, 643, 1963),
    ("Baker v. Carr", 369, 186, 1962),
    ("United States v. Nixon", 418, 683, 1974),
    ("Hustler Magazine, Inc. v. Falwell", 485, 46, 1988),
    ("Romer v. Evans", 517, 620, 1996),
    ("Lawrence v. Texas", 539, 558, 2003),
    ("Obergefell v. Hodges", 576, 644, 2015),
    ("Dobbs v. Jackson Women's Health Organization", 597, 215, 2022),
    ("Masterpiece Cakeshop, Ltd. v. Colorado Civil Rights Commission", 584, 617, 2018),
    ("Timbs v. Indiana", 586, 146, 2019),
    ("Trump v. United States", 603, 593, 2024),
    ("Whole Woman's Health v. Hellerstedt", 579, 582, 2016),
    ("Regents of the University of California v. Bakke", 438, 265, 1978),
    ("Gideon v. Wainwright", 372, 335, 1963),
    ("Griswold v. Connecticut", 381, 479, 1965),
    ("Tinker v. Des Moines Independent Community School District", 393, 503, 1969),
    ("Brandenburg v. Ohio", 395, 444, 1969),
    ("Terry v. Ohio", 392, 1, 1968),
    ("Katz v. United States", 389, 347, 1967),
    ("Marbury v. Madison", 5, 137, 1803),
    ("McCulloch v. Maryland", 17, 316, 1819),
    ("Gibbons v. Ogden", 22, 1, 1824),
    ("Dred Scott v. Sandford", 60, 393, 1857),
    ("Schenck v. United States", 249, 47, 1919),
    ("Wickard v. Filburn", 317, 111, 1942),
    ("Mapp", 367, 643, 1963),
    ("Engel v. Vitale", 370, 421, 1962),
    ("Lemon v. Kurtzman", 403, 602, 1971),
    ("Miller v. California", 413, 15, 1973),
    ("Texas v. Johnson", 491, 397, 1989),
    ("Planned Parenthood of Southeastern Pennsylvania v. Casey", 505, 833, 1992),
    ("United States v. Lopez", 514, 549, 1995),
    ("Bush v. Gore", 531, 98, 2000),
    ("Grutter v. Bollinger", 539, 306, 2003),
    ("District of Columbia v. Heller", 554, 570, 2008),
    ("McDonald v. City of Chicago", 561, 742, 2010),
    ("Citizens United v. Federal Election Commission", 558, 310, 2010),
    ("National Federation of Independent Business v. Sebelius", 567, 519, 2012),
    ("Shelby County v. Holder", 570, 529, 2013),
    ("Burwell v. Hobby Lobby Stores", 573, 682, 2014),
    ("Carpenter v. United States", 585, 296, 2018),
    ("Bostock v. Clayton County", 590, 644, 2020),
    ("New York State Rifle & Pistol Association v. Bruen", 597, 1, 2022),
    ("Students for Fair Admissions v. President and Fellows of Harvard College", 600, 181, 2023),
    ("West Virginia v. Environmental Protection Agency", 597, 697, 2022),
    ("Kennedy v. Bremerton School District", 597, 507, 2022),
    ("Moore v. Harper", 600, 1, 2023),
    ("Trump v. Anderson", 601, 286, 2024),
    ("City of Grants Pass v. Johnson", 603, 275, 2024),
    ("SEC v. Jarkesy", 603, 242, 2024),
    ("Loper Bright Enterprises v. Raimondo", 603, 369, 2024),
    ("Knox v. Service Employees", 567, 298, 2012),
    ("Crawford v. Marion County Election Board", 553, 181, 2008),
    ("Shaw v. Reno", 509, 630, 1993),
    ("Reynolds v. Sims", 377, 533, 1964),
    ("Wesberry v. Sanders", 376, 1, 1964),
    ("Heart of Atlanta Motel v. United States", 379, 241, 1964),
    ("Loving v. Virginia", 388, 1, 1967),
    ("Reed v. Reed", 404, 71, 1971),
    ("Frontiero v. Richardson", 411, 677, 1973),
    ("Craig v. Boren", 429, 190, 1976),
    ("Mississippi University for Women v. Hogan", 458, 718, 1982),
    ("United States v. Virginia", 518, 515, 1996),
    ("Boy Scouts of America v. Dale", 530, 640, 2000),
    ("Gonzales v. Raich", 545, 1, 2005),
    ("Kelo v. City of New London", 545, 469, 2005),
    ("Riley v. California", 573, 373, 2014),
    ("Riley v. California (2)", 573, 373, 2014),
    ("Utah v. Strieff", 579, 232, 2016),
    ("County of Riverside v. McLaughlin", 500, 44, 1991),
    ("South Dakota v. Wayfair", 585, 162, 2018),
    ("Janus v. State, County, and Municipal Employees", 585, 878, 2018),
    ("Espinoza v. Montana Department of Revenue", 591, 464, 2020),
    ("Carson v. Makin", 596, 767, 2022),
    ("303 Creative LLC v. Elenis", 600, 570, 2023),
    ("Gonzalez v. Google LLC", 598, 617, 2023),
    ("Twitter, Inc. v. Taamneh", 598, 471, 2023),
    ("Andy Warhol Foundation for the Visual Arts v. Goldsmith", 598, 508, 2023),
    ("Haaland v. Brackeen", 599, 255, 2023),
    ("Muldrow v. City of St. Louis", 601, 346, 2024),
    ("Erlanger Zoological Co. v. [...] skip", 0, 0, 0),
]

def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) CiteWardenBuild/1.0",
        "Accept": "text/html",
    })
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", errors="replace"), r.status

TITLE_RX = re.compile(r"<title>(.*?)</title>", re.DOTALL | re.IGNORECASE)
YEAR_RX = re.compile(r"\b(1[7-9]\d{2}|20[0-2]\d)\b")

def norm(s):
    s = s.lower()
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def name_match(a, b):
    na, nb = norm(a), norm(b)
    if not na or not nb:
        return False
    wa, wb = set(na.split()), set(nb.split())
    stop = {"v", "vs", "the", "of", "and", "inc", "ltd", "co"}
    wa, wb = wa - stop, wb - stop
    inter = wa & wb
    return len(inter) >= min(2, max(1, len(wa) - 1)) or (na in nb) or (nb in na)

def verify(name, vol, page, year):
    url = f"https://supreme.justia.com/cases/federal/us/{vol}/{page}/"
    try:
        html, status = fetch(url)
    except Exception as e:
        return None, f"fetch-failed {e}"
    if status != 200:
        return None, f"HTTP {status}"
    t = TITLE_RX.search(html)
    if not t:
        return None, "no title"
    title = t.group(1).strip()
    # Justia titles look like: "Roe v. Wade, 410 U.S. 113 (1973)"
    m = re.search(r"\((\d{4})\)", title)
    real_year = int(m.group(1)) if m else None
    if real_year and year and abs(real_year - year) > 1:
        return None, f"year mismatch: page={real_year} candidate={year}"
    if not name_match(name, title):
        return None, f"name mismatch: page='{title[:70]}'"
    return {"cite": f"{vol} U.S. {page}", "name": name, "year": real_year or year,
            "url": url, "verified_title": title[:120]}, "ok"

def main():
    verified, failures = [], []
    for name, vol, page, year in CANDIDATES:
        if vol == 0:
            continue
        row, why = verify(name, vol, page, year)
        if row:
            verified.append(row)
            print(f"OK   {row['cite']:<15} {row['name'][:60]} ({row['year']})")
        else:
            failures.append({"name": name, "vol": vol, "page": page, "year": year, "why": why})
            print(f"DROP {vol} U.S. {page:<6} {name[:50]} -> {why}")
        time.sleep(0.7)  # polite
    with open("data_landmarks_verified.json", "w", encoding="utf-8") as f:
        json.dump(verified, f, indent=1, ensure_ascii=False)
    with open("data_landmarks_failures.json", "w", encoding="utf-8") as f:
        json.dump(failures, f, indent=1, ensure_ascii=False)
    print(f"\nverified={len(verified)} dropped={len(failures)}")

if __name__ == "__main__":
    main()
