// Ported from the static prototype's script.js — logic unchanged.
// Wrapped as an init function so React can mount/unmount it; all
// intervals are tracked and cleared by the returned cleanup.
export function initHome() {
  var __timers = [];
  function __every(fn, ms) { var id = setInterval(fn, ms); __timers.push(id); return id; }
// mock live market widgets for the homepage

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // formatting helpers
  function usd(value) {
    return "$" + Math.round(value).toLocaleString("en-US");
  }
  function usdExact(value) {
    return "$" + value.toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }
  function pct(value) {
    var sign = value > 0 ? "+" : value < 0 ? "−" : ""; // proper minus
    return sign + Math.abs(value).toFixed(2) + "%";
  }
  function setDir(el, isUp) {
    el.setAttribute("data-dir", isUp ? "up" : "down");
    el.classList.toggle("gain", isUp);
    el.classList.toggle("loss", !isUp);
  }
  function flash(el, isUp) {
    if (reduceMotion) return;
    var cls = isUp ? "tick-up" : "tick-down";
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 320);
  }

  // theme toggle, dark by default, persisted
  (function theme() {
    var btn = document.querySelector("[data-theme-toggle]");
    var saved;
    try { saved = localStorage.getItem("rm-theme"); } catch (e) { saved = null; }
    apply(saved === "light" ? "light" : "dark");

    function apply(mode) {
      root.setAttribute("data-theme", mode);
      if (btn) {
        var toLight = mode === "dark";
        btn.setAttribute("aria-pressed", mode === "light" ? "true" : "false");
        btn.setAttribute("aria-label", toLight ? "Switch to light mode" : "Switch to dark mode");
      }
    }
    if (btn) {
      btn.addEventListener("click", function () {
        var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
        apply(next);
        try { localStorage.setItem("rm-theme", next); } catch (e) {}
      });
    }
  })();

  // Spot: the shared mark from /api/spot (metal_prices table via lib/spot.ts).
  // No simulated walk — the number on screen is the number the products are
  // priced against. Polled every 60s, the same cadence as the server memo.
  var spot = 0;           // XAU/USD per oz, 0 until the first fetch lands
  var dayOpen = 0;        // previous close, derived from the day-change %
  var spotAsOf = null;
  var spotLive = false;
  var spotAll = { XAU: 0, XAG: 0, XPT: 0, XPD: 0 };
  var changeAll = { XAU: 0, XAG: 0, XPT: 0, XPD: 0 };

  var spotEls   = document.querySelectorAll("[data-spot]");
  var changeEls = document.querySelectorAll("[data-spot-change]");
  var priceEls  = document.querySelectorAll("[data-price]");
  var quoteBid    = document.querySelectorAll('[data-quote="bid"]');
  var quoteAsk    = document.querySelectorAll('[data-quote="ask"]');
  var quoteSpread = document.querySelectorAll('[data-quote="spread"]');
  var syncEls    = document.querySelectorAll("[data-sync]");
  var updatedEls = document.querySelectorAll("[data-updated]");

  function renderSpot(isUp) {
    if (!spot) return;
    spotEls.forEach(function (el) { el.textContent = usdExact(spot); });

    var dayPct = dayOpen ? ((spot - dayOpen) / dayOpen) * 100 : 0;
    var dayUp = dayPct >= 0;
    changeEls.forEach(function (el) {
      el.textContent = pct(dayPct);
      setDir(el, dayUp);
    });

    // two-sided quote
    var bid = spot * (1 - 0.0007);
    var ask = spot * (1 + 0.0007);
    var spr = ((ask - bid) / spot) * 100;
    quoteBid.forEach(function (e) { e.textContent = usd(bid); });
    quoteAsk.forEach(function (e) { e.textContent = usd(ask); });
    quoteSpread.forEach(function (e) { e.textContent = spr.toFixed(2) + "%"; });

    // price = spot * weight * (1 + premium)
    priceEls.forEach(function (el) {
      var weight = parseFloat(el.getAttribute("data-weight")) || 1;
      var premium = parseFloat(el.getAttribute("data-premium")) || 0;
      el.textContent = usd(spot * weight * (1 + premium));
    });

    if (isUp !== undefined) spotEls.forEach(function (el) { flash(el, isUp); });
  }

  // seconds since the mark was observed upstream (not since page load)
  var syncSeconds = 0;
  function renderSync() {
    var s = syncSeconds < 60 ? syncSeconds + "s ago" : Math.floor(syncSeconds / 60) + "m ago";
    if (!spotLive) s = "indicative";
    syncEls.forEach(function (el) { el.textContent = s; });
    updatedEls.forEach(function (el) { el.textContent = "updated " + s; });
  }
  __every(function () { syncSeconds += 1; renderSync(); }, 1000);

  function fetchSpot() {
    return fetch("/api/spot", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (q) {
        if (!q || !q.prices || !(q.prices.XAU > 0)) return;
        var prev = spot;
        spotAll = q.prices; changeAll = q.change || changeAll;
        spot = q.prices.XAU;
        dayOpen = spot / (1 + (q.change && q.change.XAU ? q.change.XAU : 0));
        spotLive = !!q.live; spotAsOf = q.asOf;
        syncSeconds = q.ageSeconds || 0;
        renderSpot(prev ? spot >= prev : undefined);
        renderSync();
        updateChartLive();
        if (window.__tapePaint) window.__tapePaint();
      })
      .catch(function () {});
  }
  fetchSpot();
  __every(fetchSpot, 60000);

  // live chart, XAU/USD with timeframe selectors — series come from
  // /api/spot/history (the metal_prices table), not a generated walk.
  var svg = document.querySelector("[data-chart]");
  var chart = (function () {
    if (!svg) return null;

    var W = 620, H = 240, PAD = 16;
    var areaEl   = svg.querySelector("[data-chart-area]");
    var strokeEl = svg.querySelector("[data-chart-stroke]");
    var gridEl   = svg.querySelector("[data-chart-grid]");
    var cursorEl = svg.querySelector("[data-chart-cursor]");
    var changeEl = document.querySelector("[data-chart-change]");
    var statHigh = document.querySelector('[data-stat="high"]');
    var statLow  = document.querySelector('[data-stat="low"]');
    var statPrev = document.querySelector('[data-stat="prev"]');
    var statAsOf = document.querySelector('[data-stat="asof"]');
    var statNote = document.querySelector('[data-stat="note"]');

    var series = { "1D": [], "1W": [], "1M": [], "ALL": [] };
    var active = "1D";

    // static gridlines, drawn once
    for (var g = 1; g <= 4; g++) {
      var y = PAD + (H - 2 * PAD) * (g / 5);
      var ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", 0); ln.setAttribute("x2", W);
      ln.setAttribute("y1", y); ln.setAttribute("y2", y);
      gridEl.appendChild(ln);
    }

    function build(data) {
      var min = Math.min.apply(null, data);
      var max = Math.max.apply(null, data);
      var span = (max - min) || 1;
      var n = data.length;
      var pts = data.map(function (v, i) {
        var x = n > 1 ? (i / (n - 1)) * W : W;
        var yy = H - PAD - ((v - min) / span) * (H - 2 * PAD);
        return [x, yy];
      });
      var d = pts.map(function (p, i) {
        return (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1);
      }).join(" ");
      return { d: d, area: d + " L" + W + "," + H + " L0," + H + " Z", last: pts[n - 1] };
    }

    function fmtWhen(iso) {
      if (!iso) return "—";
      var d = new Date(iso);
      return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    function render(animate) {
      var data = series[active].slice();
      if (spot) data.push(spot);              // pin the tip to the live mark
      if (data.length < 2) return;
      var shape = build(data);
      strokeEl.setAttribute("d", shape.d);
      areaEl.setAttribute("d", shape.area);
      cursorEl.setAttribute("cx", shape.last[0]);
      cursorEl.setAttribute("cy", shape.last[1]);

      var first = data[0], last = data[data.length - 1];
      var change = ((last - first) / first) * 100;
      if (changeEl) { changeEl.textContent = pct(change); setDir(changeEl, change >= 0); }

      // 24h stats always come from the 1D window, whatever range is shown
      var day = series["1D"].slice(); if (spot) day.push(spot);
      if (statHigh) statHigh.textContent = day.length ? usdExact(Math.max.apply(null, day)) : "—";
      if (statLow)  statLow.textContent  = day.length ? usdExact(Math.min.apply(null, day)) : "—";
      if (statPrev) statPrev.textContent = dayOpen ? usdExact(dayOpen) : "—";
      if (statAsOf) statAsOf.textContent = fmtWhen(spotAsOf);
      if (statNote) statNote.textContent = spotLive
        ? "Marks from the shared metal_prices feed · " + active + " window " + fmtWhen(times[active]) + " → now"
        : "Indicative reference marks — live feed unavailable";

      if (animate && !reduceMotion) {
        var len = strokeEl.getTotalLength();
        strokeEl.style.transition = "none";
        strokeEl.style.strokeDasharray = len;
        strokeEl.style.strokeDashoffset = len;
        void strokeEl.getBoundingClientRect();
        requestAnimationFrame(function () {
          strokeEl.style.transition = "stroke-dashoffset 1s var(--ease)";
          strokeEl.style.strokeDashoffset = "0";
        });
      }
    }

    var times = { "1D": null, "1W": null, "1M": null, "ALL": null };
    function load(range, animate) {
      return fetch("/api/spot/history?range=" + range, { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (h) {
          if (!h || !h.points) return;
          series[range] = h.points.map(function (p) { return p.XAU; });
          times[range] = h.from;
          if (range === active) render(animate);
          if (range === "1D") render(false);
        })
        .catch(function () {});
    }

    function live() {
      if (!reduceMotion) {
        cursorEl.classList.remove("chart__cursor--glow");
        void cursorEl.getBoundingClientRect();
        cursorEl.classList.add("chart__cursor--glow");
      }
      render(false);
    }

    document.querySelectorAll(".range").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll(".range").forEach(function (x) {
          x.classList.remove("range--on"); x.setAttribute("aria-pressed", "false");
        });
        b.classList.add("range--on"); b.setAttribute("aria-pressed", "true");
        active = b.getAttribute("data-range");
        if (series[active].length) render(true); else load(active, true);
      });
    });

    load("1D", true);
    __every(function () { load("1D", false); }, 5 * 60000);
    return { live: live };
  })();

  function updateChartLive() { if (chart) chart.live(); }

  // drop / auction countdowns
  function fmtClock(s) {
    s = Math.max(0, s);
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    var p = function (n) { return n < 10 ? "0" + n : "" + n; };
    return p(h) + ":" + p(m) + ":" + p(sec);
  }
  var timers = [];
  document.querySelectorAll("[data-countdown]").forEach(function (el) {
    var n = parseInt(el.getAttribute("data-countdown"), 10) || 0;
    var drop = el.closest(".drop");
    timers.push({
      el: el, remaining: n, reset: n,
      line: drop ? drop.querySelector("[data-auction-line]") : null
    });
    el.textContent = fmtClock(n);
  });
  // Countdowns run to zero and stop. (They used to reset and loop forever —
  // a clock that never reaches its deadline is not a deadline.) The home page
  // no longer renders any; real close times live on /drops.
  if (timers.length) {
    __every(function () {
      timers.forEach(function (t) {
        if (t.remaining > 0) t.remaining -= 1;
        t.el.textContent = t.remaining > 0 ? fmtClock(t.remaining) : "closed";
        if (t.line) t.line.style.width = ((t.remaining / t.reset) * 100) + "%";
      });
    }, 1000);
  }

  // scarcity: "X left" counters + matching meter fills
  var leftEls = document.querySelectorAll("[data-left]");
  function setMeter(scope, n) {
    var fill = scope && scope.querySelector(".meter__fill[data-stock]");
    if (!fill) return;
    var max = parseFloat(fill.getAttribute("data-stock-max")) || 24;
    fill.setAttribute("data-stock", n);
    fill.style.width = Math.max(4, Math.min(100, (n / max) * 100)) + "%";
    fill.setAttribute("data-low", n <= 3 ? "true" : "false");
  }
  // initial meter widths
  leftEls.forEach(function (el) {
    var n = parseInt(el.textContent, 10) || 1;
    setMeter(el.closest(".drop"), n);
  });
  // (The random "sells one every few seconds, then restocks" loop that used to
  // run here was fabricated scarcity — removed. Stock figures come from the
  // drops ledger on /drops.)

  // order stream — indicative activity priced from LIVE product quotes
  // (/api/quote?ids=…), so every figure matches what the product pages ask.
  // Also fills the hero price and the per-metal "1 oz from" lines.
  (function tape() {
    var feed = document.querySelector("[data-feed]");
    var ids = (feed && feed.getAttribute("data-feed-ids")) || "";
    var fromEls = document.querySelectorAll("[data-from-price]");
    var heroEls = document.querySelectorAll("[data-hero-price]");
    var extra = [];
    fromEls.forEach(function (el) { extra.push(el.getAttribute("data-from-price")); });
    heroEls.forEach(function (el) { extra.push(el.getAttribute("data-hero-price")); });
    var all = ids.split(",").concat(extra).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    if (!all.length) return;

    var pool = [];
    var MAX = 7;
    var items = []; // { node, age }

    function shortName(t) {
      return t.replace(/\s*\((?:Random Year|BU|Random Year, [^)]*)\)/gi, "").replace(/\bCoin\b/gi, "").replace(/\s+/g, " ").trim();
    }
    function ageLabel(a) {
      if (a < 5) return "just now";
      if (a < 60) return a + "s ago";
      return Math.floor(a / 60) + "m ago";
    }
    // Live asks: one row per flagship product at its current cash/sell-back
    // mark. (This used to fabricate BUY/SELL "fills" with random quantities
    // every 3.9 s — simulated order flow presented as real, removed.)
    function renderAsks() {
      if (!feed) return;
      feed.innerHTML = "";
      var spread = 0.015;
      pool.slice(0, MAX).forEach(function (c) {
        var node = document.createElement("li");
        node.className = "fill fill--buy";
        node.innerHTML =
          '<span class="fill__type">ASK</span>' +
          '<span class="fill__item"><a href="/product/' + encodeURIComponent(c.id) + '">' + shortName(c.title) + "</a></span>" +
          '<span class="fill__price num">' + usdExact(c.cashPrice) + "</span>" +
          '<span class="fill__time num" title="Sell-back bid at the published spread">bid ' + usdExact(c.cashPrice * (1 - spread)) + "</span>";
        feed.appendChild(node);
      });
      if (!pool.length) {
        feed.innerHTML = '<li class="fill"><span class="fill__item">Live quotes unavailable — try again shortly.</span></li>';
      }
    }

    function apply(res) {
      var live = (res.items || []).filter(function (x) { return x.cashPrice > 0; });
      var byId = {};
      live.forEach(function (x) { byId[x.id] = x; });
      pool = live.filter(function (x) { return ids.split(",").indexOf(x.id) >= 0; });
      fromEls.forEach(function (el) {
        var q = byId[el.getAttribute("data-from-price")];
        el.textContent = q ? usdExact(q.cashPrice) : "—";
        var link = el.closest("[data-from-link]");
        if (link && q) link.setAttribute("href", "/product/" + q.id);
      });
      heroEls.forEach(function (el) {
        var q = byId[el.getAttribute("data-hero-price")];
        if (!q) return;
        el.textContent = usd(q.cashPrice);
        el.setAttribute("data-value", String(q.cashPrice));
      });
      renderAsks();
    }
    function refresh() {
      fetch("/api/quote?ids=" + encodeURIComponent(all.join(",")), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) { if (res) apply(res); })
        .catch(function () {});
    }
    refresh();
    __every(refresh, 60000);
  })();

  // rotating market read + sentiment meter
  (function signal() {
    var textEl = document.querySelector("[data-signal]");
    var fillEl = document.querySelector('.meter--sentiment .meter__fill');
    var valEl  = document.querySelector("[data-sentiment-val]");
    var labelEl = document.querySelector("[data-sentiment-label]");
    if (!textEl) return;
    var reads = [
      { t: "Vault inflows are up week over week. Sell-back spreads are tightening as live inventory depth improves.", s: 72 },
      { t: "Auction depth is firm on graded proofs. Bids are clustering near spot plus grade premium.", s: 66 },
      { t: "Allocated demand is outpacing settled supply on 1 oz coins. Premiums holding firm.", s: 74 },
      { t: "Britannia and Maple allocations cleared on open. Fresh verified stock lands within the hour.", s: 69 }
    ];
    function posture(s) { return s >= 66 ? "Bullish" : s >= 46 ? "Neutral" : "Bearish"; }
    var idx = 0;
    function apply() {
      var r = reads[idx];
      textEl.textContent = r.t;
      if (fillEl) fillEl.style.width = r.s + "%";
      if (valEl) valEl.textContent = r.s;
      if (labelEl) labelEl.textContent = posture(r.s);
    }
    apply();
    __every(function () { idx = (idx + 1) % reads.length; apply(); }, 13000);
  })();

  // The "ledger synced Ns ago" ticker and the self-climbing auction bid that
  // used to live here were simulations (audit: Medium). Real auction ladders
  // are on /drops/[id]; the passport is verified against the ledger on request.

  // sticky market tape: the four spot metals from /api/spot plus four
  // flagship products at their LIVE quotes (/api/quote?ids=…). Also repaints
  // the nav pricing bar segments so nothing on the page shows a different mark.
  (function tape() {
    var track = document.querySelector("[data-tape]");
    if (!track) return;
    var items = [
      { sym: "XAU/USD", metal: "XAU" },
      { sym: "XAG/USD", metal: "XAG", cents: true },
      { sym: "XPT/USD", metal: "XPT" },
      { sym: "XPD/USD", metal: "XPD" },
      { sym: "GOLD EAGLE", id: "49", metal: "XAU" },
      { sym: "BUFFALO", id: "561", metal: "XAU" },
      { sym: "BRITANNIA", id: "25", metal: "XAU" },
      { sym: "MAPLE", id: "28", metal: "XAU" }
    ];
    function makeNode(it) {
      var el = document.createElement("span");
      el.className = "tape-item";
      el.innerHTML = '<span class="tape-item__sym">' + it.sym + "</span>" +
        '<span class="tape-item__val num">—</span>' +
        '<span class="tape-item__chg num chg" data-dir="up"></span>';
      return el;
    }
    items.forEach(function (it) { it.val = 0; it.nodes = [makeNode(it), makeNode(it)]; });
    items.forEach(function (it) { track.appendChild(it.nodes[0]); });
    items.forEach(function (it) { track.appendChild(it.nodes[1]); });
    function paint() {
      items.forEach(function (it) {
        var v = it.id ? it.val : (spotAll ? spotAll[it.metal] : 0);
        if (!(v > 0)) return;
        var chg = (changeAll && changeAll[it.metal] ? changeAll[it.metal] : 0) * 100;
        var valTxt = it.cents ? "$" + v.toFixed(2) : usd(v);
        document.querySelectorAll('[data-tick="' + it.sym + '"]').forEach(function (bar) {
          var bv = bar.querySelector(".tick__val");
          if (bv) bv.textContent = valTxt;
          var bc = bar.querySelector(".tick__chg");
          if (bc) { bc.textContent = pct(chg); bc.setAttribute("data-dir", chg >= 0 ? "up" : "down"); }
        });
        it.nodes.forEach(function (node) {
          node.querySelector(".tape-item__val").textContent = valTxt;
          var c = node.querySelector(".tape-item__chg");
          c.textContent = pct(chg); c.setAttribute("data-dir", chg >= 0 ? "up" : "down");
        });
      });
    }
    paint(); window.__tapePaint = paint;
    function refreshProducts() {
      var ids = items.filter(function (it) { return it.id; }).map(function (it) { return it.id; });
      fetch("/api/quote?ids=" + ids.join(","), { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
          if (!res || !res.items) return;
          res.items.forEach(function (q) {
            items.forEach(function (it) { if (it.id === q.id && q.cashPrice > 0) it.val = q.cashPrice; });
          });
          paint();
        })
        .catch(function () {});
    }
    refreshProducts();
    __every(refreshProducts, 60000);
  })();

  // mobile menu
  // SiteNav (React) owns the toggle when it rendered the button; attaching a
  // second handler here would double-toggle it.
  var menuBtn = document.querySelector(".nav__menu");
  var navLinks = document.querySelector(".nav__links");
  if (menuBtn && menuBtn.hasAttribute("data-nav-react")) menuBtn = null;
  if (menuBtn && navLinks) {
    menuBtn.addEventListener("click", function () {
      var open = menuBtn.getAttribute("aria-expanded") === "true";
      menuBtn.setAttribute("aria-expanded", open ? "false" : "true");
      navLinks.style.display = open ? "" : "flex";
    });
  }

  return function cleanup() {
    __timers.forEach(function (id) { clearInterval(id); });
    try { delete window.__tapePaint; } catch (e) {}
  };
}
