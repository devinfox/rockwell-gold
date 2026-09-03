import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import SiteNav from "../../components/site-nav";
import SiteFooter from "../../components/site-footer";
import PdpRuntime from "../../components/pdp-runtime";
import { availOf, metalHref, mintHref } from "../../data/catalog";
import { findProduct, metalLabel, pdpFill, relatedTo } from "../../data/pdp-fill";
import { livePriceFor, livePricesFor } from "../../lib/pricing/live";
import { railSurcharge } from "../../lib/pricing/rules";
import { symbolForMetal } from "../../lib/spot";
import { TilePrice } from "../../components/catalog-page";
import "../product.css";

// Quotes are computed against the shared spot mark on every request (the mark
// itself is memoised for 60s server-side), so this page cannot be static.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/product/[id]">): Promise<Metadata> {
  const { id } = await params;
  const p = findProduct(id);
  if (!p) return { title: "Product — Rockwell Metals" };

  // The live price is in the card image (opengraph-image.tsx); the text stays
  // price-free so a cached description never contradicts the mark.
  const metalWord = p.metal.charAt(0).toUpperCase() + p.metal.slice(1);
  const title = `${p.title} — Rockwell Metals`;
  const description = `Buy the ${p.title} at a live spot-linked price. ${p.mint} · SKU ${p.sku}${p.metalContent ? ` · ${p.metalContent}` : ""}. 120-second price lock, allocated vault custody or insured armored delivery, serial-level custody passport, instant sell-back.`;
  return {
    title,
    description,
    alternates: { canonical: `/product/${p.id}` },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/product/${p.id}`,
      siteName: "Rockwell Metals",
    },
    twitter: { card: "summary_large_image", title, description },
    other: { "product:category": `${metalWord} bullion` },
  };
}

const fmt = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function Page({ params }: PageProps<"/product/[id]">) {
  const { id } = await params;
  const p = findProduct(id);
  if (!p) notFound();

  const fill = pdpFill(p);
  const related = relatedTo(p);

  // Live pricing (launch set). `lp` is null for products outside the rule book,
  // which then fall back to the static snapshot price; "enquire" means the
  // engine deliberately declined to price this piece from spot.
  const lp = await livePriceFor(p);
  const relatedLive = await livePricesFor(related);
  const liveOk = !!lp && lp.mode !== "enquire";
  const enquireOnly = !!lp && lp.mode === "enquire";
  // Buyable only when the engine prices it AND it is in stock. The static
  // snapshot price is never a fallback (99 of them sit below melt), and an
  // out-of-stock piece must not show "Buy now" (audit: High).
  const outOfStock = fill.avail.key === "notify" || fill.avail.key === "out";
  const priced = liveOk && !outOfStock;
  const unitCash = liveOk ? lp!.cashPrice : (p.price ?? 0);
  const priceText = priced ? fmt(unitCash) : "—";
  const cardFee = railSurcharge("card");
  const tierRows = liveOk
    ? lp!.tiers.map((t) => ({ label: t.label, qty: t.minQty, unit: t.unitCash, mult: t.unitCash / lp!.cashPrice }))
    : [
        { label: "1–4", qty: 1, unit: unitCash, mult: 1 },
        { label: "5–19", qty: 5, unit: unitCash * 0.99, mult: 0.99 },
        { label: "20+", qty: 20, unit: unitCash * 0.98, mult: 0.98 },
      ];
  const asOfLabel = lp?.asOf ? new Date(lp.asOf).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }) + " ET" : null;
  const metal = metalLabel(p.metal);
  const metalPath = metalHref(p);
  const mintPath = mintHref(p);
  const gallery = p.images && p.images.length > 1 ? p.images : null;
  const metaLine = [p.year, p.mint, metal, `SKU ${p.sku}`].filter(Boolean).join(" · ");
  // The per-product "day move" was a seeded random number, not a real price
  // change (audit F-01/F-05). Removed until prices are spot-linked.

  const site = process.env.NEXT_PUBLIC_SITE_URL || "https://rockwellmetals.com";

  // Product + BreadcrumbList structured data. Without this a 25,457-page
  // catalog produces no rich results at all (audit T-02). Only fields that are
  // genuinely present are emitted — no invented ratings or review counts.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        name: p.title,
        sku: p.sku,
        image: p.image ? [p.image] : undefined,
        description: p.shortSummary || undefined,
        brand: p.mint ? { "@type": "Brand", name: p.mint } : undefined,
        material: metal,
        ...(priced
          ? {
              offers: {
                "@type": "Offer",
                price: +unitCash.toFixed(2),
                priceCurrency: "USD",
                availability: (
                  {
                    stock: "https://schema.org/InStock",
                    sale: "https://schema.org/InStock",
                    top: "https://schema.org/InStock",
                    pre: "https://schema.org/PreOrder",
                    enquire: "https://schema.org/LimitedAvailability",
                    notify: "https://schema.org/OutOfStock",
                    out: "https://schema.org/OutOfStock",
                  } as Record<string, string>
                )[fill.avail.key] ?? "https://schema.org/InStock",
                url: `${site}/product/${p.id}`,
                seller: { "@type": "Organization", name: "Rockwell Metals" },
              },
            }
          : {}),
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: site },
          { "@type": "ListItem", position: 2, name: metal, item: `${site}${metalPath}` },
          { "@type": "ListItem", position: 3, name: p.title, item: `${site}/product/${p.id}` },
        ],
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteNav current={metalPath} />

      <main className="wrap pdp__wrap">
        <nav className="crumbs num" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href={metalPath}>{metal}</Link>
          <span aria-hidden="true">/</span>
          <Link href={mintPath}>{p.mint}</Link>
          <span aria-hidden="true">/</span>
          <span aria-current="page">{p.title}</span>
        </nav>

        {/* pdp head: gallery (left) + buy box (right) */}
        <section className="pdp__head">
          <div className="gallery">
            <div className="gallery__stage gallery__stage--photo" data-stage="">
              <div className="gallery__halo" aria-hidden="true"></div>
              <span className="gallery__live"><span className="tag__pulse" aria-hidden="true"></span> {fill.avail.label.toLowerCase()}</span>
              <span className="gallery__badge num"><span className="gallery__badge-k">{metal}</span>{p.year ? ` · ${p.year}` : ""}</span>
              <Image
                className="gallery__img"
                src={p.image}
                alt={p.title}
                width={720}
                height={720}
                sizes="(max-width: 900px) 92vw, 560px"
                quality={80}
                priority
                data-stage-img=""
              />
              <span className="gallery__zoom num" data-zoom-label="">{gallery ? `View 1 of ${gallery.length}` : "Obverse · front of piece"}</span>
            </div>
            {/* Only render thumbnails when there are genuinely multiple angles.
                The fallback previously repeated the same photo four times under
                the labels Obverse / Reverse / Macro / In vault (audit B-05).
                Each thumb carries the full-size URL from the catalog gallery;
                pdp.js swaps it into [data-stage-img] and updates the caption. */}
            {gallery && (
              <ul className="thumbs" aria-label="Product views">
                {gallery.map((imgUrl, idx) => (
                  <li key={imgUrl}>
                    <button
                      type="button"
                      className={`thumb ${idx === 0 ? "thumb--on" : ""}`}
                      data-src={imgUrl}
                      data-label={`View ${idx + 1} of ${gallery.length}`}
                      aria-label={`Show view ${idx + 1} of ${gallery.length}`}
                      aria-pressed={idx === 0 ? "true" : "false"}
                    >
                      <Image src={imgUrl} alt="" width={72} height={72} quality={60} />
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <ul className="assure num" aria-label="Assurances">
              <li><span className="assure__k">Assay</span> XRF + ultrasonic</li>
              <li><span className="assure__k">Custody</span> Allocated · insured</li>
              <li><span className="assure__k">Sell-back</span> Spot-linked, instant</li>
            </ul>
          </div>

          {/* buy box */}
          <div
            className="buybox"
            data-price={priced ? unitCash.toFixed(2) : ""}
            data-spot-used={liveOk ? lp!.spotUsed : ""}
            data-live-id={lp && lp.mode === "live" ? p.id : undefined}
            data-mode={lp?.mode ?? ""}
            data-metal={symbolForMetal(p.metal) ?? ""}
            data-card-fee={cardFee}
            data-name={p.title.slice(0, 26)}
            data-serial={fill.serial}
          >
            <p className="eyebrow"><span className="eyebrow__dot" aria-hidden="true"></span> {lp?.mode === "live" ? "Spot-linked" : lp?.mode === "fixed" ? "Market ask" : "Live market"} · {fill.avail.label.toLowerCase()}</p>
            <h1 className="buybox__title">{p.title}</h1>
            <p className="buybox__meta num">{metaLine}</p>

            {p.shortSummary && (
              <div className="buybox__summary">
                <p className="buybox__summary-text">{p.shortSummary}</p>
              </div>
            )}

            <div className="buybox__proof num">
              {p.purity && <span className="muted">{p.purity} fine</span>}
              {p.metalContent && <span className="muted">· {p.metalContent}</span>}
              {p.iraEligible === "Yes" && <span className="muted">· IRA eligible</span>}
            </div>

            <div className="price">
              <div className="price__row">
                <span className="price__now num" data-pdp-price="">{enquireOnly ? "Quote on request" : priceText}</span>
              </div>
              {priced ? (
                <>
                  <p className="price__break num">
                    <span data-pdp-unit="">{priceText}</span> / item · cash price ·
                    {" "}{p.mint} · <b>{fill.avail.label}</b>
                  </p>
                  {liveOk && (
                    /* Metal value, premium and total shown separately — the
                       deep dive's disclosure guardrail for investment sales. */
                    <dl className="price__build num" title={lp!.explain}>
                      <dt>Metal value</dt>
                      <dd><b data-pdp-melt="">{fmt(lp!.meltValue)}</b> · {lp!.fineOz} oz fine</dd>
                      <dt>Premium</dt>
                      <dd><b data-pdp-premium="">{fmt(lp!.premiumUsd)} ({(lp!.premiumPct * 100).toFixed(1)}% over spot)</b></dd>
                      <dt>Spot</dt>
                      <dd><span data-pdp-spot="">{fmt(lp!.spotUsed)} /oz</span>{asOfLabel ? <> · as of <span data-pdp-asof="">{asOfLabel}</span></> : null}</dd>
                      <dd className={`price__build-mode price__build-mode--${lp!.meltFloorBinding ? "warn" : lp!.mode}`}>
                        {lp!.mode === "live"
                          ? `Spot-linked · requotes automatically${lp!.indicative ? " · indicative (feed refreshing)" : ""}`
                          : lp!.meltFloorBinding
                            ? "Priced at metal floor · ask under review"
                            : "Fixed market ask · melt floor monitored"}
                      </dd>
                    </dl>
                  )}
                  {/* Counts down from the last quote; at zero pdp.js re-quotes
                      and restarts, so the clock only ever describes a price
                      that is actually current. */}
                  <div className="lock" data-lock="">
                    <span className="lock__clock num" data-lock-clock="" role="timer" aria-label="Time until this price is re-quoted">02:00</span>
                    <span className="lock__bar" aria-hidden="true"><i data-lock-bar=""></i></span>
                    <span className="lock__note num" data-lock-note="">Price held · <b>re-quotes at zero</b></span>
                  </div>
                </>
              ) : enquireOnly ? (
                <p className="price__break num">{lp!.explain}</p>
              ) : (
                <p className="price__break num">Out of stock · notifications open</p>
              )}
            </div>

            <fieldset className="opt">
              <legend className="opt__label">Volume tier</legend>
              <div className="tiers" role="radiogroup" aria-label="Quantity tier">
                {/* Quantity trims the premium, never the metal leg; the ladder
                    comes from the quote engine and is re-read by pdp.js. */}
                {tierRows.map((t, i) => (
                  <button
                    key={t.label}
                    type="button"
                    className={`tier${i === 0 ? " tier--on" : ""}`}
                    data-qty={t.qty}
                    data-mult={t.mult.toFixed(6)}
                    aria-checked={i === 0 ? "true" : "false"}
                    role="radio"
                    tabIndex={i === 0 ? 0 : -1}
                  >
                    <span className="tier__q num">{t.label}</span>
                    <span className="tier__p num">{priced ? fmt(t.unit) : "—"}</span>
                    <span className={`tier__tag num${i === 0 || t.mult >= 0.9995 ? "" : " tier__tag--save"}`}>
                      {i === 0 ? "retail" : t.mult >= 0.9995 ? "same" : `−${((1 - t.mult) * 100).toFixed(1)}%`}
                    </span>
                  </button>
                ))}
              </div>
              {priced && (
                /* The quantity that actually reaches checkout. pdp.js keeps the
                   tier highlight and the CTA subtotal in step with it, and
                   pdp-runtime reads [data-qty-input] when the lock is created. */
                <div className="qty">
                  <span className="qty__label" id="pdp-qty-label">Quantity</span>
                  <div className="qty__stepper" role="group" aria-labelledby="pdp-qty-label">
                    <button type="button" data-qty-dec="" aria-label="Decrease quantity">−</button>
                    <input
                      className="num"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={999}
                      step={1}
                      defaultValue={1}
                      aria-label="Quantity"
                      data-qty-input=""
                    />
                    <button type="button" data-qty-inc="" aria-label="Increase quantity">+</button>
                  </div>
                  <span className="qty__sub num">Subtotal <b data-pdp-subtotal="">{priceText}</b></span>
                </div>
              )}
            </fieldset>

            <fieldset className="opt">
              <legend className="opt__label">Settlement method</legend>
              <div className="pays" role="radiogroup" aria-label="Payment method">
                {/* data-rail is the PayMethod enum the checkout lock carries. */}
                <button type="button" className="pay pay--on" data-pay="crypto" data-rail="CRYPTO" data-fee={railSurcharge("crypto")} aria-checked="true" role="radio" tabIndex={0}>
                  <span className="pay__k">Crypto / USDC</span>
                  <span className="pay__fee num">cash price · instant</span></button>
                <button type="button" className="pay" data-pay="wire" data-rail="WIRE" data-fee={railSurcharge("wire")} aria-checked="false" role="radio" tabIndex={-1}>
                  <span className="pay__k">Fedwire / ACH</span>
                  <span className="pay__fee num">cash price</span></button>
                <button type="button" className="pay" data-pay="card" data-rail="CARD" data-fee={cardFee} aria-checked="false" role="radio" tabIndex={-1}>
                  <span className="pay__k">Card</span>
                  <span className="pay__fee num">+{(cardFee * 100).toFixed(1)}% · list price</span></button>
              </div>
              <p className="pay__note num" data-pay-note="">Crypto settlement — best available price. Card price is the cash price ÷ 0.96.</p>
            </fieldset>

            <fieldset className="opt">
              <legend className="opt__label">After purchase</legend>
              <div className="custody" role="radiogroup" aria-label="Custody choice">
                {/* data-custody is the Custody enum the checkout lock carries. */}
                <button type="button" className="cust cust--on" data-cust="vault" data-custody="VAULT" aria-checked="true" role="radio" tabIndex={0}>
                  <span className="cust__k">Store in vault</span>
                  <span className="cust__v num">allocated · insured · free yr 1</span></button>
                <button type="button" className="cust" data-cust="ship" data-custody="DELIVERY" aria-checked="false" role="radio" tabIndex={-1}>
                  <span className="cust__k">Insured delivery</span>
                  <span className="cust__v num">discreet · 2-day · fully insured</span></button>
              </div>
            </fieldset>

            <div className="buybox__cta">
              {priced ? (
                <>
                  <button className="btn btn--gold btn--lg" type="button">Buy now · lock <span className="num" data-pdp-subtotal="">{priceText}</span></button>
                  <button className="btn btn--ghost btn--lg" type="button">Make an offer</button>
                </>
              ) : enquireOnly ? (
                <>
                  <button className="btn btn--gold btn--lg" type="button">Request a quote</button>
                  <button className="btn btn--ghost btn--lg" type="button">Notify me on restock</button>
                </>
              ) : (
                <>
                  <button className="btn btn--gold btn--lg" type="button">Notify me on restock</button>
                  <button className="btn btn--ghost btn--lg" type="button">Request a quote</button>
                </>
              )}
            </div>
            <p className="buybox__fine num">Price holds through checkout · KYC at first purchase · cancel before settlement</p>
          </div>
        </section>

        {/* vault passport */}
        <section className="section--pdp">
          <div className="block__head">
            <span className="section__index num">A1 / Vault Passport</span>
            <h2 className="block__title">Provable down to the metal.</h2>
            <p className="block__sub">Every piece ships with a live custody passport — serial-matched, assay-logged, and re-verified against the Rockwell ledger on a timer. Verification is the product.</p>
          </div>

          <div className="passport passport--pdp">
            <div className="passport__head">
              <span className="passport__k">Custody receipt · Rockwell verified</span>
              <span className="passport__live"><span className="tag__pulse" aria-hidden="true"></span> checked against <b>your ledger</b> on request</span>
            </div>
            <div className="passport__rows num">
              <div><span>Rockwell ID</span><b>{fill.serial}</b></div>
              <div><span>Assay method</span><b>XRF + ultrasonic</b></div>
              <div><span>Serial status</span><b className="passport__ok">Sealed · matched</b></div>
              <div><span>Grade</span><b className="passport__ok">{fill.grade}</b></div>
              <div><span>Chain of custody</span><b>{p.mint} → Rockwell vault</b></div>
              <div><span>Insurance</span><b className="passport__ok">Lloyd&apos;s · to $250M</b></div>
            </div>
            <div className="passport__verify">
              <input className="passport__input num" type="text" defaultValue={fill.serial} aria-label="Serial to verify" data-verify-input />
              <button className="btn btn--ghost passport__btn" type="button" data-verify-btn>Verify serial</button>
              <span className="passport__result num" data-verify-result=""></span>
            </div>
          </div>
        </section>

        {/* A2: Product Overview, 4-Layer Narrative & Numismatic Analysis */}
        <section className="section--pdp">
          <div className="block__head">
            <span className="section__index num">A2 / Product Overview & Numismatic Analysis</span>
            <h2 className="block__title">The Complete Record.</h2>
            <p className="block__sub">Authored numismatic breakdown, artistic provenance, and institutional custody proof.</p>
          </div>

          <div className="pdp__narrative-layout">
            <div className="panel pdp__narrative-main">
              <div className="panel__head">
                <span className="panel__eyebrow num">Analysis & Context</span>
                <h3 className="panel__title">Institutional Overview</h3>
              </div>
              <div className="pdp__prose">
                {p.fullDescription ? (
                  p.fullDescription.split("\n\n").map((para, i) => (
                    <p key={i}>{para.trim()}</p>
                  ))
                ) : (
                  <p>{p.title} is an investment-grade precious metals asset minted to sovereign standards and backed by Rockwell&apos;s $250M Lloyd&apos;s insured custody architecture.</p>
                )}
              </div>

              {p.tags && p.tags.length > 0 && (
                <div className="pdp__tags num">
                  <span className="pdp__tags-label">Taxonomy:</span>
                  {p.tags.map((tag, i) => (
                    <span key={i} className="pdp__tag">{tag}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="pdp__art-cards">
              <div className="panel pdp__art-panel">
                <div className="pdp__art-head">
                  <span className="pdp__art-k num">Obverse Artwork</span>
                  <span className="tag--top">Front</span>
                </div>
                <p className="pdp__art-desc">
                  {p.obverseDescription || "Features the official sovereign portrait, legal inscriptions, and anti-counterfeit mint hallmarks."}
                </p>
              </div>

              <div className="panel pdp__art-panel">
                <div className="pdp__art-head">
                  <span className="pdp__art-k num">Reverse Motif</span>
                  <span className="tag--stock">Back</span>
                </div>
                <p className="pdp__art-desc">
                  {p.reverseDescription || "Showcases the iconic heraldic symbol, fine weight stamp, purity hallmark, and official denomination."}
                </p>
              </div>

              <div className="panel pdp__ira-panel">
                <div className="pdp__art-head">
                  <span className="pdp__art-k num">IRA Qualification</span>
                  <span className={p.iraEligible === "Yes" ? "tag--stock" : "tag--sale"}>
                    {p.iraEligible === "Yes" ? "IRC 408(m) Eligible" : "Direct Holding Only"}
                  </span>
                </div>
                <p className="pdp__art-desc">
                  {p.iraEligible === "Yes"
                    ? "Meets the IRS purity standards required for inclusion in Self-Directed Precious Metals IRAs. Eligible for segregated depository vaulting."
                    : "Collectable or historical coin intended for direct physical holding or allocated non-IRA vault custody."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* specs + per-sku market terminal */}
        <section className="section--pdp pdp__two">
          <div className="panel">
            <div className="block__head">
              <span className="section__index num">A3 / Specification</span>
              <h2 className="block__title">Full record.</h2>
            </div>
            <dl className="specs num">
              <div><dt>Metal</dt><dd>{metal}</dd></div>
              <div><dt>Purity</dt><dd>{p.purity || "—"}</dd></div>
              <div><dt>Fine Weight</dt><dd>{p.metalContent || "1.0000 troy oz"}</dd></div>
              <div><dt>Mint / Refinery</dt><dd>{p.mint}</dd></div>
              <div><dt>Year</dt><dd>{p.year ?? "Varied Date"}</dd></div>
              <div><dt>Grade / Finish</dt><dd>{p.gradeFinish || fill.grade}</dd></div>
              <div><dt>Diameter</dt><dd>{p.diameterMm || "—"}</dd></div>
              <div><dt>Thickness</dt><dd>{p.thicknessMm || "—"}</dd></div>
              <div><dt>Face Value</dt><dd>{p.faceValue || "N/A"}</dd></div>
              <div><dt>IRA Eligible</dt><dd>{p.iraEligible || "Yes"}</dd></div>
              <div><dt>Rockwell SKU</dt><dd>{p.sku}</dd></div>
              <div><dt>Catalog ID</dt><dd>{p.id}</dd></div>
              <div><dt>Assay</dt><dd>XRF + ultrasonic</dd></div>
              <div><dt>Custody</dt><dd>Allocated · segregated</dd></div>
              <div><dt>Insurance</dt><dd>Lloyd&apos;s · to $250M</dd></div>
              <div><dt>Sell-back</dt><dd>Spot-linked · instant</dd></div>
            </dl>
          </div>

          {/* Only a spot-linked price has a history that can be derived from
              the spot series; a fixed desk ask does not move with the metal, so
              no chart is drawn for it. The series is the product's current
              cash price scaled by spot_t / spot_now — labelled as such, never
              as recorded trades. The old random-walk chart and the fabricated
              "Recent fills" feed are gone (audit: Medium). */}
          {priced && lp!.mode === "live" && (
            <div className="panel">
              <div className="block__head">
                <span className="section__index num">A4 / This SKU, over time</span>
                <h2 className="block__title">This piece, over time.</h2>
              </div>
              <article className="card sku">
                <header className="sku__head">
                  <div>
                    <p className="sku__pair num"><span className="spot__dot" aria-hidden="true"></span> SKU {p.sku}/USD <span className="muted">· per item · indicative</span></p>
                    <div className="sku__price">
                      <span className="num" data-pdp-unit="">{priceText}</span>
                      <span className="chg num" data-sku-change="" data-dir="up"></span>
                    </div>
                  </div>
                  <div className="ranges" role="group" aria-label="Chart timeframe">
                    <button type="button" className="range range--on" data-srange="1D" aria-pressed="true">1D</button>
                    <button type="button" className="range" data-srange="1W" aria-pressed="false">1W</button>
                    <button type="button" className="range" data-srange="1M" aria-pressed="false">1M</button>
                    <button type="button" className="range" data-srange="ALL" aria-pressed="false">All</button>
                  </div>
                </header>
                <div className="sku__plot">
                  <svg className="chart__svg" data-sku-chart="" viewBox="0 0 560 180" preserveAspectRatio="none"
                       role="img" aria-label="Indicative cash price over the selected timeframe, derived from spot history">
                    <defs>
                      <linearGradient id="fillGoldSku" x1="0" y1="0" x2="0" y2="1">
                        <stop className="chart__stop-top" offset="0%" />
                        <stop className="chart__stop-bot" offset="100%" />
                      </linearGradient>
                    </defs>
                    <g className="chart__grid" data-sku-grid=""></g>
                    <path className="chart__area" data-sku-area="" d="" style={{ fill: "url(#fillGoldSku)" }} />
                    <path className="chart__stroke" data-sku-stroke="" d="" />
                    <circle className="chart__cursor" data-sku-cursor="" r="3.5" cx="0" cy="0" />
                  </svg>
                  <p className="sku__empty num muted" data-sku-empty="" hidden>Spot history unavailable for this range.</p>
                </div>
                <p className="sku__note num muted" data-sku-note="">Indicative · derived from spot history · today&apos;s premium held constant</p>
              </article>
            </div>
          )}
        </section>

        {/* provenance */}
        <section className="section--pdp">
          <div className="block__head">
            <span className="section__index num">A4 / Provenance</span>
            <h2 className="block__title">Mint to vault, on the record.</h2>
            <p className="block__sub">A documented chain of custody — each step assay-checked and timestamped to the ledger.</p>
          </div>
          <ol className="chain">
            <li className="chain__step chain__step--done">
              <span className="chain__dot" aria-hidden="true"></span>
              <span className="chain__k num">Struck</span>
              <p>{p.mint}. Die-verified {p.year ?? "original"} strike.</p>
            </li>
            <li className="chain__step chain__step--done">
              <span className="chain__dot" aria-hidden="true"></span>
              <span className="chain__k num">Assayed</span>
              <p>XRF + ultrasonic at intake. Purity confirmed, serial sealed.</p>
            </li>
            <li className="chain__step chain__step--done">
              <span className="chain__dot" aria-hidden="true"></span>
              <span className="chain__k num">Vaulted</span>
              <p>Allocated to Rockwell vault. Insured by Lloyd&apos;s, ledger entry opened.</p>
            </li>
            <li className="chain__step chain__step--live">
              <span className="chain__dot" aria-hidden="true"></span>
              <span className="chain__k num">Yours</span>
              <p>On purchase, the passport transfers to your account — store or take delivery.</p>
            </li>
          </ol>
        </section>

        {/* trust strip */}
        <section className="section--pdp">
          <ul className="trustline num" aria-label="Trust and compliance">
            <li><b>Lloyd&apos;s insured</b><span>to $250M</span></li>
            <li><b>Audited reserves</b><span>monthly attestation</span></li>
            <li><b>Assay verified</b><span>XRF + ultrasonic</span></li>
            <li><b>Allocated custody</b><span>segregated, never lent</span></li>
            <li><b>Instant sell-back</b><span>spot-linked spreads</span></li>
          </ul>
        </section>

        {/* Reviews are omitted until there is a real review pipeline. This section
            previously rendered a seeded rating, an invented "verified buyers"
            count and three testimonials drawn from a pool of six fictional
            handles (audit F-01). */}

        {/* related */}
        {related.length > 0 && (
          <section className="section--pdp">
            <div className="block__head block__head--row">
              <div>
                <span className="section__index num">A6 / Related</span>
                <h2 className="block__title">Pairs well in a vault.</h2>
              </div>
              <Link className="section__more" href={mintPath}>More from {p.mint} →</Link>
            </div>
            <div className="grid grid--pdp" role="list">
              {related.map((r) => {
                const ra = availOf(r);
                return (
                  <Link className="tile" role="listitem" href={`/product/${r.id}`} key={r.id}>
                    <div className="tile__media tile__media--photo"><Image src={r.image} alt={r.title} width={220} height={220} quality={70} loading="lazy" /></div>
                    <div className="tile__info">
                      <h3 className="tile__name tile__name--clamp">{r.title}</h3>
                      <p className="tile__meta">{r.mint}{r.year ? ` · ${r.year}` : ""}</p>
                      <div className="tile__foot">
                        <TilePrice p={r} lp={relatedLive.get(r.id)} />
                        <span className={`tag num ${ra.cls}`}>{ra.label}</span>
                      </div>
                      <div className="tile__sub num"><span>SKU {r.sku}</span><span>{r.metal}</span></div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />

      {/* sticky mobile buy bar */}
      <div className="buybar" aria-hidden="false">
        <div className="buybar__info">
          <span className="buybar__name">{p.title.length > 34 ? p.title.slice(0, 33) + "…" : p.title}</span>
          <span className="buybar__price num" data-pdp-subtotal="">{priced ? priceText : enquireOnly ? "Quote" : "—"}</span>
        </div>
        <button className="btn btn--gold buybar__btn" type="button">{priced ? "Buy now" : enquireOnly ? "Request a quote" : "Notify me"}</button>
      </div>

      {/* market tape */}
      <div className="tape-bar" aria-hidden="true">
        <div className="tape-bar__track" data-tape=""></div>
      </div>

      <PdpRuntime
        id={p.id}
        title={p.title}
        price={priced ? unitCash : 0}
        image={p.image}
        mint={p.mint}
        sku={p.sku}
        serial={fill.serial}
      />
    </>
  );
}
