// Builds app/data/products.json from the raw CSV exports in data/apmex/.
// Includes Gold, Silver, Platinum, Palladium, and genuine collectibles.
// Excludes empty packaging, boxes, and storage supplies.
// Run with: node scripts/build-products.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCES = [
  { file: "platinum.csv", mint: "Platinum Feed", mintSlug: "platinum-feed", dynamicMint: true },
  { file: "austrian_mint_gold.csv", mint: "Austrian Mint", mintSlug: "austrian-mint" },
  { file: "perth_mint.csv", mint: "Perth Mint", mintSlug: "perth-mint" },
  { file: "royal_canadian_mint.csv", mint: "Royal Canadian Mint", mintSlug: "royal-canadian-mint" },
  { file: "royal_canadian_mint_silver.csv", mint: "Royal Canadian Mint", mintSlug: "royal-canadian-mint" },
  { file: "royal_mint.csv", mint: "Royal Mint", mintSlug: "royal-mint" },
  { file: "us_mint.csv", mint: "U.S. Mint", mintSlug: "us-mint" },
  { file: "us_mint_silver.csv", mint: "U.S. Mint", mintSlug: "us-mint" },
  { file: "us_mint_gold.csv", mint: "U.S. Mint", mintSlug: "us-mint" },
  { file: "gold_catalog_2000.csv", mint: "World & Private Mints", mintSlug: "world-mints", dynamicMint: true },
  { file: "silver_catalog_2000.csv", mint: "World & Private Mints", mintSlug: "world-mints", dynamicMint: true },
];

// Minimal RFC-4180 CSV parser (quoted fields, embedded commas/quotes/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function isAccessoryOrSupply(title) {
  const t = title.toLowerCase();
  if (/^ogp box|\(empty\)|empty monster box|presentation box|^box for|\(no coin\)/i.test(t)) {
    return true;
  }
  if (/^(coin capsule|air-tite|quadrum|single coin|wooden presentation|presentation box|guardhouse|intercept|dansco|whitman|capsule direct fit|capsule w\/|empty monster box|storage box|display box for|velvet pouch|cotton gloves|magnifier|loupe|digital scale|cleaning cloth|coin tube|lighthouse round capsule)/i.test(t)) {
    return true;
  }
  if (/capsule -|capsules -|empty\s+(box|tube|folder|album|monster)|snaplock holder/i.test(t)) {
    return true;
  }
  return false;
}

function detectMint(title, brand, fallbackMint, fallbackSlug) {
  const t = title.toLowerCase();
  const b = (brand || "").toLowerCase();

  if (b.includes("pamp") || t.includes("pamp")) {
    return { mint: "PAMP Suisse", mintSlug: "pamp-suisse" };
  }
  if (b.includes("valcambi") || t.includes("valcambi")) {
    return { mint: "Valcambi", mintSlug: "valcambi" };
  }
  if (b.includes("baird") || t.includes("baird")) {
    return { mint: "Baird & Co.", mintSlug: "baird-co" };
  }
  if (b.includes("credit suisse") || t.includes("credit suisse")) {
    return { mint: "Credit Suisse", mintSlug: "credit-suisse" };
  }
  if (b.includes("engelhard") || t.includes("engelhard")) {
    return { mint: "Engelhard", mintSlug: "engelhard" };
  }
  if (b.includes("johnson matthey") || t.includes("johnson matthey")) {
    return { mint: "Johnson Matthey", mintSlug: "johnson-matthey" };
  }
  if (b.includes("scottsdale") || t.includes("scottsdale")) {
    return { mint: "Scottsdale Mint", mintSlug: "scottsdale-mint" };
  }
  if (b.includes("geiger") || t.includes("geiger")) {
    return { mint: "Geiger Edelmetalle", mintSlug: "geiger-edelmetalle" };
  }
  if (b.includes("sunshine") || t.includes("sunshine")) {
    return { mint: "Sunshine Minting", mintSlug: "sunshine-minting" };
  }
  if (b.includes("silvertowne") || t.includes("silvertowne")) {
    return { mint: "SilverTowne", mintSlug: "silvertowne" };
  }
  if (b.includes("germania") || t.includes("germania")) {
    return { mint: "Germania Mint", mintSlug: "germania-mint" };
  }
  if (b.includes("asahi") || t.includes("asahi")) {
    return { mint: "Asahi Refining", mintSlug: "asahi-refining" };
  }
  if (b.includes("heraeus") || t.includes("heraeus") || b.includes("argor") || t.includes("argor")) {
    return { mint: "Argor-Heraeus", mintSlug: "argor-heraeus" };
  }
  if (b.includes("golden state") || t.includes("golden state")) {
    return { mint: "Golden State Mint", mintSlug: "golden-state-mint" };
  }
  if (b.includes("nadir") || t.includes("nadir")) {
    return { mint: "Nadir Metal Refinery", mintSlug: "nadir-refinery" };
  }
  if (b.includes("igr") || t.includes("igr") || b.includes("istanbul") || t.includes("istanbul")) {
    return { mint: "Istanbul Gold Refinery (IGR)", mintSlug: "igr" };
  }
  if (b.includes("mexican") || b.includes("banco de mexico") || b.includes("casa de moneda") || t.includes("mexico") || t.includes("libertad") || t.includes("pesos")) {
    return { mint: "Mexican Mint", mintSlug: "mexican-mint" };
  }
  if (b.includes("apmex") || t.includes("apmex")) {
    return { mint: "APMEX", mintSlug: "apmex" };
  }
  if (b.includes("austrian") || t.includes("austria") || t.includes("philharmonic")) {
    return { mint: "Austrian Mint", mintSlug: "austrian-mint" };
  }
  if (b.includes("perth") || t.includes("perth") || t.includes("koala") || t.includes("kookaburra") || (t.includes("kangaroo") && t.includes("australia")) || (t.includes("australia") && !t.includes("austria"))) {
    return { mint: "Perth Mint", mintSlug: "perth-mint" };
  }
  if (b.includes("royal canadian") || b.includes("canada") || t.includes("royal canadian") || t.includes("rcm") || t.includes("maple") || t.includes("canada") || t.includes("snowy owl")) {
    return { mint: "Royal Canadian Mint", mintSlug: "royal-canadian-mint" };
  }
  if (b.includes("royal mint") || b.includes("british") || t.includes("royal mint") || t.includes("great britain") || t.includes("britannia") || t.includes("queen's beast") || t.includes("tudor")) {
    return { mint: "Royal Mint", mintSlug: "royal-mint" };
  }
  if (b.includes("u.s. mint") || b.includes("us mint") || t.includes("american") || t.includes("eagle") || t.includes("statue of liberty") || t.includes("us mint") || t.includes("u.s. mint") || /\b\d{4}-w\b/i.test(t)) {
    return { mint: "U.S. Mint", mintSlug: "us-mint" };
  }
  if (b.includes("pobjoy") || t.includes("pobjoy") || t.includes("isle of man") || t.includes("noble")) {
    return { mint: "Pobjoy Mint", mintSlug: "pobjoy-mint" };
  }
  if (b.includes("south african") || b.includes("rand") || t.includes("south africa") || t.includes("krugerrand") || t.includes("big five")) {
    return { mint: "South African Mint", mintSlug: "south-african-mint" };
  }
  if (b.includes("china") || t.includes("china") || t.includes("panda")) {
    return { mint: "China Mint", mintSlug: "china-mint" };
  }
  if (b.includes("new zealand") || t.includes("new zealand") || t.includes("niue")) {
    return { mint: "New Zealand Mint", mintSlug: "new-zealand-mint" };
  }
  if (b.includes("private") || t.includes("secondary market")) {
    return { mint: "Private Mint", mintSlug: "private-mint" };
  }
  if (fallbackMint && fallbackSlug && fallbackSlug !== "platinum-feed") {
    return { mint: fallbackMint, mintSlug: fallbackSlug };
  }
  return { mint: "World Mints", mintSlug: "world-mints" };
}

function detectMetal(title, metalNameCol) {
  const t = title.toLowerCase();
  const m = (metalNameCol || "").toLowerCase();

  // Platinum / Palladium
  if (/\b(platinum|plat|pt)\b/i.test(t) && !/\bgold\b/i.test(t)) return "platinum";
  if (/\b(palladium|pd)\b/i.test(t) && !/\bgold\b/i.test(t)) return "palladium";
  if (m === "platinum") return "platinum";
  if (m === "palladium") return "palladium";

  // Check Gold first
  if (/gold[- ]plated|gilded|gold foil|gold layered/i.test(t) && !/\b(solid gold|pure gold|\.9999\s*gold|\.999\s*gold|1 oz gold|1\/2 oz gold|1\/4 oz gold|1\/10 oz gold)\b/i.test(t)) {
    if (/\bsilver\b|\bag\b/i.test(t)) return "silver";
    return "other";
  }

  if (/\bgold\b/i.test(t) || /%\s*au\b|\.9999\s*au\b|au\s*999/i.test(t) || /\.9999\s*gold|\.999\s*gold|\.9167\s*gold/i.test(t)) return "gold";
  if (/double eagle|half eagle|quarter eagle|saint-gaudens|st\. gaudens/i.test(t)) return "gold";
  if (/\$(20|10|5|2\.50|1|50|3|4)\s+(liberty|indian|coronet|classic|panama|pan-pac|stella)/i.test(t)) return "gold";
  if (/(liberty head|indian head)\s+\$(20|10|5|2\.50|1)/i.test(t)) return "gold";
  if (/\b(18\d{2}|19[0-2]\d|193[0-3])\s+\$(20|10|5|2\.50|1|50)\b/i.test(t) && !/morgan|peace|barber|mercury|walking|seated|draped|capped|trade/i.test(t)) return "gold";
  if (/\b(sovereign|half sovereign|two sovereign|five sovereign|guinea|half guinea)\b/i.test(t)) return "gold";
  if (/\$100\s+(proof|bu|commem|olympic|unicef|constitution|peace|monarchy|national|parks|child|cameron|regina|glacier|library|cariboo|calgary|bowell|edmonton)/i.test(t)) return "gold";
  if (/\$(175|200|250|300|500|1250|2500)\s+/i.test(t) && !/silver|ag/i.test(t)) return "gold";
  if (/\.?99999\s+(pure\s+)?(gold|leaf|maple|call|howling|moose|grizzly|cougar|elk|bison|falcon|bear)/i.test(t) || /\.99999/.test(t)) return "gold";
  if (m === "gold") return "gold";

  // Silver
  if (/\bsilver\b/i.test(t) || /\b(ag|silv)\b/i.test(t)) return "silver";
  if (/morgan dollar|peace dollar|walking liberty|franklin half|barber|mercury dime|standing liberty|seated liberty|draped bust|capped bust|trade dollar|silver certificate/i.test(t)) return "silver";
  if (/roosevelt dime|washington quarter|kennedy half|booker t\.|washington-carver/i.test(t)) return "silver";
  if (/kookaburra|koala|swan|maple leaf|britannia|queen.?s beast|tudor beast/i.test(t) && !/\b(gold|plat|pt|pd)\b/i.test(t)) return "silver";
  if (m === "silver") return "silver";

  return "other";
}

function detectYear(title) {
  const m = title.match(/\b(1[789]\d{2}|20\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

const seen = new Set();
const products = [];
const stats = { perFile: {}, badges: {}, metals: {}, noImage: 0, noPrice: 0, dupes: 0, excluded: 0 };

for (const src of SOURCES) {
  const rows = parseCsv(readFileSync(join(root, "data/apmex", src.file), "utf8"));
  const header = rows[0];
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  let kept = 0;
  for (const r of rows.slice(1)) {
    const id = (r[col.product_id] || "").trim();
    const title = (r[col.title] || "").trim();
    if (!id || !title) continue;
    if (seen.has(id)) { stats.dupes++; continue; }
    seen.add(id);

    if (isAccessoryOrSupply(title)) {
      stats.excluded++;
      continue;
    }

    const brand = (r[col.brand] || "").trim();
    const priceRaw = parseFloat(r[col.price]);
    const price = Number.isFinite(priceRaw) ? priceRaw : null;
    const priceText = (r[col.price_text] || "").trim() || (price != null ? "$" + price.toLocaleString("en-US", { minimumFractionDigits: 2 }) : "");
    const badge = (r[col.badge] || "").trim();
    const image = (r[col.image_1] || r[col.primary_image] || "").trim();
    const metal = detectMetal(title, r[col.metal_name]);
    const year = detectYear(title);
    const mintInfo = src.dynamicMint ? detectMint(title, brand, src.mint, src.mintSlug) : { mint: src.mint, mintSlug: src.mintSlug };

    if (!image) stats.noImage++;
    if (price == null) stats.noPrice++;
    stats.badges[badge] = (stats.badges[badge] || 0) + 1;
    stats.metals[metal] = (stats.metals[metal] || 0) + 1;

    products.push({
      id,
      sku: (r[col.sku] || "").trim(),
      title,
      price,
      priceText,
      badge,
      mint: mintInfo.mint,
      mintSlug: mintInfo.mintSlug,
      image,
      metal,
      year,
    });
    kept++;
  }
  stats.perFile[src.file] = kept;
}

writeFileSync(join(root, "app/data/products.json"), JSON.stringify(products, null, 2));
console.log("Total live products built:", products.length);
console.log(JSON.stringify(stats, null, 2));
