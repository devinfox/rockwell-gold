import Image from "next/image";
import SiteNav from "./site-nav";
import SiteFooter from "./site-footer";
import { availOf, classOf, type Product } from "../data/catalog";
import { categoryIndex, sortedCategory, hasComparator, type CategoryIndex } from "../data/catalog-index";
import { livePricesFor, type LivePrice } from "../lib/pricing/live";
import { liveCatalogPrices } from "../lib/pricing/catalog-prices";
import "../market/market.css";

type Crumb = { label: string; href?: string };

export const PAGE_SIZE = 48;

export interface CatalogQuery {
  q?: string;
  sort?: string;
  mint?: string | string[];
  avail?: string | string[];
  page?: string;
}

const asArray = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/**
 * Filter + sort + paginate on the server.
 *
 * Previously every tile in a category was rendered into the document and all
 * but the first twenty hidden with the `hidden` attribute — /silver alone was
 * 14,829 tiles and roughly 8.4 MB of HTML to show twenty items (audit P-03).
 */
function selectProducts(catIndex: CategoryIndex, query: CatalogQuery) {
  const q = (query.q ?? "").trim().toLowerCase();
  const mints = asArray(query.mint);
  const avails = asArray(query.avail);
  const sort = query.sort ?? "featured";
  const filtered = !!q || mints.length > 0 || avails.length > 0;

  // Unfiltered pages — the overwhelming majority of requests — slice a
  // pre-sorted array and never touch the rest of the catalog.
  let rows: Product[] = hasComparator(sort) ? sortedCategory(catIndex, sort) : catIndex.products;

  if (filtered) {
    rows = rows.filter((p) => {
      if (mints.length && !mints.includes(p.mintSlug)) return false;
      if (avails.length && !avails.includes(catIndex.availKey.get(p) ?? "")) return false;
      if (q) {
        if (
          !p.title.toLowerCase().includes(q) &&
          !p.sku.toLowerCase().includes(q) &&
          !(p.year != null && String(p.year).includes(q))
        ) {
          return false;
        }
      }
      return true;
    });
  }

  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, parseInt(query.page ?? "1", 10) || 1), pages);
  return { rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total, page, pages };
}

/** Rebuilds the current query string with one value changed. */
function hrefWith(base: string, query: CatalogQuery, patch: Record<string, string | string[] | undefined>) {
  const sp = new URLSearchParams();
  const merged: Record<string, string | string[] | undefined> = { ...query, ...patch };
  for (const [k, v] of Object.entries(merged)) {
    if (v === undefined || v === "") continue;
    for (const one of Array.isArray(v) ? v : [v]) if (one) sp.append(k, one);
  }
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/** Toggles one value inside a multi-select facet. */
const toggled = (current: string[], value: string) =>
  current.includes(value) ? current.filter((v) => v !== value) : [...current, value];

const usd2 = (v: number) =>
  "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Price cell for a tile: live quote when the product is in the launch rule book, static text otherwise. */
export function TilePrice({ p, lp }: { p: Product; lp?: LivePrice }) {
  if (!lp) return <span className="tile__price num">{p.priceText || "—"}</span>;
  if (lp.mode === "enquire") return <span className="tile__price tile__price--enquire num">Request a quote</span>;
  return (
    <span className={`tile__price num${lp.indicative ? " tile__price--indicative" : ""}`} title={lp.explain}>
      {usd2(lp.cashPrice)}
      <span className={`tile__live tile__live--${lp.mode}`}>
        {lp.mode === "live" ? <><span className="spot__dot" aria-hidden="true"></span> live</> : "fixed ask"}
      </span>
    </span>
  );
}

export default async function CatalogPage({
  index,
  title,
  sub,
  crumbs,
  products,
  currentPath,
  showMintFilter = false,
  query = {},
}: {
  index: string;
  title: string;
  sub: string;
  crumbs: Crumb[];
  products: Product[];
  currentPath: string;
  showMintFilter?: boolean;
  query?: CatalogQuery;
}) {
  // Sorting and the summary strip read the same live engine prices the tiles
  // show, never the static snapshot column (audit: Medium). The whole-catalog
  // map is memoised per spot snapshot, so this is a lookup, not a re-price.
  const prices = await liveCatalogPrices();
  const catIndex = categoryIndex(currentPath, products, prices);
  const { rows, total, page, pages } = selectProducts(catIndex, query);
  // One spot read per request; only the 48 tiles on this page are quoted.
  const live = await livePricesFor(rows);
  const liveCount = [...live.values()].filter((l) => l.mode !== "enquire").length;
  const anyLive = [...live.values()].find((l) => l.mode === "live");

  const activeMints = asArray(query.mint);
  const activeAvail = asArray(query.avail);
  const activeCount = activeMints.length + activeAvail.length + (query.q ? 1 : 0);

  // mints / avgPrice / inStock all come from the cached single-pass index.
  const mintsToShow = catIndex.mints;
  const { avgPrice, pricedCount } = catIndex.priced;
  const inStock = catIndex.inStock;

  const AVAIL_FACETS = [
    { key: "stock", label: "In stock" },
    { key: "sale", label: "Sale" },
    { key: "top", label: "Top pick" },
    { key: "pre", label: "Pre-sale" },
    { key: "notify", label: "Notify me" },
    { key: "enquire", label: "Enquire" },
  ];

  const SORTS = [
    { v: "featured", label: "Featured" },
    { v: "price-asc", label: "Price · low to high" },
    { v: "price-desc", label: "Price · high to low" },
    { v: "year-desc", label: "Year · newest" },
    { v: "name", label: "Name · A–Z" },
  ];

  // Compact page window around the current page.
  const window: number[] = [];
  for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i++) window.push(i);

  return (
    <>
      <SiteNav current={currentPath} />

      <main className="wrap mkt__wrap" id="main">
        <nav className="crumbs num" aria-label="Breadcrumb">
          {crumbs.map((c, i) => (
            <span key={i} style={{ display: "contents" }}>
              {i > 0 && <span aria-hidden="true">/</span>}
              {c.href ? <a href={c.href}>{c.label}</a> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>

        <header className="mkt__head">
          <div>
            <span className="section__index num">{index}</span>
            <h1 className="section__title">{title}</h1>
            <p className="section__sub">{sub}</p>
          </div>

          <ul className="mkt-strip num" aria-label="Catalog summary">
            <li>
              <span className="mkt-strip__k">Listed SKUs</span>
              <b className="mkt-strip__v">{products.length.toLocaleString("en-US")}</b>
              <span className="mkt-strip__sub">
                {total === products.length ? "showing all" : `${total.toLocaleString("en-US")} match`}
              </span>
            </li>
            <li>
              <span className="mkt-strip__k">In stock</span>
              <b className="mkt-strip__v gain">{inStock.toLocaleString("en-US")}</b>
              <span className="mkt-strip__sub">of catalog</span>
            </li>
            <li>
              <span className="mkt-strip__k">Avg live price</span>
              <b className="mkt-strip__v">
                {pricedCount > 0 ? `$${avgPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}
              </b>
              <span className="mkt-strip__sub">
                {pricedCount > 0 ? `${pricedCount.toLocaleString("en-US")} live-priced` : "no live quotes"}
              </span>
            </li>
            <li>
              <span className="mkt-strip__k">Page</span>
              <b className="mkt-strip__v">{page} / {pages}</b>
              <span className="mkt-strip__sub">{PAGE_SIZE} per page</span>
            </li>
          </ul>
        </header>

        {/* Search + sort submit as a plain GET form, so results are server-rendered
            and every filtered view is a real, shareable, crawlable URL. */}
        <form className="toolbar" method="get" action={currentPath}>
          {activeMints.map((m) => <input key={`m${m}`} type="hidden" name="mint" value={m} />)}
          {activeAvail.map((a) => <input key={`a${a}`} type="hidden" name="avail" value={a} />)}

          <label className="search" aria-label="Search this category">
            <svg className="search__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M21 21l-4.3-4.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
            <input
              className="search__input"
              type="search"
              name="q"
              defaultValue={query.q ?? ""}
              placeholder="Search title, SKU, year…"
              autoComplete="off"
            />
          </label>

          <p className="toolbar__count num" aria-live="polite">
            <b>{total.toLocaleString("en-US")}</b> results
          </p>

          <label className="sort">
            <span className="sort__label">Sort</span>
            <select className="sort__select num" name="sort" defaultValue={query.sort ?? "featured"} aria-label="Sort results">
              {SORTS.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
            </select>
          </label>

          <button className="btn btn--ghost" type="submit">Apply</button>
        </form>

        <div className="mkt__layout">
          <aside className="filters" id="cat-filters" aria-label="Filters">
            <div className="filters__head">
              <span className="filters__title num">Refine</span>
              {activeCount > 0 && (
                <a className="filters__clear" href={currentPath}>Clear all</a>
              )}
            </div>

            {showMintFilter && mintsToShow.length > 1 && (
              <fieldset className="fgroup">
                <legend className="fgroup__title">Mint &amp; Brand</legend>
                <div className="fopts" role="group">
                  {mintsToShow.map((m: { slug: string; name: string }) => {
                    const on = activeMints.includes(m.slug);
                    return (
                      <a
                        key={m.slug}
                        className={`fopt${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        href={hrefWith(currentPath, query, { mint: toggled(activeMints, m.slug), page: undefined })}
                      >
                        {m.name}
                      </a>
                    );
                  })}
                </div>
              </fieldset>
            )}

            <fieldset className="fgroup">
              <legend className="fgroup__title">Availability</legend>
              <div className="fopts" role="group">
                {AVAIL_FACETS.map((f) => {
                  const on = activeAvail.includes(f.key);
                  return (
                    <a
                      key={f.key}
                      className={`fopt${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      href={hrefWith(currentPath, query, { avail: toggled(activeAvail, f.key), page: undefined })}
                    >
                      {f.label}
                    </a>
                  );
                })}
              </div>
            </fieldset>

            <p className="filters__note num">
              {liveCount > 0
                ? anyLive
                  ? `Spot-linked pricing · ${liveCount} of ${rows.length} on this page priced from the live mark${anyLive.indicative ? " (indicative — feed refreshing)" : ""} · card price = cash ÷ 0.96`
                  : "Fixed market asks · card price = cash ÷ 0.96"
                : "Prices are snapshot values from the source feed and are not spot-linked."}
            </p>
          </aside>

          <section className="mkt__results" aria-label="Catalog inventory">
            <div className="grid mkt__grid" role="list">
              {rows.map((p) => {
                const avail = availOf(p);
                const klass = classOf(p);
                return (
                  <a key={p.id} className="tile" role="listitem" href={`/product/${p.id}`}>
                    {p.badge === "Top Pick" && <span className="tile__flag tile__flag--hot">Top pick</span>}
                    {p.badge === "Sale" && <span className="tile__flag tile__flag--proof">Sale</span>}
                    <div className="tile__media tile__media--photo">
                      {/* Source images average 331 KB and were being served at
                          full resolution into a ~200px tile — 15.5 MB per page.
                          next/image resizes and re-encodes to the display size. */}
                      <Image
                        src={p.image}
                        alt={p.title}
                        width={280}
                        height={280}
                        sizes="(max-width: 640px) 45vw, (max-width: 1100px) 30vw, 220px"
                        quality={70}
                        loading="lazy"
                      />
                    </div>
                    <div className="tile__info">
                      <h3 className="tile__name tile__name--clamp">{p.title}</h3>
                      <p className="tile__meta">{p.mint}{p.year ? ` · ${p.year}` : ""}</p>
                      <div className="tile__foot">
                        <TilePrice p={p} lp={live.get(p.id)} />
                        <span className={`tag num ${avail.cls}`}>{avail.label}</span>
                      </div>
                      <div className="tile__sub num">
                        <span>SKU {p.sku}</span>
                        <span>{klass ?? p.metal}</span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>

            {rows.length === 0 && (
              <div className="empty">
                <p className="empty__title">Nothing matches those filters.</p>
                <p className="empty__sub">Loosen a filter or clear the search to see the full category.</p>
                <a className="btn btn--ghost" href={currentPath}>Clear filters</a>
              </div>
            )}

            {pages > 1 && (
              <nav className="pager num" aria-label="Pagination">
                {page > 1 && (
                  <a className="pager__btn" href={hrefWith(currentPath, query, { page: String(page - 1) })} rel="prev">
                    ← Prev
                  </a>
                )}
                {window[0] > 1 && (
                  <a className="pager__btn" href={hrefWith(currentPath, query, { page: "1" })}>1</a>
                )}
                {window[0] > 2 && <span className="pager__gap">…</span>}
                {window.map((n) => (
                  <a
                    key={n}
                    className={`pager__btn${n === page ? " pager__btn--on" : ""}`}
                    aria-current={n === page ? "page" : undefined}
                    href={hrefWith(currentPath, query, { page: String(n) })}
                  >
                    {n}
                  </a>
                ))}
                {window[window.length - 1] < pages - 1 && <span className="pager__gap">…</span>}
                {window[window.length - 1] < pages && (
                  <a className="pager__btn" href={hrefWith(currentPath, query, { page: String(pages) })}>{pages}</a>
                )}
                {page < pages && (
                  <a className="pager__btn" href={hrefWith(currentPath, query, { page: String(page + 1) })} rel="next">
                    Next →
                  </a>
                )}
              </nav>
            )}
          </section>
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
