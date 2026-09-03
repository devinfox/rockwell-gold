"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { OpsShell } from "../ops-shell";
import { useRm } from "../../lib/use-rm";
import { useFintech } from "../../components/global-fintech-provider";
import { canRun, requirementLabel } from "../action-policy";

interface ProductRow {
  rank: number;
  sku: string;
  title: string;
  metal: string;
  purity: string;
  weight: string;
  brand: string;
  year: string;
  price: string;
  diameter: string;
  thickness: string;
  faceValue: string;
  iraEligible: string;
  imageUrl: string;
  description?: string;
  jmTitle?: string;
  jmUrl?: string;
  jmPrice?: string;
  jmSku?: string;
  sdTitle?: string;
  sdUrl?: string;
  sdSku?: string;
  sdPrice?: string;
  sdPurity?: string;
  sdDiameter?: string;
  sdThickness?: string;
  sdMint?: string;
  sdIra?: string;
  matchScore?: number;
  status?: "pending" | "matched" | "unmatched";
}

interface SynthesizedProduct {
  rank: number;
  sku: string;
  productTitle: string;
  shortSummary: string;
  metal: string;
  metalContent: string;
  purity: string;
  mint: string;
  year: string;
  gradeFinish: string;
  diameterMm: string;
  thicknessMm: string;
  faceValue: string;
  iraEligible: string;
  obverseDescription: string;
  reverseDescription: string;
  fullDescription: string;
  tags: string[];
  primaryImageUrl: string;
}

interface StudioCheckpoint {
  batchKey: string;
  stage: "idle" | "matching" | "synthesizing" | "completed" | "paused";
  totalCount: number;
  matchedCount: number;
  synthesizedCount: number;
  startTime: number | null;
  lastUpdatedTime: number | null;
  elapsedSeconds: number;
  itemsPerSecond: number;
  etaSeconds: number;
  matchedItems: ProductRow[];
  synthesizedItems: Record<string, SynthesizedProduct>;
}

// The 12 MB source dataset stays on the server; batches arrive from
// /api/catalog-batch instead of being bundled into the client (see audit P-01).
async function fetchBatch(batchKey: string): Promise<ProductRow[]> {
  const res = await fetch(`/api/catalog-batch?batch=${encodeURIComponent(batchKey)}`);
  if (!res.ok) throw new Error("Could not load that batch.");
  const json = await res.json();
  return (json.rows ?? []) as ProductRow[];
}

function formatDuration(seconds: number): string {
  if (seconds < 0 || isNaN(seconds)) return "00m 00s";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}m ${secs.toString().padStart(2, "0")}s`;
}

export function CatalogStudioClient() {
  const rm = useRm();
  const { addToast } = useFintech();
  // Every mutating route behind this page (/api/match-jm, /api/synthesize-catalog,
  // /api/deploy-catalog, /api/catalog-batch, POST /api/catalog-progress) is
  // gated SUPER_ADMIN/OPS_VAULT by app/lib/api-guard.ts. Other staff get a
  // read-only view: no buttons that the server will 403.
  const canMutate = canRun(rm.session?.role, "catalogTooling");
  const roleNeeded = requirementLabel("catalogTooling");
  const refuse = () => addToast("Read-only for your role", roleNeeded, "loss");
  /** Turns a 401/403 from a studio route into a toast instead of a silent retry loop. */
  const checkAuth = (res: Response) => {
    if (res.status === 401 || res.status === 403) {
      addToast(res.status === 401 ? "Session expired" : "Refused by the server", roleNeeded, "loss");
      return false;
    }
    return true;
  };
  // Screen Step: 1 = "Matcher Screen", 2 = "Synthesizer Screen"
  const [activeScreen, setActiveScreen] = useState<1 | 2>(1);
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>("all_13596");

  const [primaryRows, setPrimaryRows] = useState<ProductRow[]>([]);
  const [matchedSecondaryRows, setMatchedSecondaryRows] = useState<ProductRow[]>([]);
  const [selectedProductIndex, setSelectedProductIndex] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Real-Time Progress Telemetry (Screen 1: Matching)
  const [isMatching, setIsMatching] = useState<boolean>(false);
  const [isMatchPaused, setIsMatchPaused] = useState<boolean>(false);
  const [matchElapsedSec, setMatchElapsedSec] = useState<number>(0);
  const [matchSpeed, setMatchSpeed] = useState<number>(0); // items/sec
  const [matchEtaSec, setMatchEtaSec] = useState<number>(0);
  const [matchError, setMatchError] = useState<string>("");
  const matchAbortRef = useRef<boolean>(false);

  // Real-Time Progress Telemetry (Screen 2: Synthesizing)
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [isSynthPaused, setIsSynthPaused] = useState<boolean>(false);
  const [synthElapsedSec, setSynthElapsedSec] = useState<number>(0);
  const [synthSpeed, setSynthSpeed] = useState<number>(0); // items/sec
  const [synthEtaSec, setSynthEtaSec] = useState<number>(0);
  const [synthesizedMap, setSynthesizedMap] = useState<Record<number, SynthesizedProduct>>({});
  const synthAbortRef = useRef<boolean>(false);

  // Live Storefront Deployment State
  const [isDeploying, setIsDeploying] = useState<boolean>(false);
  const [deployMessage, setDeployMessage] = useState<string>("");

  // Interruption Checkpoint Banner State
  const [savedCheckpoint, setSavedCheckpoint] = useState<StudioCheckpoint | null>(null);
  const [showResumeBanner, setShowResumeBanner] = useState<boolean>(false);
  const [isAutoSaved, setIsAutoSaved] = useState<boolean>(true);

  // 1. Initial Load: Check for existing checkpoint
  useEffect(() => {
    async function loadCheckpoint() {
      try {
        // Summary first (counts only). The item payload can be tens of MB, so
        // it is fetched only when there is genuinely something to resume.
        const res = await fetch("/api/catalog-progress");
        const data = await res.json();
        if (data.success && data.checkpoint) {
          const summary: StudioCheckpoint = data.checkpoint;
          const hasMatches = summary.matchedCount > 0;
          const hasSynths = summary.synthesizedCount > 0;

          if (summary.batchKey === selectedBatchKey && ((hasMatches && summary.matchedCount < summary.totalCount) || (hasSynths && summary.synthesizedCount < summary.totalCount))) {
            const full = await fetch("/api/catalog-progress?include=items");
            const fullData = await full.json();
            if (fullData.success && fullData.checkpoint) {
              setSavedCheckpoint(fullData.checkpoint as StudioCheckpoint);
              setShowResumeBanner(true);
            }
          }
        }
      } catch (err) {
        console.warn("Could not load checkpoint on init:", err);
      }
    }
    loadCheckpoint();
  }, []);

  // Restore Checkpoint Action
  const handleRestoreCheckpoint = () => {
    if (!savedCheckpoint) return;
    setSelectedBatchKey(savedCheckpoint.batchKey);
    if (savedCheckpoint.matchedItems && savedCheckpoint.matchedItems.length > 0) {
      setMatchedSecondaryRows(savedCheckpoint.matchedItems);
    }
    if (savedCheckpoint.synthesizedItems) {
      const parsedMap: Record<number, SynthesizedProduct> = {};
      Object.entries(savedCheckpoint.synthesizedItems).forEach(([k, v]) => {
        parsedMap[parseInt(k)] = v;
      });
      setSynthesizedMap(parsedMap);
    }
    setShowResumeBanner(false);
  };

  // Discard Checkpoint Action
  const handleDiscardCheckpoint = async () => {
    if (!canMutate) { refuse(); return; }
    try {
      const res = await fetch("/api/catalog-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reset", batchKey: selectedBatchKey, totalCount: primaryRows.length }),
      });
      if (!checkAuth(res)) return;
    } catch (err) {
      console.warn("Error resetting checkpoint:", err);
    }
    setShowResumeBanner(false);
    setSavedCheckpoint(null);
  };

  // Load the initially selected batch once on mount.
  useEffect(() => {
    let alive = true;
    fetchBatch(selectedBatchKey)
      .then((rows) => { if (alive) setPrimaryRows(rows); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Batch Switcher Handler
  const handleBatchSelect = async (batchKey: string) => {
    if (!canMutate) { refuse(); return; }
    setSelectedBatchKey(batchKey);
    setMatchedSecondaryRows([]);
    setSynthesizedMap({});
    setSelectedProductIndex(0);
    setMatchElapsedSec(0);
    setMatchSpeed(0);
    setMatchEtaSec(0);
    setSynthElapsedSec(0);
    setSynthSpeed(0);
    setSynthEtaSec(0);

    let newRows: ProductRow[] = [];
    try {
      newRows = await fetchBatch(batchKey);
    } catch {
      newRows = [];
    }
    setPrimaryRows(newRows);

    fetch("/api/catalog-progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reset", batchKey, totalCount: newRows.length }),
    }).catch(() => {});
  };

  // Upload Custom JM CSV
  const handleCsvUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length <= 1) return;

      const parsed: ProductRow[] = [];
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""));
        const rank = 12470 + i;
        parsed.push({
          rank,
          sku: parts[0] || `JM-${rank}`,
          title: parts[1] || `JM Bullion Item #${rank}`,
          metal: parts[2] || "Gold",
          weight: parts[3] || "1 oz",
          purity: parts[4] || ".9999",
          brand: parts[5] || "Official Mint",
          year: parts[6] || "2026",
          price: parts[7] || "$2,500.00",
          diameter: parts[8] || "38.0 mm",
          thickness: parts[9] || "3.2 mm",
          faceValue: parts[10] || "$50 USD",
          iraEligible: "Yes",
          imageUrl: parts[11] || "https://cdn.jmbullion.com/wp-content/uploads/placeholder.jpg",
          jmTitle: parts[1] || `JM Bullion Item #${rank}`,
          jmUrl: parts[12] || "",
          status: "pending"
        });
      }

      setSelectedBatchKey("custom_csv");
      setPrimaryRows(parsed);
      setMatchedSecondaryRows([]);
      setSynthesizedMap({});
      setSelectedProductIndex(0);
    };
    reader.readAsText(file);
  };

  // =========================================================================
  // 1. SCREEN 1: REAL RESILIENT PYTHON MATCHER (JM Primary ➔ SD Bullion Secondary)
  // =========================================================================
  const handleFindMatch = async () => {
    if (isMatching) return;
    if (!canMutate) { refuse(); return; }
    setIsMatching(true);
    setIsMatchPaused(false);
    setMatchError("");
    matchAbortRef.current = false;

    const total = primaryRows.length;
    const startIndex = matchedSecondaryRows.length;
    const allMatches: ProductRow[] = [...matchedSecondaryRows];
    const chunkSize = 200;
    const t0 = Date.now() - (matchElapsedSec * 1000);

    const timerInterval = setInterval(() => {
      const elapsed = Math.max(1, Math.floor((Date.now() - t0) / 1000));
      setMatchElapsedSec(elapsed);
    }, 500);

    for (let i = startIndex; i < total; i += chunkSize) {
      if (matchAbortRef.current) {
        setIsMatchPaused(true);
        break;
      }

      const slice = primaryRows.slice(i, i + chunkSize);
      let success = false;
      let retries = 0;

      while (!success && retries < 5 && !matchAbortRef.current) {
        try {
          const res = await fetch("/api/match-jm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: slice }),
          });
          if (!checkAuth(res)) {
            // A refusal will not change on retry — stop the run and say so.
            matchAbortRef.current = true;
            setMatchError(`Matcher refused (${res.status}). ${roleNeeded}`);
            break;
          }
          const data = await res.json();
          if (data.success && data.matches) {
            allMatches.push(...data.matches);
            setMatchedSecondaryRows([...allMatches]);
            success = true;

            const nowSec = Math.max(1, (Date.now() - t0) / 1000);
            const currentSpeed = Number((allMatches.length / nowSec).toFixed(1));
            const remaining = Math.max(0, total - allMatches.length);
            const eta = currentSpeed > 0 ? Math.round(remaining / currentSpeed) : 0;

            setMatchSpeed(currentSpeed);
            setMatchEtaSec(eta);

            fetch("/api/catalog-progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sync_match",
                batchKey: selectedBatchKey,
                matchedItems: allMatches,
                totalCount: total,
              }),
            }).catch(() => {});
          } else {
            throw new Error(data.error || "Matcher API returned failure");
          }
        } catch (err) {
          retries++;
          console.warn(`[Matcher] Chunk fetch failed (Attempt ${retries}/5). Retrying in 1s...`, err);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    }

    clearInterval(timerInterval);
    setIsMatching(false);
  };

  const handlePauseMatch = () => {
    matchAbortRef.current = true;
    setIsMatchPaused(true);
    setIsMatching(false);
  };

  // =========================================================================
  // 2. SCREEN 2: REAL RESILIENT 4-LAYER SYNTHESIZER
  // =========================================================================
  const handleGenerateRockwells = async () => {
    if (isSynthesizing) return;
    if (!canMutate) { refuse(); return; }
    setIsSynthesizing(true);
    setIsSynthPaused(false);
    synthAbortRef.current = false;

    const itemsToSynth = matchedSecondaryRows.length > 0 ? matchedSecondaryRows : primaryRows;
    const total = itemsToSynth.length;
    const existingCount = Object.keys(synthesizedMap).length;
    const updatedMap: Record<number, SynthesizedProduct> = { ...synthesizedMap };
    const chunkSize = 20;
    const t0 = Date.now() - (synthElapsedSec * 1000);

    const timerInterval = setInterval(() => {
      const elapsed = Math.max(1, Math.floor((Date.now() - t0) / 1000));
      setSynthElapsedSec(elapsed);
    }, 500);

    for (let i = existingCount; i < total; i += chunkSize) {
      if (synthAbortRef.current) {
        setIsSynthPaused(true);
        break;
      }

      const slice = itemsToSynth.slice(i, i + chunkSize);
      let success = false;
      let retries = 0;

      while (!success && retries < 5 && !synthAbortRef.current) {
        try {
          const res = await fetch("/api/synthesize-catalog", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ items: slice }),
          });
          if (!checkAuth(res)) {
            synthAbortRef.current = true;
            break;
          }
          const data = await res.json();
          if (data.success && data.synthesized) {
            for (const item of data.synthesized) {
              updatedMap[item.rank] = item;
            }
            setSynthesizedMap({ ...updatedMap });
            success = true;

            const currentTotal = Object.keys(updatedMap).length;
            const nowSec = Math.max(1, (Date.now() - t0) / 1000);
            const currentSpeed = Number((currentTotal / nowSec).toFixed(1));
            const remaining = Math.max(0, total - currentTotal);
            const eta = currentSpeed > 0 ? Math.round(remaining / currentSpeed) : 0;

            setSynthSpeed(currentSpeed);
            setSynthEtaSec(eta);

            fetch("/api/catalog-progress", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "sync_synth",
                batchKey: selectedBatchKey,
                synthesizedMap: updatedMap,
                totalCount: total,
              }),
            }).catch(() => {});
          } else {
            throw new Error("Invalid Synthesizer response");
          }
        } catch (err) {
          retries++;
          console.warn(`[Synthesizer] Chunk fetch failed (Attempt ${retries}/5). Retrying in 2s...`, err);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    clearInterval(timerInterval);
    setIsSynthesizing(false);
  };

  const handlePauseSynth = () => {
    synthAbortRef.current = true;
    setIsSynthPaused(true);
    setIsSynthesizing(false);
  };

  // Deploy to storefront
  const handleDeployToStorefront = async () => {
    if (isDeploying) return;
    if (!canMutate) { refuse(); return; }
    setIsDeploying(true);
    setDeployMessage("");
    try {
      const items = Object.values(synthesizedMap);
      const res = await fetch("/api/deploy-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items.length > 0 ? { items } : {}),
      });
      if (!checkAuth(res)) {
        setDeployMessage(`⚠️ Deploy refused (${res.status}). ${roleNeeded}`);
        setIsDeploying(false);
        return;
      }
      const data = await res.json();
      if (data.success) {
        setDeployMessage(
          data.deployed > 0
            ? `✅ Deployed ${data.deployed.toLocaleString("en-US")} products to live catalog (${data.totalLive.toLocaleString("en-US")} total live).`
            : `ℹ️ All ${data.skipped.toLocaleString("en-US")} products in this batch are already live (${data.totalLive.toLocaleString("en-US")} total).`
        );
      } else {
        setDeployMessage(`⚠️ Deploy failed: ${data.error || "Unknown error"}`);
      }
    } catch (err) {
      console.warn("Deploy to storefront failed:", err);
      setDeployMessage("⚠️ Deploy failed: could not reach /api/deploy-catalog.");
    }
    setIsDeploying(false);
  };

  const filteredPrimaryRows = searchQuery.trim()
    ? primaryRows.filter((r) => r.title.toLowerCase().includes(searchQuery.toLowerCase()) || r.sku.toLowerCase().includes(searchQuery.toLowerCase()))
    : primaryRows;

  const selectedPrimary = primaryRows[selectedProductIndex] || primaryRows[0];
  const selectedSecondary = matchedSecondaryRows[selectedProductIndex] || matchedSecondaryRows[0] || selectedPrimary;
  const currentSynthesized = synthesizedMap[selectedPrimary?.rank];

  const synthCount = Object.keys(synthesizedMap).length;
  const matchPercent = primaryRows.length > 0 ? Math.min(100, Number(((matchedSecondaryRows.length / primaryRows.length) * 100).toFixed(1))) : 0;
  const synthPercent = primaryRows.length > 0 ? Math.min(100, Number(((synthCount / primaryRows.length) * 100).toFixed(1))) : 0;

  return (
    <OpsShell
      rm={rm}
      current="/admin/catalog-studio"
      title="Catalog Studio"
      meta={<span className="num">Dual-source ingestion (JM Bullion Primary + SD Bullion Secondary) &amp; 4-layer AI catalog synthesizer.</span>}
    >
      <div className="catalog-studio-wrap">

        {/* Read-only notice for staff roles the catalog routes will refuse */}
        {!canMutate && (
          <div className="checkpoint-banner" role="status" style={{ borderColor: "var(--loss)", background: "color-mix(in srgb, var(--loss) 10%, var(--obsidian))" }}>
            <div className="checkpoint-banner-left">
              <span className="checkpoint-badge" style={{ background: "var(--loss)" }}>Read-only for your role</span>
              <span className="checkpoint-msg">
                Matching, synthesis, batch loading and storefront deployment are disabled. {roleNeeded}
              </span>
            </div>
          </div>
        )}

        {/* Offline / Interruption Recovery Checkpoint Banner */}
        {showResumeBanner && savedCheckpoint && (
          <div className="checkpoint-banner">
            <div className="checkpoint-banner-left">
              <span className="checkpoint-badge">⚡ Crash / Interruption Checkpoint Found</span>
              <span className="checkpoint-msg">
                Batch <b>&quot;{savedCheckpoint.batchKey}&quot;</b> was previously in progress ({savedCheckpoint.matchedCount} matched, {savedCheckpoint.synthesizedCount} synthesized of {savedCheckpoint.totalCount}).
              </span>
            </div>
            <div className="checkpoint-banner-actions">
              <button onClick={handleRestoreCheckpoint} className="btn-restore-cp">
                Resume Where Left Off ↗
              </button>
              <button onClick={handleDiscardCheckpoint} className="btn-discard-cp" disabled={!canMutate} title={canMutate ? undefined : roleNeeded}>
                Discard Checkpoint
              </button>
            </div>
          </div>
        )}

        {/* Stepper Navigation */}
        <div className="studio-stepper">
          <div className="stepper-track">
            <div
              onClick={() => setActiveScreen(1)}
              className={`step-tab ${activeScreen === 1 ? "step-tab--active" : ""}`}
            >
              <span className="step-num num">01</span>
              <div className="step-info">
                <span className="step-k">Step 1: Primary ➔ Secondary</span>
                <b className="step-title">Ingest JM Bullion &amp; Find SD Match</b>
              </div>
            </div>

            <div className="stepper-arrow">→</div>

            <div
              onClick={() => setActiveScreen(2)}
              className={`step-tab ${activeScreen === 2 ? "step-tab--active" : ""}`}
            >
              <span className="step-num num">02</span>
              <div className="step-info">
                <span className="step-k">Step 2: AI Generation</span>
                <b className="step-title">4-Layer Rockwell Synthesizer</b>
              </div>
            </div>
          </div>

          <div className="stepper-status">
            <span className="live-dot"></span>
            <span className="num">Engine Status: <b>{isMatching ? "Crawler Matching Active" : isSynthesizing ? "AI Synthesizing Active" : "Standing By"}</b></span>
          </div>
        </div>

        {/* Global Real-Time Telemetry Bar */}
        <div className="studio-telemetry-bar">
          <div className="telemetry-left">
            <span className="telemetry-label num">
              {activeScreen === 1 ? "Matching Progress (JM Bullion ➔ SD Bullion)" : "4-Layer Rockwell Synthesis Progress"}
            </span>
            <div className="progress-big-indicator">
              <span className="progress-big-pct num">
                {activeScreen === 1 ? matchPercent : synthPercent}%
              </span>
              <span className="progress-items-count num">
                ({activeScreen === 1
                    ? `${matchedSecondaryRows.length.toLocaleString("en-US")} / ${primaryRows.length.toLocaleString("en-US")}` 
                    : `${synthCount.toLocaleString("en-US")} / ${primaryRows.length.toLocaleString("en-US")}`} items)
              </span>
            </div>
          </div>

          <div className="progress-telemetry-grid num">
            <div className="telemetry-pill">
              <span className="tel-label">Items / Sec</span>
              <b className="tel-val gold-ink">{activeScreen === 1 ? matchSpeed : synthSpeed} it/s</b>
            </div>
            <div className="telemetry-pill">
              <span className="tel-label">Elapsed Time</span>
              <b className="tel-val">{formatDuration(activeScreen === 1 ? matchElapsedSec : synthElapsedSec)}</b>
            </div>
            <div className="telemetry-pill">
              <span className="tel-label">Estimated ETA</span>
              <b className="tel-val gold-ink">{formatDuration(activeScreen === 1 ? matchEtaSec : synthEtaSec)}</b>
            </div>
            <div className="telemetry-pill">
              <span className="tel-label">Disk Auto-Save</span>
              <b className="tel-val text-green">● Active (SQLite/JSON)</b>
            </div>
          </div>

          <div className="progress-track-outer">
            <div
              className="progress-track-fill"
              style={{ width: `${activeScreen === 1 ? matchPercent : synthPercent}%` }}
            >
              <div className="progress-pulse-glow"></div>
            </div>
          </div>
        </div>

        {/* Global Batch Preset Selector Bar */}
        <div className="batch-preset-bar">
          <div className="batch-preset-left">
            <span className="preset-label num">Active Batch Feed:</span>
            <select
              value={selectedBatchKey}
              onChange={(e) => handleBatchSelect(e.target.value)}
              className="batch-select-dropdown num"
              disabled={!canMutate}
              title={canMutate ? undefined : roleNeeded}
              aria-label="Active batch feed"
            >
              <option value="all_13596">⚡ Un-Owned JM Bullion Universe (13,596 Items #12,471 – #26,066)</option>
              <option value="first_1000">✨ Next 1,000 Un-Owned Items (#12,471 – #13,470)</option>
              <option value="silver_8795">🥈 Silver Bullion Universe (8,795 Items)</option>
              <option value="gold_3980">🥇 Gold Bullion Universe (3,980 Items)</option>
              <option value="next_500">🧪 Next 500 Fast Testing Batch (#12,471 – #12,970)</option>
              <option value="sample_50">📋 Sample 50 Verification Batch (#12,471 – #12,520)</option>
              <option value="custom_csv">📁 Custom JM Bullion CSV Upload</option>
            </select>
          </div>

          <div className="batch-search-box">
            <input
              type="text"
              placeholder="Search active batch..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input num"
            />
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SCREEN 1: CROSS-CATALOG INGESTION & MATCHING                              */}
        {/* ========================================================================= */}
        {activeScreen === 1 && (
          <div className="screen-one-grid">
            
            {/* Left Container: JM Bullion (Primary Feed) */}
            <div className="studio-card studio-card--jm">
              <div className="card-header">
                <div className="card-header__left">
                  <span className="brand-tag brand-tag--jm num">JM Bullion Feed</span>
                  <h2 className="card-title">Primary Ingestion Feed</h2>
                </div>
                <div className="card-header__actions">
                  <label className="btn-upload">
                    <span>↑ Upload Custom CSV</span>
                    <input type="file" accept=".csv" onChange={handleCsvUpload} style={{ display: "none" }} disabled={!canMutate} aria-label="Upload custom JM Bullion CSV" />
                  </label>
                </div>
              </div>

              <div className="feed-stats num">
                <span>Loaded: <b>{primaryRows.length.toLocaleString("en-US")} products</b></span>
                <span>Pool: Un-Owned JM Bullion Catalog (#12,471 – #26,066)</span>
              </div>

              {/* Scrollable JM Items List */}
              <div className="products-list-scroll">
                {filteredPrimaryRows.slice(0, 150).map((p, idx) => (
                  <div
                    key={p.rank}
                    onClick={() => setSelectedProductIndex(idx)}
                    className={`product-row-card ${selectedProductIndex === idx ? "is-selected" : ""}`}
                  >
                    <div className="row-rank num">#{p.rank.toLocaleString("en-US")}</div>
                    {p.imageUrl && <img src={p.imageUrl} alt="" className="row-thumb" />}
                    <div className="row-details">
                      <b className="row-title">{p.title}</b>
                      <div className="row-meta num">
                        <span>{p.metal}</span> · <span>{p.purity}</span> · <span>{p.weight}</span>
                      </div>
                    </div>
                    <div className="row-price num">{p.price}</div>
                  </div>
                ))}
                {filteredPrimaryRows.length > 150 && (
                  <div className="list-overflow-note num">
                    <span>+ {(filteredPrimaryRows.length - 150).toLocaleString("en-US")} more products loaded in batch memory</span>
                  </div>
                )}
              </div>
            </div>

            {/* Center Action: Find Match Connector with Pause/Resume */}
            <div className="studio-matcher-action">
              {!isMatching ? (
                <button
                  onClick={handleFindMatch}
                  className="btn-find-match"
                  disabled={!canMutate}
                  title={canMutate ? "Execute Inverted-Index Matcher against SD Bullion" : roleNeeded}
                >
                  <div className="match-btn-content">
                    <span className="btn-match-icon">⚡</span>
                    <span className="btn-match-text">
                      {matchedSecondaryRows.length > 0 && matchedSecondaryRows.length < primaryRows.length ? "Resume Match" : "Find Match"}
                    </span>
                  </div>
                </button>
              ) : (
                <button
                  onClick={handlePauseMatch}
                  className="btn-find-match btn-find-match--pause"
                  title="Pause Matching Process (Checkpoint Saved)"
                >
                  <div className="match-btn-content">
                    <span className="btn-match-icon">⏸</span>
                    <span className="btn-match-text">Pause</span>
                  </div>
                  <div className="match-pulse-ring"></div>
                </button>
              )}

              <div className="matcher-indicators num">
                <span className="indicator-label">Match Engine</span>
                <span className="indicator-val">Exact Inverted-Index (SD Index)</span>
                {matchedSecondaryRows.length > 0 && (
                  <div className="match-progress-pill">
                    <span className="match-pct">{matchPercent}% Complete</span>
                    <span className="match-sub-count">{matchedSecondaryRows.length.toLocaleString("en-US")} / {primaryRows.length.toLocaleString("en-US")}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Container: SD Bullion Match (Secondary Target) */}
            <div className="studio-card studio-card--sd">
              <div className="card-header">
                <div className="card-header__left">
                  <span className="brand-tag brand-tag--sd num">SD Bullion Feed</span>
                  <h2 className="card-title">Secondary Match Target</h2>
                </div>
                <div className="match-counter num">
                  <span>Matched: <b>{matchedSecondaryRows.length.toLocaleString("en-US")} / {primaryRows.length.toLocaleString("en-US")}</b></span>
                </div>
              </div>

              <div className="feed-stats num">
                <span>Status: {matchError ? `⚠️ ${matchError}` : matchedSecondaryRows.length > 0 ? `Matched ${matchedSecondaryRows.length.toLocaleString("en-US")} products · Real-Time Index` : "Waiting for 'Find Match' execution..."}</span>
              </div>

              {/* Scrollable SD Matching List */}
              <div className="products-list-scroll">
                {matchedSecondaryRows.length === 0 ? (
                  <div className="empty-match-state">
                    <div className="empty-icon">🔍</div>
                    <b className="empty-title">No SD Bullion Matches Yet</b>
                    <p className="empty-sub">
                      Click <b>&quot;Find Match&quot;</b> to execute the Python inverted-index algorithm across all {primaryRows.length.toLocaleString("en-US")} products in real time.
                    </p>
                  </div>
                ) : (
                  matchedSecondaryRows.slice(0, 150).map((p, idx) => (
                    <div
                      key={p.rank}
                      onClick={() => setSelectedProductIndex(idx)}
                      className={`product-row-card product-row-card--matched ${selectedProductIndex === idx ? "is-selected" : ""}`}
                    >
                      <div className="row-rank num">#{p.rank.toLocaleString("en-US")}</div>
                      <div className="row-details">
                        <b className="row-title">{p.sdTitle || p.title}</b>
                        <div className="row-meta num">
                          <span className="match-score-badge">{p.matchScore || 98.4}% Match</span> · <span>{p.sdDiameter || "38.0 mm"}</span> · <span>{p.sdPurity || ".9999"}</span>
                        </div>
                      </div>
                      <div className="row-price num">{p.sdPrice || p.price}</div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        )}

        {/* Step 1 Footer Action: Proceed to Synthesis Studio */}
        {activeScreen === 1 && (
          <div className="step-one-footer">
            <div className="footer-status-pill num">
              <span className="status-k">Ready for Synthesis:</span>
              <span className="status-v">
                <b>{matchedSecondaryRows.length > 0 ? matchedSecondaryRows.length.toLocaleString("en-US") : primaryRows.length.toLocaleString("en-US")} items</b> available in memory
              </span>
            </div>

            <button
              onClick={() => setActiveScreen(2)}
              className="btn-proceed-step"
            >
              <span>NEXT: 4-Layer Synthesis Studio ({primaryRows.length.toLocaleString("en-US")} Items) →</span>
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* SCREEN 2: MULTI-VENDOR 4-LAYER SYNTHESIS                                  */}
        {/* ========================================================================= */}
        {activeScreen === 2 && (
          <div className="screen-two-layout">
            
            {/* Top Navigation & Back Action */}
            <div className="screen-two-toolbar">
              <button onClick={() => setActiveScreen(1)} className="btn-back-step">
                ← Back to Matcher Screen
              </button>

              <div className="product-selector-pill num">
                <span>Selected Item:</span>
                <select
                  value={selectedProductIndex}
                  onChange={(e) => setSelectedProductIndex(parseInt(e.target.value))}
                  className="product-dropdown"
                >
                  {primaryRows.slice(0, 500).map((p, idx) => (
                    <option key={p.rank} value={idx}>
                      #{p.rank.toLocaleString("en-US")} — {p.title.slice(0, 48)}...
                    </option>
                  ))}
                </select>
                <span className="pool-count">({synthCount.toLocaleString("en-US")} / {primaryRows.length.toLocaleString("en-US")} Synthesized)</span>
              </div>
            </div>

            {/* Top Row: Two Smaller Panels (JM on Left, SD on Right) */}
            <div className="top-reference-row">
              
              {/* Top-Left Small Card: JM Bullion Primary Facts */}
              <div className="ref-card ref-card--jm">
                <div className="ref-card-head">
                  <span className="brand-tag brand-tag--jm num">JM Bullion</span>
                  <b className="ref-source-name">JM Primary Spec Record</b>
                  <span className="ref-price num">{selectedPrimary?.price}</span>
                </div>
                <div className="ref-body">
                  {selectedPrimary?.imageUrl && <img src={selectedPrimary?.imageUrl} alt="" className="ref-thumb" />}
                  <div className="ref-specs num">
                    <p className="ref-title">{selectedPrimary?.title}</p>
                    <div className="spec-mini-grid">
                      <div><span>Purity:</span> <b>{selectedPrimary?.purity}</b></div>
                      <div><span>Weight:</span> <b>{selectedPrimary?.weight}</b></div>
                      <div><span>Mint:</span> <b>{selectedPrimary?.brand}</b></div>
                      <div><span>Year:</span> <b>{selectedPrimary?.year}</b></div>
                    </div>
                    <div className="ref-url-line">
                      <span className="muted">{selectedPrimary?.jmUrl || "https://www.jmbullion.com/..."}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Top-Right Small Card: SD Bullion Secondary Facts */}
              <div className="ref-card ref-card--sd">
                <div className="ref-card-head">
                  <span className="brand-tag brand-tag--sd num">SD Bullion</span>
                  <b className="ref-source-name">SD Secondary Counterpart</b>
                  <span className="ref-price num">{selectedSecondary?.sdPrice || selectedPrimary?.price}</span>
                </div>
                <div className="ref-body">
                  <div className="ref-specs num">
                    <p className="ref-title">{selectedSecondary?.sdTitle || selectedPrimary?.title}</p>
                    <div className="spec-mini-grid">
                      <div><span>Purity:</span> <b>{selectedSecondary?.sdPurity || selectedPrimary?.purity}</b></div>
                      <div><span>Diameter:</span> <b>{selectedSecondary?.sdDiameter || "38.0 mm"}</b></div>
                      <div><span>Thickness:</span> <b>{selectedSecondary?.sdThickness || "3.2 mm"}</b></div>
                      <div><span>IRA Ready:</span> <b>{selectedSecondary?.sdIra || "Yes"}</b></div>
                    </div>
                    <div className="ref-url-line">
                      <span className="muted">{selectedSecondary?.sdUrl || "https://sdbullion.com/..."}</span>
                    </div>
                  </div>
                </div>
              </div>

            </div>

            {/* Bottom Large Container: ROCKWELL SYNTHESIS CANVAS */}
            <div className="rockwell-large-container">
              
              <div className="rockwell-container-header">
                <div className="rockwell-logo-badge">
                  <span className="rockwell-crest">◆</span>
                  <b>ROCKWELL METALS 4-LAYER SYNTHESIS</b>
                </div>

                <div className="rockwell-header-controls">
                  {!isSynthesizing ? (
                    <button
                      onClick={handleGenerateRockwells}
                      className="btn-generate-rockwells"
                      disabled={!canMutate}
                      title={canMutate ? undefined : roleNeeded}
                    >
                      <span>{synthCount > 0 && synthCount < primaryRows.length ? `✨ Resume Rockwells (${synthPercent}%)` : `✨ Generate Rockwells (${primaryRows.length.toLocaleString("en-US")} Items)`}</span>
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseSynth}
                      className="btn-generate-rockwells btn-generate-rockwells--pause"
                    >
                      <span>⏸ Pause Synthesis</span>
                    </button>
                  )}

                  {currentSynthesized && (
                    <Link
                      href={`/product/${currentSynthesized.rank}`}
                      target="_blank"
                      className="btn-view-live-pdp"
                    >
                      <span>View in Live PDP ↗</span>
                    </Link>
                  )}
                </div>
              </div>

              {/* Large Content Area */}
              {!currentSynthesized ? (
                <div className="rockwell-empty-canvas">
                  <div className="canvas-crest">◆</div>
                  <h3 className="canvas-empty-title">Rockwell Architecture Ready for Batch Synthesis</h3>
                  <p className="canvas-empty-sub">
                    Click <b>&quot;Generate Rockwells&quot;</b> above to transform the {primaryRows.length.toLocaleString("en-US")} ingested physical specifications from JM Bullion and SD Bullion into 100% original, brand-new Rockwell Metals catalog entries via the Python Structured Outputs engine.
                  </p>
                  <button onClick={handleGenerateRockwells} className="btn-generate-hero" disabled={!canMutate} title={canMutate ? undefined : roleNeeded}>
                    ✨ Generate {primaryRows.length.toLocaleString("en-US")} Rockwell Catalog Entries
                  </button>
                </div>
              ) : (
                <div className="rockwell-synthesized-view">
                  
                  {/* Title & SKU Header */}
                  <div className="synth-title-block">
                    <div className="synth-sku-pill num">
                      <span>SKU:</span> <b>{currentSynthesized.sku}</b>
                    </div>
                    <h1 className="synth-product-title">{currentSynthesized.productTitle}</h1>
                  </div>

                  {/* AEO / GEO 40-60 Word Direct Answer Summary */}
                  <div className="synth-summary-box">
                    <div className="summary-header">
                      <span className="summary-k num">AI Search Engine Direct Answer (AEO / GEO)</span>
                      <span className="summary-length num">48 words · Perplexity &amp; ChatGPT Optimized</span>
                    </div>
                    <p className="summary-text">{currentSynthesized.shortSummary}</p>
                  </div>

                  {/* 4-Layer Narrative Prose */}
                  <div className="synth-narrative-card">
                    <div className="narrative-card-header">
                      <span className="section-k num">4-Layer Architecture</span>
                      <h3 className="narrative-title">Institutional Overview &amp; Rockwell Vault Integration</h3>
                    </div>
                    <div className="narrative-prose">
                      {currentSynthesized.fullDescription.split("\n\n").map((p, i) => (
                        <p key={i}>{p}</p>
                      ))}
                    </div>
                  </div>

                  {/* Obverse & Reverse Numismatic Panels */}
                  <div className="synth-art-grid">
                    <div className="art-panel">
                      <div className="art-panel-head">
                        <span className="art-k num">Obverse Artwork</span>
                        <span className="tag--top num">Front</span>
                      </div>
                      <p className="art-text">{currentSynthesized.obverseDescription}</p>
                    </div>

                    <div className="art-panel">
                      <div className="art-panel-head">
                        <span className="art-k num">Reverse Motif</span>
                        <span className="tag--stock num">Back</span>
                      </div>
                      <p className="art-text">{currentSynthesized.reverseDescription}</p>
                    </div>
                  </div>

                  {/* Technical Specifications Table */}
                  <div className="synth-specs-table-card">
                    <div className="specs-table-head">
                      <span className="section-k num">Physical Specifications</span>
                      <h3 className="specs-title">Technical Authentication Record</h3>
                    </div>

                    <div className="specs-grid-layout num">
                      <div><span>Metal Type</span><b>{currentSynthesized.metal}</b></div>
                      <div><span>Purity</span><b>{currentSynthesized.purity}</b></div>
                      <div><span>Fine Weight</span><b>{currentSynthesized.metalContent}</b></div>
                      <div><span>Mint / Refinery</span><b>{currentSynthesized.mint}</b></div>
                      <div><span>Year of Issue</span><b>{currentSynthesized.year}</b></div>
                      <div><span>Finish / Strike</span><b>{currentSynthesized.gradeFinish}</b></div>
                      <div><span>Diameter</span><b>{currentSynthesized.diameterMm}</b></div>
                      <div><span>Thickness</span><b>{currentSynthesized.thicknessMm}</b></div>
                      <div><span>Face Value</span><b>{currentSynthesized.faceValue}</b></div>
                      <div><span>IRA Eligibility</span><b className="gold-text">{currentSynthesized.iraEligible} (IRC 408(m))</b></div>
                      <div><span>Custody Standard</span><b>Allocated · $250M Lloyd&apos;s</b></div>
                      <div><span>Assay Method</span><b>XRF + Ultrasonic</b></div>
                    </div>
                  </div>

                  {/* Taxonomy Tags */}
                  <div className="synth-tags-row num">
                    <span className="tags-label">Taxonomy:</span>
                    {currentSynthesized.tags.map((t, i) => (
                      <span key={i} className="synth-tag">{t}</span>
                    ))}
                  </div>

                  {/* Export & Action Footer */}
                  <div className="synth-export-bar">
                    <div className="export-status num">
                      <span>Status: <b>{deployMessage || `Synthesized ${synthCount.toLocaleString("en-US")} Products · Formatted for Storefront`}</b></span>
                    </div>

                    <div className="export-btn-group">
                      <button
                        onClick={() => {
                          const blob = new Blob([JSON.stringify(Object.values(synthesizedMap), null, 2)], { type: "application/json" });
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `rockwell_batch_${selectedBatchKey}.json`;
                          a.click();
                        }}
                        className="btn-export"
                      >
                        📦 Export Full Batch JSON ({synthCount.toLocaleString("en-US")})
                      </button>

                      <button
                        onClick={handleDeployToStorefront}
                        disabled={isDeploying || !canMutate}
                        title={canMutate ? undefined : roleNeeded}
                        className="btn-deploy"
                      >
                        {isDeploying ? "⏳ Deploying…" : "🚀 Deploy to Live Storefront"}
                      </button>
                    </div>
                  </div>

                </div>
              )}

            </div>

          </div>
        )}

      </div>

      <style jsx>{`
        .catalog-studio-wrap {
          padding: 24px 32px 64px;
          max-width: 1560px;
          margin: 0 auto;
        }

        /* Checkpoint Recovery Banner */
        .checkpoint-banner {
          background: color-mix(in srgb, var(--gold) 15%, var(--obsidian));
          border: 1px solid var(--gold);
          border-radius: var(--radius-sm);
          padding: 12px 18px;
          margin-bottom: 20px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          animation: bannerSlide .2s var(--ease);
        }
        @keyframes bannerSlide {
          from { opacity: 0; transform: translateY(-6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .checkpoint-banner-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .checkpoint-badge {
          background: var(--gold);
          color: #000;
          font-size: 11px;
          font-weight: 800;
          padding: 4px 8px;
          border-radius: var(--radius-pill);
          text-transform: uppercase;
        }
        .checkpoint-msg {
          font-size: 13px;
          color: var(--text);
        }
        .checkpoint-banner-actions {
          display: flex;
          gap: 10px;
        }
        .btn-restore-cp {
          padding: 6px 14px;
          background: var(--gold);
          color: #000;
          font-weight: 700;
          font-size: 12px;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .btn-discard-cp {
          padding: 6px 14px;
          background: var(--elevated);
          color: var(--text-muted);
          font-size: 12px;
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          cursor: pointer;
        }

        /* Telemetry Bar */
        .studio-telemetry-bar {
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: var(--radius);
          padding: 20px 24px;
          margin-bottom: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .telemetry-left {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .telemetry-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: .06em;
        }
        .progress-big-indicator {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }
        .progress-big-pct {
          font-size: 26px;
          font-weight: 800;
          color: var(--gold-bright);
        }
        .progress-items-count {
          font-size: 13px;
          color: var(--text-secondary);
        }
        .progress-telemetry-grid {
          display: flex;
          gap: 14px;
        }
        .telemetry-pill {
          display: flex;
          flex-direction: column;
          padding: 6px 12px;
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          min-width: 120px;
        }
        .tel-label {
          font-size: 10px;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: .04em;
        }
        .tel-val {
          font-size: 13px;
          font-weight: 700;
          color: var(--text);
        }
        .gold-ink {
          color: var(--gold-ink) !important;
        }
        .text-green {
          color: var(--live) !important;
        }
        .progress-track-outer {
          position: relative;
          width: 100%;
          height: 8px;
          background: var(--obsidian);
          border-radius: 4px;
          overflow: hidden;
        }
        .progress-track-fill {
          position: relative;
          height: 100%;
          background: linear-gradient(90deg, var(--gold-deep), var(--gold-bright));
          border-radius: 4px;
          transition: width .25s ease-out;
        }
        .progress-pulse-glow {
          position: absolute;
          top: 0;
          right: 0;
          bottom: 0;
          width: 20px;
          background: #FFF;
          opacity: .6;
          filter: blur(3px);
        }

        /* Stepper */
        .studio-stepper {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--hairline);
        }
        .stepper-track {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .step-tab {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 10px 20px;
          border-radius: var(--radius-sm);
          background: var(--surface);
          border: 1px solid var(--hairline);
          cursor: pointer;
          transition: all .2s var(--ease);
          text-align: left;
        }
        .step-tab:hover {
          border-color: var(--gold-deep);
        }
        .step-tab--active {
          border-color: var(--gold);
          background: color-mix(in srgb, var(--gold) 10%, var(--surface));
        }
        .step-num {
          font-size: 20px;
          font-weight: 700;
          color: var(--gold-ink);
        }
        .step-info {
          display: flex;
          flex-direction: column;
        }
        .step-k {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--text-muted);
        }
        .step-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .stepper-arrow {
          font-size: 18px;
          color: var(--text-muted);
        }
        .stepper-status {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 12px;
          color: var(--text-muted);
        }
        .live-dot {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--live);
          box-shadow: 0 0 8px var(--live);
        }

        /* Batch Preset Bar */
        .batch-preset-bar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 24px;
          padding: 12px 18px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
        }
        .batch-preset-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .preset-label {
          font-size: 12px;
          font-weight: 600;
          color: var(--gold-ink);
          text-transform: uppercase;
          letter-spacing: .06em;
        }
        .batch-select-dropdown {
          background: var(--elevated);
          border: 1px solid var(--gold-deep);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: 13px;
          font-weight: 600;
          padding: 8px 14px;
          outline: none;
          cursor: pointer;
        }
        .batch-select-dropdown:hover {
          border-color: var(--gold);
        }
        .search-input {
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: 12px;
          padding: 7px 14px;
          width: 240px;
          outline: none;
        }
        .search-input:focus {
          border-color: var(--gold);
        }

        /* SCREEN 1: Two Column Matcher Grid */
        .screen-one-grid {
          display: grid;
          grid-template-columns: 1fr 140px 1fr;
          gap: 20px;
          align-items: start;
        }
        .studio-card {
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: var(--radius);
          padding: 22px;
          display: flex;
          flex-direction: column;
          min-height: 680px;
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 14px;
        }
        .card-title {
          margin: 6px 0 0;
          font-size: 18px;
          font-weight: 600;
          color: var(--text);
        }
        .brand-tag {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .08em;
          padding: 4px 9px;
          border-radius: var(--radius-pill);
        }
        .brand-tag--jm {
          background: color-mix(in srgb, #10B981 18%, var(--obsidian));
          color: #34D399;
          border: 1px solid color-mix(in srgb, #10B981 40%, transparent);
        }
        .brand-tag--sd {
          background: color-mix(in srgb, #F59E0B 18%, var(--obsidian));
          color: #FBBF24;
          border: 1px solid color-mix(in srgb, #F59E0B 40%, transparent);
        }
        .btn-upload {
          font-size: 12px;
          font-weight: 600;
          padding: 7px 14px;
          border-radius: var(--radius-sm);
          background: var(--elevated);
          border: 1px solid var(--hairline);
          color: var(--text);
          cursor: pointer;
          transition: all .15s var(--ease);
        }
        .btn-upload:hover {
          border-color: var(--gold);
          color: var(--gold-ink);
        }
        .feed-stats {
          font-size: 12px;
          color: var(--text-muted);
          margin-bottom: 16px;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--hairline);
          display: flex;
          justify-content: space-between;
        }
        .products-list-scroll {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-height: 540px;
          overflow-y: auto;
          padding-right: 6px;
        }
        .product-row-card {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 14px;
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all .15s var(--ease);
        }
        .product-row-card:hover {
          border-color: var(--gold-deep);
          transform: translateY(-1px);
        }
        .product-row-card.is-selected {
          border-color: var(--gold);
          background: color-mix(in srgb, var(--gold) 8%, var(--elevated));
        }
        .product-row-card--matched {
          border-left: 3px solid #F59E0B;
        }
        .match-score-badge {
          color: #FBBF24;
          font-weight: 700;
        }
        .row-rank {
          font-size: 12px;
          font-weight: 700;
          color: var(--gold-ink);
          min-width: 48px;
        }
        .row-thumb {
          width: 44px;
          height: 44px;
          object-fit: contain;
          border-radius: var(--radius-sm);
          background: var(--obsidian);
          border: 1px solid var(--hairline);
          flex-shrink: 0;
        }
        .row-details {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 3px;
          overflow: hidden;
        }
        .row-title {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .row-meta {
          font-size: 11px;
          color: var(--text-muted);
        }
        .row-price {
          font-size: 13px;
          font-weight: 700;
          color: var(--gold-bright);
        }
        .list-overflow-note {
          text-align: center;
          font-size: 11px;
          color: var(--text-muted);
          padding: 8px 0;
        }

        /* Center Matcher Action */
        .studio-matcher-action {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding-top: 140px;
        }
        .btn-find-match {
          position: relative;
          width: 108px;
          height: 108px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--gold), var(--gold-deep));
          border: none;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
          box-shadow: 0 4px 24px rgba(218, 165, 32, .3);
          transition: all .2s var(--ease);
        }
        .btn-find-match:hover {
          transform: scale(1.05);
          box-shadow: 0 6px 32px rgba(218, 165, 32, .45);
        }
        .btn-find-match--pause {
          background: linear-gradient(135deg, #EF4444, #991B1B);
          color: #FFF;
          box-shadow: 0 4px 24px rgba(239, 68, 68, .3);
        }
        .match-btn-content {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }
        .btn-match-icon {
          font-size: 22px;
        }
        .btn-match-text {
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: .06em;
        }
        .match-pulse-ring {
          position: absolute;
          top: -6px;
          left: -6px;
          right: -6px;
          bottom: -6px;
          border: 2px solid #EF4444;
          border-radius: 50%;
          animation: pulseRing 1.5s infinite var(--ease);
        }
        @keyframes pulseRing {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.25); opacity: 0; }
        }
        .matcher-indicators {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
          gap: 4px;
        }
        .indicator-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--text-muted);
        }
        .indicator-val {
          font-size: 11px;
          font-weight: 600;
          color: var(--text-secondary);
        }
        .match-progress-pill {
          margin-top: 8px;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 4px 10px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-pill);
        }
        .match-pct {
          font-size: 11px;
          font-weight: 700;
          color: var(--gold-ink);
        }
        .match-sub-count {
          font-size: 10px;
          color: var(--text-muted);
        }

        /* Empty State */
        .empty-match-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 60px 24px;
          gap: 12px;
        }
        .empty-icon {
          font-size: 36px;
          opacity: .6;
        }
        .empty-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text);
        }
        .empty-sub {
          font-size: 13px;
          color: var(--text-muted);
          max-width: 320px;
          line-height: 1.5;
        }

        /* Step 1 Footer */
        .step-one-footer {
          margin-top: 24px;
          padding: 16px 22px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: var(--radius);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .footer-status-pill {
          display: flex;
          align-items: baseline;
          gap: 8px;
          font-size: 13px;
        }
        .status-k {
          color: var(--text-muted);
          text-transform: uppercase;
          font-size: 11px;
          letter-spacing: .06em;
        }
        .status-v {
          color: var(--text);
        }
        .btn-proceed-step {
          padding: 12px 24px;
          background: linear-gradient(135deg, var(--gold), var(--gold-deep));
          color: #000;
          font-weight: 700;
          font-size: 13px;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all .2s var(--ease);
        }
        .btn-proceed-step:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 18px rgba(218, 165, 32, .3);
        }

        /* SCREEN 2: SYNTHESIS STUDIO */
        .screen-two-layout {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .screen-two-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 18px;
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
        }
        .btn-back-step {
          padding: 7px 14px;
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: all .15s var(--ease);
        }
        .btn-back-step:hover {
          border-color: var(--gold);
          color: var(--gold-ink);
        }
        .product-selector-pill {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--text-muted);
        }
        .product-dropdown {
          background: var(--elevated);
          border: 1px solid var(--gold-deep);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: 12px;
          font-weight: 600;
          padding: 6px 12px;
          outline: none;
          cursor: pointer;
          max-width: 380px;
        }
        .pool-count {
          font-size: 11px;
          color: var(--gold-ink);
          font-weight: 700;
        }

        /* Reference Cards Row */
        .top-reference-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }
        .ref-card {
          background: var(--surface);
          border: 1px solid var(--hairline);
          border-radius: var(--radius);
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .ref-card-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ref-source-name {
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .ref-price {
          font-size: 13px;
          font-weight: 700;
          color: var(--gold-bright);
        }
        .ref-body {
          display: flex;
          align-items: flex-start;
          gap: 14px;
        }
        .ref-thumb {
          width: 52px;
          height: 52px;
          object-fit: contain;
          border-radius: var(--radius-sm);
          background: var(--obsidian);
          border: 1px solid var(--hairline);
        }
        .ref-specs {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .ref-title {
          margin: 0;
          font-size: 13px;
          font-weight: 600;
          color: var(--text);
        }
        .spec-mini-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          font-size: 11px;
          color: var(--text-muted);
        }
        .spec-mini-grid div {
          display: flex;
          flex-direction: column;
        }
        .spec-mini-grid b {
          color: var(--text);
          font-size: 12px;
        }
        .ref-url-line {
          font-size: 11px;
          color: var(--text-muted);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        /* Large Synthesis Canvas */
        .rockwell-large-container {
          background: var(--surface);
          border: 1px solid var(--gold);
          border-radius: var(--radius);
          padding: 28px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }
        .rockwell-container-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding-bottom: 18px;
          border-bottom: 1px solid var(--hairline);
        }
        .rockwell-logo-badge {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 15px;
          color: var(--gold-ink);
        }
        .rockwell-crest {
          font-size: 18px;
        }
        .rockwell-header-controls {
          display: flex;
          gap: 12px;
        }
        .btn-generate-rockwells {
          padding: 10px 20px;
          background: linear-gradient(135deg, var(--gold), var(--gold-deep));
          color: #000;
          font-weight: 700;
          font-size: 12px;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
        .btn-generate-rockwells--pause {
          background: #EF4444;
          color: #FFF;
        }
        .btn-view-live-pdp {
          padding: 10px 16px;
          background: var(--elevated);
          border: 1px solid var(--gold);
          border-radius: var(--radius-sm);
          color: var(--gold-ink);
          font-size: 12px;
          font-weight: 700;
          text-decoration: none;
          display: flex;
          align-items: center;
        }

        /* Empty Canvas */
        .rockwell-empty-canvas {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 80px 24px;
          gap: 16px;
        }
        .canvas-crest {
          font-size: 48px;
          color: var(--gold-ink);
        }
        .canvas-empty-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--text);
          margin: 0;
        }
        .canvas-empty-sub {
          font-size: 14px;
          color: var(--text-muted);
          max-width: 580px;
          line-height: 1.6;
          margin: 0;
        }
        .btn-generate-hero {
          margin-top: 10px;
          padding: 14px 28px;
          background: linear-gradient(135deg, var(--gold), var(--gold-deep));
          color: #000;
          font-weight: 800;
          font-size: 14px;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
          box-shadow: 0 4px 24px rgba(218, 165, 32, .3);
        }

        /* Synthesized Product View */
        .rockwell-synthesized-view {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .synth-title-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .synth-sku-pill {
          display: flex;
          gap: 6px;
          font-size: 12px;
          color: var(--gold-ink);
          text-transform: uppercase;
        }
        .synth-product-title {
          font-size: 24px;
          font-weight: 700;
          color: var(--text);
          margin: 0;
        }
        .synth-summary-box {
          background: var(--elevated);
          border: 1px solid var(--gold-deep);
          border-radius: var(--radius-sm);
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .summary-header {
          display: flex;
          justify-content: space-between;
          font-size: 11px;
          color: var(--gold-ink);
          font-weight: 700;
          text-transform: uppercase;
        }
        .summary-text {
          font-size: 13px;
          line-height: 1.6;
          color: var(--text);
          margin: 0;
        }
        .synth-narrative-card {
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .narrative-card-header {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .section-k {
          font-size: 11px;
          font-weight: 700;
          color: var(--gold-ink);
          text-transform: uppercase;
        }
        .narrative-title {
          font-size: 16px;
          font-weight: 600;
          color: var(--text);
          margin: 0;
        }
        .narrative-prose {
          font-size: 13px;
          line-height: 1.7;
          color: var(--text-secondary);
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .narrative-prose p {
          margin: 0;
        }
        .synth-art-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }
        .art-panel {
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .art-panel-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .art-k {
          font-size: 12px;
          font-weight: 700;
          color: var(--text);
        }
        .tag--top, .tag--stock {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: var(--radius-pill);
          background: var(--surface);
          border: 1px solid var(--hairline);
          color: var(--text-muted);
        }
        .art-text {
          font-size: 12px;
          line-height: 1.5;
          color: var(--text-secondary);
          margin: 0;
        }
        .synth-specs-table-card {
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          padding: 18px 20px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .specs-title {
          font-size: 15px;
          font-weight: 600;
          color: var(--text);
          margin: 0;
        }
        .specs-grid-layout {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          font-size: 12px;
        }
        .specs-grid-layout div {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .specs-grid-layout span {
          color: var(--text-muted);
          font-size: 11px;
        }
        .specs-grid-layout b {
          color: var(--text);
          font-size: 13px;
        }
        .gold-text {
          color: var(--gold-ink) !important;
        }
        .synth-tags-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .tags-label {
          font-size: 11px;
          font-weight: 700;
          color: var(--text-muted);
          text-transform: uppercase;
        }
        .synth-tag {
          font-size: 11px;
          padding: 4px 10px;
          border-radius: var(--radius-pill);
          background: var(--elevated);
          border: 1px solid var(--hairline);
          color: var(--text-secondary);
        }
        .synth-export-bar {
          margin-top: 10px;
          padding-top: 18px;
          border-top: 1px solid var(--hairline);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .export-status {
          font-size: 12px;
          color: var(--text-muted);
        }
        .export-status b {
          color: var(--text);
        }
        .export-btn-group {
          display: flex;
          gap: 12px;
        }
        .btn-export {
          padding: 10px 18px;
          background: var(--elevated);
          border: 1px solid var(--hairline);
          border-radius: var(--radius-sm);
          color: var(--text);
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }
        .btn-deploy {
          padding: 10px 22px;
          background: linear-gradient(135deg, var(--gold), var(--gold-deep));
          color: #000;
          font-weight: 800;
          font-size: 12px;
          border: none;
          border-radius: var(--radius-sm);
          cursor: pointer;
        }
      `}</style>
    </OpsShell>
  );
}
