// Dynamic product page behavior. Same chrome as the rest of the site (theme,
// live spot bar, tape, mobile menu) plus buy-box math driven by the server
// quote (qty tiers, settlement surcharges), the price-hold clock, gallery
// switching and the spot-derived price chart.
//
// Nothing here is simulated: the spot mark and the quote come from /api/spot
// and /api/quote, the chart from /api/spot/history. The random-walk chart,
// the fabricated "Recent fills" feed, the scarcity / sold counters and the
// fake "Checking ledger…" serial check that used to live in this file are
// gone (audit: Medium).
export function initPdp() {
  var __timers = [];
  var __timeouts = [];
  function __every(fn, ms) { var id = setInterval(fn, ms); __timers.push(id); return id; }
  function __later(fn, ms) { var id = setTimeout(fn, ms); __timeouts.push(id); return id; }

  var root = document.documentElement;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function usd(v) { return "$" + Math.round(v).toLocaleString("en-US"); }
  function usdExact(v) { return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(v) {
    var sign = v > 0 ? "+" : v < 0 ? "−" : "";
    return sign + Math.abs(v).toFixed(2) + "%";
  }
  function setDir(el, up) { el.setAttribute("data-dir", up ? "up" : "down"); el.classList.toggle("gain", up); el.classList.toggle("loss", !up); }
  function flash(el, up) {
    if (reduceMotion) return;
    var cls = up ? "tick-up" : "tick-down";
    el.classList.add(cls);
    __later(function () { el.classList.remove(cls); }, 320);
  }

  /**
   * ARIA radio group over a set of buttons: click or arrow keys select, the
   * `--on` class and aria-checked follow, and tabindex roves so the group is
   * a single tab stop. `onSelect(el)` runs after the visual state changes.
   */
  function radioGroup(els, onClass, onSelect) {
    var list = Array.prototype.slice.call(els);
    if (!list.length) return { select: function () {} };
    function select(el, focus) {
      list.forEach(function (x) {
        var on = x === el;
        x.classList.toggle(onClass, on);
        x.setAttribute("aria-checked", on ? "true" : "false");
        x.setAttribute("tabindex", on ? "0" : "-1");
      });
      if (focus) el.focus();
      if (onSelect) onSelect(el);
    }
    list.forEach(function (el, i) {
      el.addEventListener("click", function () { select(el, false); });
      el.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = list[(i + 1) % list.length];
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = list[(i - 1 + list.length) % list.length];
        else if (e.key === "Home") next = list[0];
        else if (e.key === "End") next = list[list.length - 1];
        else if (e.key === " " || e.key === "Enter") next = el;
        if (!next) return;
        e.preventDefault();
        select(next, true);
      });
    });
    // Normalise whatever the server rendered.
    var initial = list.filter(function (x) { return x.classList.contains(onClass); })[0] || list[0];
    list.forEach(function (x) { x.setAttribute("tabindex", x === initial ? "0" : "-1"); x.setAttribute("aria-checked", x === initial ? "true" : "false"); });
    return { select: select };
  }

  // theme toggle, dark by default, persisted
  (function theme() {
    var btn = document.querySelector("[data-theme-toggle]");
    var saved;
    try { saved = localStorage.getItem("rm-theme"); } catch { saved = null; }
    apply(saved === "light" ? "light" : "dark");
    function apply(mode) {
      root.setAttribute("data-theme", mode);
      if (btn) {
        btn.setAttribute("aria-pressed", mode === "light" ? "true" : "false");
        btn.setAttribute("aria-label", mode === "dark" ? "Switch to light mode" : "Switch to dark mode");
      }
    }
    if (btn) btn.addEventListener("click", function () {
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      apply(next);
      try { localStorage.setItem("rm-theme", next); } catch { /* storage unavailable */ }
    });
  })();

  // spot from the shared feed (/api/spot) — no simulated walk. The nav
  // ticker, the tape and the buy box all move off the same mark.
  var spot = 0, dayOpen = 0, spotAll = null, changeAll = null, spotLive = false;
  var spotEls = document.querySelectorAll("[data-spot]");
  var changeEls = document.querySelectorAll("[data-spot-change]");
  var syncEls = document.querySelectorAll("[data-sync]");

  function renderSpot() {
    if (!spot) return;
    spotEls.forEach(function (el) { el.textContent = usdExact(spot); });
    var dayPct = dayOpen ? ((spot - dayOpen) / dayOpen) * 100 : 0;
    changeEls.forEach(function (el) { el.textContent = pct(dayPct); setDir(el, dayPct >= 0); });
  }
  var syncSeconds = 0;
  function renderSync() {
    var s = spotLive ? (syncSeconds < 60 ? syncSeconds + "s ago" : Math.floor(syncSeconds / 60) + "m ago") : "indicative";
    syncEls.forEach(function (el) { el.textContent = s; });
  }
  __every(function () { syncSeconds += 1; renderSync(); }, 1000);
  function fetchSpot() {
    return fetch("/api/spot", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (q) {
        if (!q || !q.prices || !(q.prices.XAU > 0)) return;
        spotAll = q.prices; changeAll = q.change || {};
        spot = q.prices.XAU; dayOpen = spot / (1 + (changeAll.XAU || 0));
        spotLive = !!q.live; syncSeconds = q.ageSeconds || 0;
        renderSpot(); renderSync();
        if (window.__tapePaint) window.__tapePaint();
      })
      .catch(function () {});
  }
  fetchSpot();
  __every(fetchSpot, 60000);

  // buy-box math from the server quote carried on the buy box
  var buybox = document.querySelector(".buybox");
  var PRICE = buybox ? parseFloat(buybox.getAttribute("data-price")) : NaN;
  var priced = !isNaN(PRICE) && PRICE > 0;

  var qty = 1;
  var tierMult = 1;
  var paySurcharge = 0;
  // Card = cash ÷ 0.96 (the APMEX / JM payment transform). The buy box carries
  // the exact figure so this file never hard-codes a rate.
  var CARD_SURCHARGE = buybox && buybox.getAttribute("data-card-fee") ? parseFloat(buybox.getAttribute("data-card-fee")) : 1 / 0.96 - 1;
  var LIVE_ID = buybox ? buybox.getAttribute("data-live-id") : null;
  var METAL = buybox ? (buybox.getAttribute("data-metal") || "") : "";
  var TIER_MULTS = [1, 1, 1];
  function readTierMults() {
    var els = document.querySelectorAll(".tier");
    els.forEach(function (t, i) { var m = parseFloat(t.getAttribute("data-mult")); if (m > 0) TIER_MULTS[i] = m; });
  }
  readTierMults();
  function tierIndexForQty(n) { return n >= 20 ? 2 : n >= 5 ? 1 : 0; }

  var pdpUnitEls = document.querySelectorAll("[data-pdp-unit]");
  var pdpPriceEls = document.querySelectorAll("[data-pdp-price]");
  var pdpSubEls = document.querySelectorAll("[data-pdp-subtotal]");
  var payNote = document.querySelector("[data-pay-note]");

  function unitPrice() { return PRICE * tierMult * (1 + paySurcharge); }

  function renderPrice(up) {
    if (!priced) return;
    var unit = unitPrice();
    var subtotal = unit * qty;
    pdpPriceEls.forEach(function (el) { el.textContent = usdExact(unit); });
    pdpUnitEls.forEach(function (el) { el.textContent = usdExact(unit); });
    pdpSubEls.forEach(function (el) { el.textContent = usdExact(subtotal); });

    if (payNote) {
      var cardUnit = PRICE * tierMult * (1 + CARD_SURCHARGE);
      var save = (cardUnit - unit) * qty;
      if (paySurcharge >= CARD_SURCHARGE) {
        payNote.innerHTML = "Card adds <b>" + usdExact(PRICE * tierMult * CARD_SURCHARGE * qty) + "</b> over wire on this order.";
      } else if (save > 0) {
        payNote.innerHTML = "You save <b>" + usdExact(save) + "</b> vs. card by settling by wire.";
      } else {
        payNote.innerHTML = "Wire settlement — best available price.";
      }
    }
    if (up !== undefined) pdpPriceEls.forEach(function (el) { flash(el, up); });
  }

  // Set by livePoll(); the lock clock calls it when the hold runs out.
  // Resolves true when a fresh quote was applied.
  var requoteNow = null;
  // Set by lock(); livePoll() calls it when a poll brings a new price.
  var lockCtl = { reset: function () {} };

  // price-hold clock: counts down from the last quote, re-quotes at zero and
  // restarts. The clock therefore only ever describes a price that is current
  // — previously it never ticked at all because the attribute names did not
  // match the markup (audit: Medium).
  (function lock() {
    var box = document.querySelector("[data-lock]");
    var clock = document.querySelector("[data-lock-clock]");
    var bar = document.querySelector("[data-lock-bar]");
    var note = document.querySelector("[data-lock-note]");
    if (!box || !clock) return;
    var LEN = 120, remaining = LEN, requoting = false;
    var NOTE_HELD = note ? note.innerHTML : "";
    function fmt(s) { var m = Math.floor(s / 60), x = s % 60; return (m < 10 ? "0" + m : m) + ":" + (x < 10 ? "0" + x : x); }
    function paint() {
      clock.textContent = requoting ? "Re-quoting…" : fmt(remaining);
      if (bar) bar.style.width = Math.max(0, Math.min(100, (remaining / LEN) * 100)) + "%";
    }
    function restart() {
      requoting = false; remaining = LEN;
      box.removeAttribute("data-state");
      if (note) note.innerHTML = NOTE_HELD;
      paint(); flash(clock, true);
    }
    function expire() {
      requoting = true;
      box.setAttribute("data-state", "expired");
      paint();
      if (!requoteNow) { restart(); return; }
      requoteNow().then(function (ok) {
        if (ok) { restart(); return; }
        // Feed unreachable: say so, keep the expired state and try again.
        if (note) note.innerHTML = "Re-quote failed · <b>retrying</b>";
        __later(expire, 5000);
      });
    }
    __every(function () {
      if (requoting || remaining <= 0) return;
      remaining -= 1; paint();
      if (remaining === 0) expire();
    }, 1000);
    lockCtl.reset = restart;
    paint();
  })();

  // quantity: tier radios + stepper. The tier multiplier is the volume
  // discount; the stepper is what actually reaches checkout ([data-qty-input]).
  (function quantity() {
    var tiers = document.querySelectorAll(".tier");
    var input = document.querySelector("[data-qty-input]");
    var dec = document.querySelector("[data-qty-dec]");
    var inc = document.querySelector("[data-qty-inc]");
    if (!tiers.length) return;

    var applying = false;
    var group = radioGroup(tiers, "tier--on", function (el) {
      if (applying) return;
      setQty(parseInt(el.getAttribute("data-qty"), 10) || 1);
    });
    function setQty(n) {
      qty = Math.max(1, Math.min(999, n | 0));
      if (input) input.value = String(qty);
      var i = tierIndexForQty(qty);
      tierMult = TIER_MULTS[i];
      applying = true;
      if (tiers[i]) group.select(tiers[i], false);
      applying = false;
      if (dec) dec.disabled = qty <= 1;
      if (inc) inc.disabled = qty >= 999;
      renderPrice();
    }
    if (dec) dec.addEventListener("click", function () { setQty(qty - 1); });
    if (inc) inc.addEventListener("click", function () { setQty(qty + 1); });
    if (input) {
      input.addEventListener("change", function () { setQty(parseInt(input.value, 10) || 1); });
      input.addEventListener("input", function () {
        var n = parseInt(input.value, 10);
        if (n >= 1 && n <= 999) setQty(n);
      });
      input.addEventListener("keydown", function (e) {
        if (e.key === "ArrowUp") { e.preventDefault(); setQty(qty + 1); }
        else if (e.key === "ArrowDown") { e.preventDefault(); setQty(qty - 1); }
      });
    }
    setQty(1);
  })();

  // settlement method price diffs
  (function payment() {
    radioGroup(document.querySelectorAll(".pay"), "pay--on", function (p) {
      paySurcharge = parseFloat(p.getAttribute("data-fee")) || 0;
      renderPrice(paySurcharge === 0);
    });
  })();

  // custody choice — read by pdp-runtime when the lock is created
  (function custody() {
    radioGroup(document.querySelectorAll(".cust"), "cust--on", null);
  })();

  // live requote: keep the buy box on the current spot mark (server-side quote;
  // this file never reproduces pricing logic). Refreshes on the same cadence
  // as the shared spot snapshot; a changed price restarts the hold clock.
  (function livePoll() {
    if (!LIVE_ID || !priced) return;
    var tierEls = document.querySelectorAll(".tier .tier__p");
    var meltEl = document.querySelector("[data-pdp-melt]");
    var premEl = document.querySelector("[data-pdp-premium]");
    var spotEl = document.querySelector("[data-pdp-spot]");
    var asOfEl = document.querySelector("[data-pdp-asof]");
    function apply(q, forced) {
      if (!q || q.mode === "enquire" || !(q.cashPrice > 0)) return false;
      var up = q.cashPrice >= PRICE;
      var changed = Math.abs(q.cashPrice - PRICE) > 0.005;
      PRICE = q.cashPrice;
      if (buybox) { buybox.setAttribute("data-price", String(PRICE)); buybox.setAttribute("data-spot-used", String(q.spotUsed)); }
      if (q.tiers && q.tiers.length === 3) {
        q.tiers.forEach(function (t, i) { TIER_MULTS[i] = t.unitCash / q.cashPrice; if (tierEls[i]) tierEls[i].textContent = usdExact(t.unitCash); });
        tierMult = TIER_MULTS[tierIndexForQty(qty)];
      }
      if (meltEl) meltEl.textContent = usdExact(q.meltValue);
      if (premEl) premEl.textContent = usdExact(q.premiumUsd) + " (" + (q.premiumPct * 100).toFixed(1) + "% over spot)";
      if (spotEl) spotEl.textContent = usdExact(q.spotUsed) + " /oz";
      if (asOfEl && q.asOf) asOfEl.textContent = new Date(q.asOf).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      renderPrice(changed ? up : undefined);
      // A new price is a new hold. (A forced re-quote restarts via the clock itself.)
      if (changed && !forced) lockCtl.reset();
      if (window.__skuChart) window.__skuChart();
      return true;
    }
    function tick(forced) {
      return fetch("/api/quote?id=" + encodeURIComponent(LIVE_ID) + "&qty=1", { cache: "no-store" })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (q) { return apply(q, forced); })
        .catch(function () { return false; });
    }
    requoteNow = function () { return tick(true); };
    __every(function () { tick(false); }, 60000);
  })();

  // per-sku chart: the product's cash price implied by the shared spot history
  // (/api/spot/history). price_t = price_now × spot_t / spot_now, i.e. today's
  // premium held constant over the metal's recorded marks. Indicative only,
  // and labelled as such in the markup.
  (function sku() {
    var svg = document.querySelector("[data-sku-chart]");
    if (!svg || !priced || !buybox || !METAL) return;
    var W = 560, H = 180, PAD = 14;
    var areaEl = svg.querySelector("[data-sku-area]");
    var strokeEl = svg.querySelector("[data-sku-stroke]");
    var gridEl = svg.querySelector("[data-sku-grid]");
    var cursorEl = svg.querySelector("[data-sku-cursor]");
    var changeEl = document.querySelector("[data-sku-change]");
    var emptyEl = document.querySelector("[data-sku-empty]");
    var active = "1D";
    var spots = {};       // range -> [spot_t] (only rows with a mark for this metal)
    var pending = {};     // range -> Promise

    for (var g = 1; g <= 3; g++) {
      var y = PAD + (H - 2 * PAD) * (g / 4);
      var ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
      ln.setAttribute("x1", 0); ln.setAttribute("x2", W); ln.setAttribute("y1", y); ln.setAttribute("y2", y);
      gridEl.appendChild(ln);
    }
    function load(range) {
      if (spots[range]) return Promise.resolve(spots[range]);
      if (pending[range]) return pending[range];
      pending[range] = fetch("/api/spot/history?range=" + encodeURIComponent(range))
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (res) {
          var pts = res && res.points ? res.points : [];
          var out = [];
          pts.forEach(function (p) { var v = Number(p[METAL]); if (v > 0) out.push(v); });
          spots[range] = out;
          delete pending[range];
          return out;
        })
        .catch(function () { delete pending[range]; return []; });
      return pending[range];
    }
    function derive(spotSeries) {
      var spotNow = parseFloat(buybox.getAttribute("data-spot-used"));
      var priceNow = parseFloat(buybox.getAttribute("data-price"));
      if (!(spotNow > 0) || !(priceNow > 0)) return [];
      var out = spotSeries.map(function (s) { return priceNow * (s / spotNow); });
      // The last point is the live quote itself.
      out.push(priceNow);
      return out;
    }
    function build(data) {
      var min = Math.min.apply(null, data), max = Math.max.apply(null, data);
      var span = (max - min) || 1, n = data.length;
      var pts = data.map(function (v, i) {
        return [(i / (n - 1)) * W, H - PAD - ((v - min) / span) * (H - 2 * PAD)];
      });
      var d = pts.map(function (q, i) { return (i === 0 ? "M" : "L") + q[0].toFixed(1) + "," + q[1].toFixed(1); }).join(" ");
      return { d: d, area: d + " L" + W + "," + H + " L0," + H + " Z", last: pts[n - 1] };
    }
    function paint(data, animate) {
      var has = data.length >= 2;
      svg.style.visibility = has ? "" : "hidden";
      if (emptyEl) emptyEl.hidden = has;
      if (!has) { if (changeEl) changeEl.textContent = ""; return; }
      var shape = build(data);
      strokeEl.setAttribute("d", shape.d);
      areaEl.setAttribute("d", shape.area);
      cursorEl.setAttribute("cx", shape.last[0]); cursorEl.setAttribute("cy", shape.last[1]);
      var first = data[0], last = data[data.length - 1];
      var change = ((last - first) / first) * 100;
      if (changeEl) { changeEl.textContent = pct(change); setDir(changeEl, change >= 0); }
      if (animate && !reduceMotion) {
        var len = strokeEl.getTotalLength();
        strokeEl.style.transition = "none";
        strokeEl.style.strokeDasharray = len; strokeEl.style.strokeDashoffset = len;
        void strokeEl.getBoundingClientRect();
        requestAnimationFrame(function () {
          strokeEl.style.transition = "stroke-dashoffset 1s var(--ease)";
          strokeEl.style.strokeDashoffset = "0";
        });
      }
    }
    function render(animate) {
      var range = active;
      load(range).then(function (series) {
        if (range !== active) return;
        paint(derive(series), animate);
      });
    }
    document.querySelectorAll("[data-srange]").forEach(function (b) {
      b.addEventListener("click", function () {
        document.querySelectorAll("[data-srange]").forEach(function (x) { x.classList.remove("range--on"); x.setAttribute("aria-pressed", "false"); });
        b.classList.add("range--on"); b.setAttribute("aria-pressed", "true");
        active = b.getAttribute("data-srange"); render(true);
      });
    });
    // livePoll repaints after a re-quote so the series ends on the new price.
    window.__skuChart = function () { render(false); };
    render(true);
  })();

  // gallery: thumbnails swap the stage image and caption. Each thumb carries
  // the catalog gallery URL in data-src; the stage image is served through
  // the image optimizer like the initial render, falling back to the CDN URL.
  (function gallery() {
    var stage = document.querySelector("[data-stage]");
    var stageImg = document.querySelector("[data-stage-img]");
    var label = document.querySelector("[data-zoom-label]");
    var thumbs = document.querySelectorAll(".thumb");
    if (!stage || !stageImg || !thumbs.length) return;
    function optimized(url) { return "/_next/image?url=" + encodeURIComponent(url) + "&w=1080&q=80"; }
    function show(t) {
      thumbs.forEach(function (x) { x.classList.remove("thumb--on"); x.setAttribute("aria-pressed", "false"); });
      t.classList.add("thumb--on"); t.setAttribute("aria-pressed", "true");
      var url = t.getAttribute("data-src");
      if (url && stageImg.getAttribute("data-current") !== url) {
        stageImg.setAttribute("data-current", url);
        stageImg.removeAttribute("srcset");
        stageImg.removeAttribute("sizes");
        stageImg.onerror = function () { stageImg.onerror = null; stageImg.src = url; };
        stageImg.src = optimized(url);
      }
      if (label) label.textContent = t.getAttribute("data-label") || "";
    }
    thumbs.forEach(function (t) { t.addEventListener("click", function () { show(t); }); });
  })();

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
        // a product's day move is its metal's day move (premium is fixed intraday)
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
  var menuBtn = document.querySelector(".nav__menu");
  var navLinks = document.querySelector(".nav__links");
  // SiteNav (React) owns the hamburger; only wire it here for legacy markup.
  if (menuBtn && menuBtn.hasAttribute("data-nav-react")) menuBtn = null;
  if (menuBtn && navLinks) menuBtn.addEventListener("click", function () {
    var open = menuBtn.getAttribute("aria-expanded") === "true";
    menuBtn.setAttribute("aria-expanded", open ? "false" : "true");
    navLinks.style.display = open ? "" : "flex";
  });

  return function cleanup() {
    __timers.forEach(function (id) { clearInterval(id); });
    __timeouts.forEach(function (id) { clearTimeout(id); });
    requoteNow = null;
    try { delete window.__tapePaint; delete window.__skuChart; } catch { /* non-configurable */ }
  };
}
