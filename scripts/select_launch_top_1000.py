#!/usr/bin/env python3
"""
Rockwell Metals · Launch Top-1000 Selector
==========================================
Ranks the master catalog (archive/master-catalog-ai-25457/products.master.json) for a launch subset.

Only the 3,842 products linked to the APMEX research dataset carry real demand
signals (curated importance_score, prior top-1000 list membership, review
counts, stock status).  The remaining ~21,600 JM Bullion / SD Bullion long-tail
products have no popularity data at all, so they are not candidates.

Score = importance_score
      + 60  if in prior "top_1000_search_popular" list
      + 40  if in prior "top_1000_family_balanced" list
      + 1.5 x review_count (capped at 50 reviews)
      + 40  in stock at source / -80 out of stock ("AlertMe!")
      + 30  has a static price / -40 no price AND not live-quotable bullion
      + 40  evergreen (random-year / undated bullion)
      - 25  dated bullion older than 2023 (stale dated years)

Then: dedupe by SKU and normalised title, cap each product family at
FAMILY_CAP so graded Double Eagles / proof RCM sets don't crowd out breadth,
and take the top N.

Outputs data/launch_top_1000.csv and data/launch_top_1000.json.
"""
import csv, json, re, sys, collections
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
csv.field_size_limit(sys.maxsize)
N = int(sys.argv[1]) if len(sys.argv) > 1 else 1000
FAMILY_CAP = 6      # per fine product_family (metal|brand|series|weight|form|finish)
SERIES_CAP = 30     # per series (american gold eagle, canadian maple leaf, ...)
VARIANT_CAP = 3     # per base coin: year / mint-mark / grade variants of the same product

STRIP = [
    r"\b(17|18|19|20)\d\d(-(17|18|19|20)\d\d)?\b", r"\b(17|18|19|20)\d\d-[a-z]{1,2}\b", r"\byear\b",
    r"\b(ms|pf|pr|sp|au|xf|vf|ef|f|g|ag|vg)-?\s?\d\d\b", r"\b(ms|pf|pr|sp)\d\d\b",
    r"\((p|w|s|o|d|cc)\)", r"-\s?(w|s|o|d|p|cc)\b",
    r"\b(random|varied|our choice|current|present|date|dates?)\b",
    r"\b(bu|au|xf|vf|unc|brilliant uncirculated|gem|circulated|cull|about uncirculated|burnished)\b",
    r"\b(ngc|pcgs|anacs|cac|dcam|ucam|ultra cameo|fdi|fdd|fs|er|first strike|first day of (issue|delivery)|early releases?|firststrike|moy|mercanti|gaudioso|ryder|signed|type ?[12]|dual date|250th|30th|35th|40th|large|small)\b",
    r"\b(w/|with|in)\s?(box|assay|capsule|coa|ogp)\b.*", r"\b(box|assay|capsule|coa|ogp|mintdirect|premier|md|tube|sealed)\b",
    r"\b(coin|coins|the)\b", r"\b(privy|lunar|rooster|horse|dog|dragon|snake|tiger|rabbit|ox|rat|pig|monkey|goat|eagle privy|star privy)\b",
]
def base_key(t):
    t = t.lower().replace("®", " ").replace("™", " ")
    for pat in STRIP: t = re.sub(pat, " ", t)
    t = re.sub(r"[^a-z0-9/$ ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()

ap = list(csv.DictReader(open(ROOT / "data/apmex_all_product_data.csv", encoding="utf-8")))
# The full catalog lives in the archive; app/data/products.json is now the launch subset.
products = json.load(open(ROOT / "archive/master-catalog-ai-25457/products.master.json"))
by_url = {r["product_url"].strip().rstrip("/").lower(): r for r in ap}

def f(v, d=0.0):
    try: return float(str(v).replace(",", ""))
    except: return d

BULLION_FINISH = {"standard", "bu"}
def norm_title(t):
    t = t.lower()
    t = re.sub(r"\(.*?\)", " ", t)
    t = re.sub(r"[^a-z0-9 ]", " ", t)
    return re.sub(r"\s+", " ", t).strip()

rows = []
for p in products:
    ref = (p.get("apmexReferenceUrl") or "").rstrip("/").lower()
    r = by_url.get(ref)
    if not r: continue
    fam = r["product_family"].split(" | ")
    metal_f, brand, series, weight, form, finish = (fam + ["?"] * 6)[:6]
    imp = f(r["importance_score"])
    reviews = f(r["review_count"])
    src = r["source_files"]
    avail = r["availability"]
    title = p["title"]
    year = p.get("year")
    is_random = bool(re.search(r"random|varied|our choice|\d{4}-\d{4}|\d{4}-(current|present|date)", title, re.I))
    evergreen = year is None or is_random
    numismatic = finish in ("graded-60s", "graded-70", "circulated") or bool(re.search(r"ngc|pcgs|ms-?\d\d|au-?\d\d|pr-?\d\d|proof", title, re.I))
    quotable_bullion = finish in BULLION_FINISH and not numismatic
    has_price = bool(p.get("price"))
    score = imp
    reasons = []
    if "top_1000_search_popular" in src: score += 60; reasons.append("search-popular list")
    if "top_1000_family_balanced" in src: score += 40; reasons.append("family-balanced list")
    if reviews: score += 1.5 * min(reviews, 50); reasons.append(f"{int(reviews)} reviews")
    if avail == "InStock" or p["badge"] in ("In Stock", "Sale", "Top Pick", "At Spot"): score += 40; reasons.append("in stock")
    elif avail == "OutOfStock" or p["badge"] == "AlertMe!®": score -= 80; reasons.append("out of stock at source")
    if has_price: score += 30
    elif not quotable_bullion: score -= 40; reasons.append("no price, not spot-quotable")
    if evergreen: score += 40; reasons.append("evergreen/random-year")
    elif isinstance(year, (int, str)) and str(year).isdigit() and 1960 < int(year) < 2023 and not numismatic:
        score -= 25; reasons.append(f"stale dated ({year})")
    if p["badge"] == "Top Pick": score += 25; reasons.append("Top Pick badge")
    rows.append({
        "id": p["id"], "sku": p["sku"], "title": title, "metal": p["metal"], "mint": p["mint"],
        "family": r["product_family"], "series": series, "form": form, "finish": finish, "weight": weight,
        "price": p.get("price"), "badge": p["badge"], "source_rank": int(f(r["original_5k_rank"], 99999)),
        "importance": imp, "reviews": int(reviews), "rating": r["rating"], "availability": avail,
        "has_gallery": bool(p.get("images")), "score": round(score, 1), "reasons": "; ".join(reasons),
        "_ntitle": norm_title(title), "_base": base_key(title), "_p": p,
    })

rows.sort(key=lambda x: -x["score"])

# de-dupe (sku, normalised title), then family caps
# Pass 1 applies strict diversity caps; pass 2 relaxes them only to fill any
# remaining slots, so breadth always wins over "one more year of the same coin".
seen_sku, seen_title, picked_ids = set(), set(), set()
fam_count, series_count, base_count = collections.Counter(), collections.Counter(), collections.Counter()
picked, dropped_dupe, dropped_cap = [], 0, 0
PASSES = [(FAMILY_CAP, SERIES_CAP, VARIANT_CAP), (FAMILY_CAP + 4, SERIES_CAP + 15, VARIANT_CAP + 1), (FAMILY_CAP + 8, SERIES_CAP + 30, VARIANT_CAP + 1), (FAMILY_CAP + 14, SERIES_CAP + 50, VARIANT_CAP + 1)]
for pass_no, (fcap, scap, vcap) in enumerate(PASSES, 1):
    for x in rows:
        if len(picked) >= N: break
        if x["id"] in picked_ids: continue
        if x["sku"] in seen_sku or x["_ntitle"] in seen_title:
            if pass_no == 1: dropped_dupe += 1
            continue
        if fam_count[x["family"]] >= fcap or series_count[x["series"]] >= scap or base_count[x["_base"]] >= vcap:
            if pass_no == 1: dropped_cap += 1
            continue
        seen_sku.add(x["sku"]); seen_title.add(x["_ntitle"]); picked_ids.add(x["id"])
        fam_count[x["family"]] += 1; series_count[x["series"]] += 1; base_count[x["_base"]] += 1
        x["pass"] = pass_no
        picked.append(x)
    print(f"pass {pass_no} (family<={fcap}, series<={scap}, variants<={vcap}): {len(picked)} picked")
picked.sort(key=lambda x: -x["score"])

for i, x in enumerate(picked, 1): x["launch_rank"] = i

for x in picked: x["base_coin"] = x["_base"]
cols = ["launch_rank","pass","id","sku","title","base_coin","metal","mint","series","form","finish","weight","price","badge","availability","source_rank","importance","reviews","rating","has_gallery","score","reasons","family"]
with open(ROOT / f"data/launch_top_{N}.csv", "w", newline="", encoding="utf-8") as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore"); w.writeheader(); w.writerows(picked)
with open(ROOT / f"data/launch_top_{N}.json", "w", encoding="utf-8") as fh:
    json.dump([{**x["_p"], "launchRank": x["launch_rank"], "launchScore": x["score"]} for x in picked], fh, indent=1)

C = collections.Counter
print(f"candidates={len(rows)} picked={len(picked)} dropped_dupes={dropped_dupe} dropped_family_cap={dropped_cap}")
print("metal:", dict(C(x["metal"] for x in picked)))
print("form:", dict(C(x["form"] for x in picked)))
print("finish:", dict(C(x["finish"] for x in picked)))
print("weight:", dict(C(x["weight"] for x in picked)))
print("mint:", C(x["mint"] for x in picked).most_common(12))
print("series:", C(x["series"] for x in picked).most_common(25))
print("badge:", dict(C(x["badge"] for x in picked)))
print("distinct base coins:", len(set(x["_base"] for x in picked)), " year-dated:", sum(1 for x in picked if x["_p"].get("year")))
print("biggest base groups:", C(x["_base"] for x in picked).most_common(8))
print("has static price:", sum(1 for x in picked if x["price"]), " gallery:", sum(1 for x in picked if x["has_gallery"]))
print("in stock at source:", sum(1 for x in picked if x["availability"]=="InStock"), " out:", sum(1 for x in picked if x["availability"]=="OutOfStock"))
print("score range:", picked[0]["score"], "->", picked[-1]["score"], " | next unpicked:", [x["score"] for x in rows if x not in picked][:1])
print("\nTOP 40:")
for x in picked[:40]: print(f'{x["launch_rank"]:>4} {x["score"]:>7} {x["metal"]:<8} ${x["price"] or "-":<9} {x["title"][:75]}')
print("\nRANK 990-1000:")
for x in picked[-10:]: print(f'{x["launch_rank"]:>4} {x["score"]:>7} {x["metal"]:<8} ${x["price"] or "-":<9} {x["title"][:75]}')
