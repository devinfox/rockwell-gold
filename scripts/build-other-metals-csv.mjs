// Generates data/other_metals_categorized.csv from raw CSV feeds
// without touching any application runtime code.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const SOURCES = [
  { file: "platinum.csv", mint: "Platinum Feed", mintSlug: "platinum-feed", dynamicMint: true },
  { file: "perth_mint.csv", mint: "The Perth Mint", mintSlug: "perth-mint" },
  { file: "royal_canadian_mint.csv", mint: "Royal Canadian Mint", mintSlug: "royal-canadian-mint" },
  { file: "royal_mint.csv", mint: "The Royal Mint", mintSlug: "royal-mint" },
  { file: "us_mint.csv", mint: "U.S. Mint", mintSlug: "us-mint" },
  { file: "us_mint_silver.csv", mint: "U.S. Mint", mintSlug: "us-mint" },
  { file: "us_mint_gold.csv", mint: "U.S. Mint", mintSlug: "us-mint" },
];

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
  if (/^ogp box|\(empty\)|empty monster box|presentation box|^box for|\(no coin\)/i.test(t)) return true;
  if (/^(coin capsule|air-tite|quadrum|single coin|wooden presentation|presentation box|guardhouse|intercept|dansco|whitman|capsule direct fit|capsule w\/|empty monster box|storage box|display box for|velvet pouch|cotton gloves|magnifier|loupe|digital scale|cleaning cloth|coin tube|lighthouse round capsule)/i.test(t)) return true;
  if (/capsule -|capsules -|empty\s+(box|tube|folder|album|monster)|snaplock holder/i.test(t)) return true;
  return false;
}

function detectMint(title, brand, fallbackMint, fallbackSlug) {
  const t = title.toLowerCase();
  const b = (brand || "").toLowerCase();

  if (b.includes("pamp") || t.includes("pamp")) return { mint: "PAMP Suisse", mintSlug: "pamp-suisse" };
  if (b.includes("valcambi") || t.includes("valcambi")) return { mint: "Valcambi", mintSlug: "valcambi" };
  if (b.includes("baird") || t.includes("baird")) return { mint: "Baird & Co.", mintSlug: "baird-co" };
  if (b.includes("credit suisse") || t.includes("credit suisse")) return { mint: "Credit Suisse", mintSlug: "credit-suisse" };
  if (b.includes("engelhard") || t.includes("engelhard")) return { mint: "Engelhard", mintSlug: "engelhard" };
  if (b.includes("johnson matthey") || t.includes("johnson matthey")) return { mint: "Johnson Matthey", mintSlug: "johnson-matthey" };
  if (b.includes("apmex") || t.includes("apmex")) return { mint: "APMEX", mintSlug: "apmex" };
  if (b.includes("austrian") || t.includes("austria") || t.includes("philharmonic")) return { mint: "Austrian Mint", mintSlug: "austrian-mint" };
  if (b.includes("perth") || t.includes("perth") || t.includes("koala") || t.includes("kookaburra") || (t.includes("kangaroo") && t.includes("australia")) || (t.includes("australia") && !t.includes("austria"))) return { mint: "The Perth Mint", mintSlug: "perth-mint" };
  if (b.includes("royal canadian") || b.includes("canada") || t.includes("royal canadian") || t.includes("rcm") || t.includes("maple") || t.includes("canada") || t.includes("snowy owl")) return { mint: "Royal Canadian Mint", mintSlug: "royal-canadian-mint" };
  if (b.includes("royal mint") || b.includes("british") || t.includes("royal mint") || t.includes("great britain") || t.includes("britannia") || t.includes("queen's beast") || t.includes("tudor")) return { mint: "The Royal Mint", mintSlug: "royal-mint" };
  if (b.includes("u.s. mint") || b.includes("us mint") || t.includes("american") || t.includes("eagle") || t.includes("statue of liberty") || t.includes("us mint") || t.includes("u.s. mint") || /\b\d{4}-w\b/i.test(t)) return { mint: "U.S. Mint", mintSlug: "us-mint" };
  if (b.includes("pobjoy") || t.includes("pobjoy") || t.includes("isle of man") || t.includes("noble")) return { mint: "Pobjoy Mint", mintSlug: "pobjoy-mint" };
  if (b.includes("south african") || b.includes("rand") || t.includes("south africa") || t.includes("krugerrand") || t.includes("big five")) return { mint: "South African Mint", mintSlug: "south-african-mint" };
  if (b.includes("china") || t.includes("china") || t.includes("panda")) return { mint: "China Mint", mintSlug: "china-mint" };
  if (b.includes("argor") || t.includes("argor")) return { mint: "Argor-Heraeus", mintSlug: "argor-heraeus" };
  if (b.includes("private") || t.includes("secondary market")) return { mint: "Private Mint", mintSlug: "private-mint" };
  if (fallbackMint && fallbackSlug && fallbackSlug !== "platinum-feed") return { mint: fallbackMint, mintSlug: fallbackSlug };
  return { mint: "World Mints", mintSlug: "world-mints" };
}

function isGoldProduct(title) {
  const t = title.toLowerCase();
  if (/gold[- ]plated|gilded|gold foil|gold layered/i.test(t) && !/\b(solid gold|pure gold|\.9999\s*gold|\.999\s*gold|1 oz gold|1\/2 oz gold|1\/4 oz gold|1\/10 oz gold)\b/i.test(t)) {
    return false;
  }
  if (/\bgold\b/i.test(t) || /%\s*au\b|\.9999\s*au\b|au\s*999/i.test(t) || /\.9999\s*gold|\.999\s*gold|\.9167\s*gold/i.test(t)) return true;
  if (/double eagle|half eagle|quarter eagle|saint-gaudens|st\. gaudens/i.test(t)) return true;
  if (/\$(20|10|5|2\.50|1|50|3|4)\s+(liberty|indian|coronet|classic|panama|pan-pac|stella)/i.test(t)) return true;
  if (/(liberty head|indian head)\s+\$(20|10|5|2\.50|1)/i.test(t)) return true;
  if (/\b(18\d{2}|19[0-2]\d|193[0-3])\s+\$(20|10|5|2\.50|1|50)\b/i.test(t) && !/morgan|peace|barber|mercury|walking|seated|draped|capped|trade/i.test(t)) return true;
  if (/\b(sovereign|half sovereign|two sovereign|five sovereign|guinea|half guinea)\b/i.test(t)) return true;
  if (/\$100\s+(proof|bu|commem|olympic|unicef|constitution|peace|monarchy|national|parks|child|cameron|regina|glacier|library|cariboo|calgary|bowell|edmonton)/i.test(t)) return true;
  if (/\$(175|200|250|300|500|1250|2500)\s+/i.test(t) && !/silver|ag/i.test(t)) return true;
  if (/\.?99999\s+(pure\s+)?(gold|leaf|maple|call|howling|moose|grizzly|cougar|elk|bison|falcon|bear)/i.test(t) || /\.99999/.test(t)) return true;
  return false;
}

function detectMetal(title) {
  const t = title.toLowerCase();
  if (/\b(platinum|plat|pt)\b/i.test(t) && !/\bgold\b/i.test(t)) return "Platinum";
  if (/\b(palladium|pd)\b/i.test(t) && !/\bgold\b/i.test(t)) return "Palladium";
  if (/\bsilver\b/i.test(t) || /\b(ag|silv)\b/i.test(t)) return "Silver";
  if (/morgan dollar|peace dollar|walking liberty|franklin half|barber|mercury dime|standing liberty|seated liberty|draped bust|capped bust|trade dollar|silver certificate/i.test(t)) return "Silver";
  if (/roosevelt dime|washington quarter|kennedy half|booker t\.|washington-carver/i.test(t)) return "Silver";
  if (/copper|clad|nickel|bronze|brass|steel|zinc|cupro-nickel|lenticular|keepsake card|loonie|toonie|peppa pig|stranger things|teenage mutant ninja|tmnt|eisenhower dollar/i.test(t)) return "Base Metal / Clad";
  return "Silver / Collectible";
}

function detectWeight(title) {
  const m = title.match(/\b(\d+(?:\.\d+)?\s*(?:kilo|kg|oz|gram|g|grain))\b/i) || title.match(/\b(1\/(?:2|4|10|20|25)\s*oz)\b/i);
  return m ? m[1].toLowerCase() : "";
}

function detectPurity(title, metal) {
  if (/\.99999|99999/i.test(title)) return ".99999 Ultra Fine";
  if (/\.9999|99\.99%|9999/i.test(title)) return ".9999 Fine";
  if (/\.999|99\.9%|999\s*(fine)?/i.test(title)) return ".999 Fine";
  if (/\.9995|99\.95%/i.test(title)) return ".9995 Fine";
  if (/sterling|\.925|92\.5%/i.test(title)) return ".925 Sterling";
  if (/morgan|peace dollar|walking liberty|franklin half|barber|mercury dime|standing liberty|1932-1964|1946-1964/i.test(title)) return "90% Silver";
  if (/40%|1965-1970/i.test(title)) return "40% Silver";
  if (metal === "Silver") return ".999 Silver (Standard)";
  if (metal === "Platinum") return ".9995 Platinum";
  if (metal === "Palladium") return ".9995 Palladium";
  return "";
}

function detectYear(title) {
  const m = title.match(/\b(1[789]\d{2}|20\d{2})\b/);
  return m ? m[1] : "";
}

function detectProductType(title) {
  const t = title.toLowerCase();
  if (/\b(bar|bars|ingot|ingots)\b/i.test(t)) return "Bar";
  if (/\b(round|rounds)\b/i.test(t)) return "Round";
  if (/\b(roll|rolls|tube|tubes|bag|bags|monster box)\b/i.test(t)) return "Roll / Bulk";
  if (/proof set|mint set|coin set|commemorative set|fractional set|collection set/i.test(t)) return "Coin Set";
  if (/medal|token|badge|pin/i.test(t)) return "Medal / Token";
  return "Coin";
}

function detectGrade(title) {
  const m = title.match(/\b(MS-?70|PF-?70|PR-?70|SP-?70|MS-?69|PF-?69|PR-?69|MS-?68|MS-?67|MS-?66|MS-?65|MS-?64|MS-?63|MS-?62|MS-?61|MS-?60|AU-?58|AU-?55|AU-?50|XF-?45|XF-?40|VF-?35|VF-?30|VF-?20|Fine|VG|Good|BU|Gem Proof|Proof|Specimen|Reverse Proof|DCAM|CAM)\b/i);
  return m ? m[1].toUpperCase() : "Uncirculated / Standard";
}

function detectSubcategory(title, mintSlug, metal) {
  const t = title.toLowerCase();

  // PLATINUM
  if (metal === "Platinum") {
    if (/american\s+(platinum\s+)?eagle|platinum\s+eagle|\bstatue of liberty\b/i.test(t) || (mintSlug === "us-mint" && /eagle/i.test(t))) {
      if (/proof/i.test(t)) return "Proof American Platinum Eagles";
      if (/burnished/i.test(t)) return "Burnished American Platinum Eagles";
      if (/set/i.test(t)) return "American Platinum Eagle Sets";
      return "American Platinum Eagles";
    }
    if (/pamp/i.test(t) || (mintSlug === "pamp-suisse" && /bar/i.test(t))) return "PAMP Suisse Platinum Bars";
    if (/valcambi/i.test(t) || (mintSlug === "valcambi" && /bar/i.test(t))) return "Valcambi Platinum Bars";
    if (/apmex/i.test(t) || mintSlug === "apmex") return "APMEX Platinum Bars";
    if (/credit suisse/i.test(t) || mintSlug === "credit-suisse") return "Credit Suisse Platinum Bars";
    if (/baird/i.test(t) || mintSlug === "baird-co") return "Baird & Co. Platinum Bars";
    if (/philharmonic/i.test(t) || mintSlug === "austrian-mint") return "Austrian Platinum Philharmonics";
    if (/maple/i.test(t) || mintSlug === "royal-canadian-mint") return "Platinum Maple Leafs & Canadian Sets";
    if (/koala/i.test(t)) return "Platinum Koalas";
    if (/kookaburra/i.test(t)) return "Platinum Kookaburras";
    if (/kangaroo/i.test(t)) return "Platinum Kangaroos";
    if (/lunar|year of/i.test(t)) return "Platinum Lunar Series";
    if (/britannia/i.test(t) || mintSlug === "royal-mint") return "Platinum Britannias & Royal Mint";
    if (/noble/i.test(t) || mintSlug === "pobjoy-mint") return "Isle of Man Platinum Nobles";
    if (/panda/i.test(t) || mintSlug === "china-mint") return "Chinese Platinum Pandas";
    if (/big five|elephant|krugerrand/i.test(t) || mintSlug === "south-african-mint") return "South African Platinum";
    if (/\b(bar|bars|ingot)\b/i.test(t)) return "Platinum Bars & Rounds";
    if (/round/i.test(t)) return "Platinum Rounds";
    return "Platinum Collectibles";
  }

  // PALLADIUM
  if (metal === "Palladium") {
    if (/eagle/i.test(t)) return "Palladium Eagles";
    if (/maple/i.test(t)) return "Palladium Maple Leafs";
    if (/bar/i.test(t)) return "Palladium Bars";
    return "Palladium Collectibles";
  }

  // US MINT SILVER / OTHER
  if (mintSlug === "us-mint") {
    if (/american\s+(silver\s+)?eagle|silver\s+eagle|\base\b/i.test(t)) return "American Silver Eagles";
    if (/morgan/i.test(t)) return "Morgan Silver Dollars";
    if (/peace dollar/i.test(t)) return "Peace Silver Dollars";
    if (/walking liberty/i.test(t)) return "Walking Liberty Half Dollars";
    if (/franklin half/i.test(t)) return "Franklin Half Dollars";
    if (/barber/i.test(t)) return "Barber Dimes / Quarters / Halves";
    if (/mercury dime/i.test(t)) return "Mercury Dimes";
    if (/standing liberty/i.test(t)) return "Standing Liberty Quarters";
    if (/washington quarter/i.test(t)) return "Washington Quarters";
    if (/roosevelt dime/i.test(t)) return "Roosevelt Dimes";
    if (/kennedy/i.test(t)) return "Kennedy Half Dollars";
    if (/silver certificate|currency/i.test(t)) return "U.S. Paper Currency";
    if (/proof set|mint set|silver set/i.test(t)) return "U.S. Mint Silver Proof Sets";
    if (/commemorative|commem/i.test(t)) return "U.S. Silver Commemoratives";
    if (/bar/i.test(t)) return "U.S. Silver Bars";
    return "U.S. Silver Collectibles";
  }

  // PERTH MINT SILVER
  if (mintSlug === "perth-mint") {
    if (/kookaburra/i.test(t)) return "Silver Kookaburras";
    if (/koala/i.test(t)) return "Silver Koalas";
    if (/lunar|year of the/i.test(t)) return "Silver Lunar Series";
    if (/kangaroo/i.test(t)) return "Silver Kangaroos";
    if (/swan/i.test(t)) return "Silver Swans";
    if (/wedge-tailed eagle|wedge tailed/i.test(t)) return "Wedge-Tailed Eagles";
    if (/dragon|tiger|phoenix/i.test(t)) return "Perth Mythological & Rectangular Series";
    if (/bar/i.test(t)) return "Perth Silver Bars";
    if (/james bond|007/i.test(t)) return "James Bond 007 Series";
    if (/star trek|simpsons|batman|superman|disney/i.test(t)) return "Perth Pop Culture Collectibles";
    return "Perth Silver Collectibles";
  }

  // ROYAL MINT SILVER
  if (mintSlug === "royal-mint") {
    if (/britannia/i.test(t)) return "Silver Britannias";
    if (/queen.?s beast/i.test(t)) return "Queen's Beasts Silver";
    if (/tudor/i.test(t)) return "Tudor Beasts Silver";
    if (/myths|legends|robin hood|maid marian|little john|king arthur|merlin|morgan le fay/i.test(t)) return "Myths & Legends Silver";
    if (/sovereign/i.test(t)) return "Silver Sovereigns";
    if (/music legends|david bowie|elton john|queen|freddie|rolling stones|police|wham|spice girls|pink floyd/i.test(t)) return "Music Legends Silver";
    if (/royal arms|city views|great engravers|gothic/i.test(t)) return "Royal Heritage & Arms";
    if (/bar/i.test(t)) return "Royal Mint Silver Bars";
    return "Royal Mint Silver Collectibles";
  }

  // ROYAL CANADIAN MINT SILVER
  if (mintSlug === "royal-canadian-mint") {
    if (/maple/i.test(t)) return "Silver Maple Leafs";
    if (/wildlife|wolf|grizzly|cougar|moose|falcon|bison|elk|bear|polar|owl|animal|bald eagle|arctic fox|superleaf/i.test(t)) return "Canadian Wildlife Series";
    if (/birds of canada|colorful birds|bird/i.test(t)) return "Birds of Canada Series";
    if (/canadian mosaic|geometry|superman|star trek|batman/i.test(t)) return "RCM Pop Culture & Special Proofs";
    if (/canadian landscape|national park|wondrous waters|heritage/i.test(t)) return "Canadian Heritage & Landscapes";
    if (/pysanka/i.test(t)) return "Pysanka Easter Egg Series";
    if (/bar/i.test(t)) return "RCM Silver Bars";
    if (/proof set|specimen set|uncirculated set|gift set/i.test(t)) return "RCM Proof & Specimen Sets";
    return "RCM Silver Collectibles";
  }

  return "General Collectibles";
}

function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const seen = new Set();
const records = [];

for (const src of SOURCES) {
  const rows = parseCsv(readFileSync(join(root, "data/apmex", src.file), "utf8"));
  const header = rows[0];
  const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
  for (const r of rows.slice(1)) {
    const id = (r[col.product_id] || "").trim();
    const title = (r[col.title] || "").trim();
    if (!id || !title) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    if (isAccessoryOrSupply(title)) continue;
    if (isGoldProduct(title)) continue;

    const brand = (r[col.brand] || "").trim();
    const mintInfo = src.dynamicMint ? detectMint(title, brand, src.mint, src.mintSlug) : { mint: src.mint, mintSlug: src.mintSlug };
    const metal = detectMetal(title);
    const weight = detectWeight(title);
    const purity = detectPurity(title, metal);
    const year = detectYear(title);
    const productType = detectProductType(title);
    const grade = detectGrade(title);
    const subcategory = detectSubcategory(title, mintInfo.mintSlug, metal);
    const priceRaw = parseFloat(r[col.price]);
    const price = Number.isFinite(priceRaw) ? priceRaw.toFixed(2) : "";
    const priceText = (r[col.price_text] || "").trim() || (price !== "" ? "$" + Number(price).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "");
    const badge = (r[col.badge] || "").trim();
    const image = (r[col.image_1] || r[col.primary_image] || "").trim();

    records.push({
      product_id: id,
      sku: (r[col.sku] || "").trim(),
      title,
      mint: mintInfo.mint,
      mint_slug: mintInfo.mintSlug,
      metal,
      purity,
      weight_oz: weight,
      year,
      product_type: productType,
      category: `${metal} Bullion & Numismatics`,
      sub_category: subcategory,
      grade,
      price,
      price_text: priceText,
      badge,
      image_url: image
    });
  }
}

const csvHeader = [
  "product_id",
  "sku",
  "title",
  "mint",
  "mint_slug",
  "metal",
  "purity",
  "weight_oz",
  "year",
  "product_type",
  "category",
  "sub_category",
  "grade",
  "price",
  "price_text",
  "badge",
  "image_url"
];

const csvRows = [csvHeader.join(",")];
for (const r of records) {
  csvRows.push(csvHeader.map(k => escapeCsv(r[k])).join(","));
}

const outputPath = join(root, "data/other_metals_categorized.csv");
writeFileSync(outputPath, csvRows.join("\n"), "utf8");

console.log(`Generated ${records.length} categorized records at: data/other_metals_categorized.csv`);
