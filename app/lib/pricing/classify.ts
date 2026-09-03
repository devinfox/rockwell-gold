// Product classification: which pricing MODEL applies to an item.
//
// The deep-dive is explicit that rarity is not a computable factor —
// "there is no supported formula such as spot x rarity". Rarity enters as a
// human-managed premium or an outright asking price. So the engine's job is not
// to price a rare coin; it is to RECOGNISE one and refuse to price it from spot.
//
// Getting this wrong is asymmetric. Treating bullion as numismatic just means a
// stale price. Treating a numismatic as bullion means selling a $11,737 graded
// Eagle for $4,699 because it happens to contain one ounce of gold. Everything
// here therefore fails toward "do not auto-price".

export type PricingType =
  | "BULLION_SPOT"      // melt + percentage premium; fully dynamic
  | "SEMI_NUMISMATIC"   // melt + a managed DOLLAR premium; metal leg moves, collector leg doesn't
  | "TRUE_NUMISMATIC"   // merchant-set ask; spot is only a melt floor
  | "UNCLASSIFIED";     // insufficient signal — never auto-price

export interface Classification {
  type: PricingType;
  reasons: string[];
  /** "low" means a human should confirm before the item goes live. */
  confidence: "high" | "medium" | "low";
}

/** Pre-1933 US gold recall: the conventional cutoff for classic numismatics. */
const NUMISMATIC_YEAR_CUTOFF = 1933;

const RX = {
  graded: /\b(MS|PF|PR|AU|XF|EF|VF|F|VG|G)[- ]?\d{1,2}\b/i,
  holder: /\b(NGC|PCGS|CAC|ANACS|ICG)\b/i,
  ancient: /\b(ancient|roman|greek|byzantine|medieval|hammered)\b/i,
  pre33: /\bpre[- ]?(19)?33\b/i,
  proof: /\b(proof|burnished|reverse proof)\b/i,
  firstStrike: /\b(first strike|early release)\b/i,
  privy: /\b(privy|commemorative|lunar)\b/i,
  plainBullion: /\b(bar|bars|round|rounds|ingot|combibar|cast|minted)\b|\b(in|with|w\/)\s?assay\b/i,
  // 90% / 40% / 35% US coinage sold by face value, bag or roll. It trades as
  // bullion (metal value + a small dollar premium) even though every coin in
  // the bag is pre-1965: age is irrelevant, the silver is the product.
  junkSilver: /\b(90|40|35|80)\s?%\s*silver\b|\bjunk silver\b|\bface value\b|\$\d+\s*FV\b|\bwar nickels?\b/i,
  // Undated classics sold by the piece — "Morgan Silver Dollar (Random Year)",
  // "Peace Silver Dollar Cull". Melt still dominates; the desk sets a managed
  // collector premium rather than a market ask per date.
  randomYear: /\b(random year|random dates?|varied|our choice|\d{4}\s?-\s?\d{4})\b/i,
  circulatedGrade: /\b(cull|circulated|almost uncirculated|extra fine|very fine|fine|good)\b/i,
  modernBullionCoin: /\b(maple leaf|maple|britannia|philharmonic|kangaroo|nugget|koala|kookaburra|krugerrand|libertad|buffalo|eagle|sovereign|panda|noble|dragon|lunar|beasts?|wildlife|birds of prey|crocodile)\b/i,
};

export interface ClassifyInput {
  title?: string;
  year?: number | null;
  gradeFinish?: string | null;
  metal?: string;
}

export function classify(p: ClassifyInput): Classification {
  const title = p.title ?? "";
  const grade = p.gradeFinish ?? "";
  const both = `${title} ${grade}`;
  const reasons: string[] = [];

  // --- True numismatics: age and/or certified grade dominate metal value ---

  // "Ancient" wording also appears on modern themed bullion ("1 oz Silver Round
  // - Zeus (Greek Mythology Series)"), so an ancient claim only counts when the
  // item is not a generic round/bar/series piece.
  if (RX.ancient.test(title) && !RX.plainBullion.test(title) && !/\bseries\b/i.test(title)) {
    return { type: "TRUE_NUMISMATIC", reasons: ["ancient/medieval coinage"], confidence: "high" };
  }

  // Junk silver by face value / bag / roll: bullion regardless of the coin dates.
  if (RX.junkSilver.test(title)) {
    return { type: "BULLION_SPOT", reasons: ["90%/40%/35% silver sold by face value"], confidence: "high" };
  }

  // Random-year or grade-bucketed classics (Morgan/Peace dollars, Walking
  // Liberty halves, pre-33 sovereigns "Random Year"): the metal leg floats and
  // the desk manages a dollar premium — semi-numismatic, not a true rarity.
  const undatedClassic = RX.randomYear.test(title) && !/\b(bar|round)\b/i.test(title);
  if (undatedClassic && (p.year == null || p.year < NUMISMATIC_YEAR_CUTOFF)) {
    const certified = RX.holder.test(both) || RX.graded.test(both);
    if (!certified && (RX.circulatedGrade.test(both) || /\b(morgan|peace|walking liberty|franklin|kennedy|mercury|barber|sovereign|pesos?|dollar|half|dime|quarter)\b/i.test(title))) {
      return { type: "SEMI_NUMISMATIC", reasons: ["random-year / grade-bucket classic"], confidence: "medium" };
    }
  }

  // Rolls and bags of a common classic ("1941 Walking Liberty Half Dollar
  // 20-Coin Roll", "1964 Kennedy Half Dollar 20-Coin Roll") trade on metal
  // plus a managed premium, whatever the date on the coins.
  if (/\b(\d+)[- ]coin\b|\broll\b|\bbag\b/i.test(title) && !(RX.holder.test(both) || RX.graded.test(both))) {
    return { type: "SEMI_NUMISMATIC", reasons: ["roll/bag of common classic coinage"], confidence: "medium" };
  }

  // Modern US Mint collector strikes with no grade: 2021+ Morgan/Peace dollars,
  // American Liberty high-relief, First Spouse etc. Metal leg floats, desk
  // manages the collector leg.
  if (typeof p.year === "number" && p.year >= 2000 && /\b(morgan|peace|high relief|american liberty|first spouse|commemorative)\b/i.test(title)) {
    return { type: "SEMI_NUMISMATIC", reasons: ["modern collector strike"], confidence: "medium" };
  }

  // The catalog's `year` is null on ~28% of records; a leading date in the
  // title ("1797 $10 Turban Head Gold Eagle") is the next best evidence.
  const titleYear = Number(title.match(/^(?:pre-?)?(1[6-9]\d\d)\b/)?.[1] ?? NaN);
  const year = typeof p.year === "number" ? p.year : Number.isFinite(titleYear) ? titleYear : null;
  const old = year !== null && year < NUMISMATIC_YEAR_CUTOFF;
  if (old) reasons.push(`dated ${year} (pre-${NUMISMATIC_YEAR_CUTOFF})`);
  if (RX.pre33.test(title)) reasons.push("pre-33 designation");
  // Classic US gold by denomination/type ("$10 Turban Head", "$20 Liberty",
  // "$2.50 Indian Quarter Eagle"): recalled in 1933, priced per date and grade.
  const classicUsGold = /\$(?:1|2\.50|3|5|10|20)\s+(?:liberty|indian|turban|coronet|saint|st\.|gaudens|classic head|draped bust|capped bust)|\b(double eagle|half eagle|quarter eagle|turban head|coronet head|saint-gaudens|st\. gaudens)\b/i.test(title);
  if (classicUsGold && !old) reasons.push("classic pre-33 US gold type");

  if (old || RX.pre33.test(title) || classicUsGold) {
    // Age alone is enough: a 1904 Double Eagle is a collector item whether or
    // not it is slabbed, and its ask is set by date, mint and condition.
    if (RX.holder.test(both) || RX.graded.test(both)) reasons.push("certified grade");
    return { type: "TRUE_NUMISMATIC", reasons, confidence: "high" };
  }

  // A certified grade on a modern coin is semi-numismatic, not truly rare:
  // the metal leg still dominates and should track spot.
  const certified = RX.holder.test(both) || RX.graded.test(both);
  if (certified) reasons.push("certified/graded modern issue");

  const proofLike = RX.proof.test(both);
  if (proofLike) reasons.push("proof/burnished finish");
  if (RX.firstStrike.test(title)) reasons.push("first-strike label");
  if (RX.privy.test(title)) reasons.push("privy/commemorative issue");

  if (certified || proofLike || RX.firstStrike.test(title) || RX.privy.test(title)) {
    return { type: "SEMI_NUMISMATIC", reasons, confidence: certified ? "high" : "medium" };
  }

  // --- Plain bullion ---

  if (RX.plainBullion.test(title)) {
    return { type: "BULLION_SPOT", reasons: ["generic bar/round"], confidence: "high" };
  }

  if (/\b(BU|brilliant uncirculated|uncirculated)\b/i.test(grade) || /\bBU\b|\(BU\)|brilliant uncirculated/i.test(title)) {
    return { type: "BULLION_SPOT", reasons: ["BU/uncirculated bullion"], confidence: "high" };
  }

  // A recognised sovereign bullion coin series sold undated ("Random Year")
  // or with a plain modern date, and no grading/proof signal: ordinary bullion.
  if (RX.modernBullionCoin.test(title) && (RX.randomYear.test(title) || (typeof p.year === "number" && p.year >= 1979))) {
    return { type: "BULLION_SPOT", reasons: ["modern sovereign bullion coin series"], confidence: "medium" };
  }

  // Circulated common classics sold by grade bucket (no random-year wording).
  if (RX.circulatedGrade.test(both) && (p.year == null || p.year < NUMISMATIC_YEAR_CUTOFF)) {
    return { type: "SEMI_NUMISMATIC", reasons: ["grade-bucket classic coin"], confidence: "medium" };
  }

  // No positive signal either way. Do not guess.
  return {
    type: "UNCLASSIFIED",
    reasons: ["no grading, age or bullion signal"],
    confidence: "low",
  };
}
