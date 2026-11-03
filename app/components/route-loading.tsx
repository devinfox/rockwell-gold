// Loading boundary for the server-rendered segments (catalog listings, drops,
// checkout, order and admin detail pages). It is deliberately NOT mounted at
// the root: a loading boundary above /product/[id] makes Next stream the shell
// with a 200 before the page can call notFound(), so a delisted product became
// a soft 404. With no boundary above it, an unknown id is a real 404 and that
// 404 is what gets cached. Static pages never show this — they come from cache.
export default function RouteLoading() {
  return (
    <main className="wrap rm-main" aria-busy="true" aria-live="polite">
      <p className="rm-sub num">Loading…</p>
    </main>
  );
}
