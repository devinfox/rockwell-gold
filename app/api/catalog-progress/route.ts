// Catalog Studio checkpoint (staff tooling).
//
//   GET  /api/catalog-progress             summary only (counts, stage, timings)
//   GET  /api/catalog-progress?include=items  + matchedItems / synthesizedItems
//   POST /api/catalog-progress { action, ... }
//
// The checkpoint file can reach tens of megabytes. The summary form is what
// the studio page needs on load; items are fetched only to resume a run
// (audit: Medium — every page load shipped a ~40 MB file). Writes are bounded:
// request bodies are capped, item arrays are capped at the batch size, and the
// generic update only accepts the checkpoint's own scalar fields.

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { requireStaff } from "../../lib/api-guard";

const CHECKPOINT_PATH = path.join(process.cwd(), "data", "catalog_studio_checkpoint.json");
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const MAX_ITEMS = 25_000;

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
  matchedItems: unknown[];
  synthesizedItems: Record<string, unknown>;
}

type Summary = Omit<StudioCheckpoint, "matchedItems" | "synthesizedItems">;

const STAGES: StudioCheckpoint["stage"][] = ["idle", "matching", "synthesizing", "completed", "paused"];

function getDefaultCheckpoint(): StudioCheckpoint {
  return {
    batchKey: "next_5000",
    stage: "idle",
    totalCount: 5000,
    matchedCount: 0,
    synthesizedCount: 0,
    startTime: null,
    lastUpdatedTime: null,
    elapsedSeconds: 0,
    itemsPerSecond: 0,
    etaSeconds: 0,
    matchedItems: [],
    synthesizedItems: {},
  };
}

function readCheckpoint(): StudioCheckpoint {
  try {
    if (fs.existsSync(CHECKPOINT_PATH)) {
      const data = fs.readFileSync(CHECKPOINT_PATH, "utf-8");
      const cp = JSON.parse(data) as Partial<StudioCheckpoint>;
      return { ...getDefaultCheckpoint(), ...cp, matchedItems: Array.isArray(cp.matchedItems) ? cp.matchedItems : [], synthesizedItems: cp.synthesizedItems && typeof cp.synthesizedItems === "object" ? cp.synthesizedItems : {} };
    }
  } catch (err) {
    console.error("Error reading studio checkpoint:", err);
  }
  return getDefaultCheckpoint();
}

function writeCheckpoint(cp: StudioCheckpoint) {
  const dir = path.dirname(CHECKPOINT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Atomic replace so a crash mid-write cannot leave a truncated checkpoint.
  const tmp = `${CHECKPOINT_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cp), "utf-8");
  fs.renameSync(tmp, CHECKPOINT_PATH);
}

const summaryOf = (cp: StudioCheckpoint): Summary => {
  const { matchedItems: _m, synthesizedItems: _s, ...rest } = cp;
  return rest;
};

const asKey = (v: unknown, fallback: string) =>
  typeof v === "string" && /^[A-Za-z0-9_.-]{1,64}$/.test(v) ? v : fallback;
const asCount = (v: unknown, fallback: number) =>
  Number.isInteger(v) && (v as number) > 0 && (v as number) <= MAX_ITEMS ? (v as number) : fallback;

function tick(cp: StudioCheckpoint, done: number, total: number, stage: StudioCheckpoint["stage"]) {
  const now = Date.now();
  if (!cp.startTime) cp.startTime = now;
  cp.lastUpdatedTime = now;
  cp.totalCount = total;
  cp.stage = done >= total ? "completed" : stage;
  const elapsed = Math.max(1, (now - cp.startTime) / 1000);
  cp.elapsedSeconds = Math.round(elapsed);
  cp.itemsPerSecond = Number((done / elapsed).toFixed(1));
  const remaining = Math.max(0, total - done);
  cp.etaSeconds = cp.itemsPerSecond > 0 ? Math.round(remaining / cp.itemsPerSecond) : 0;
}

export async function GET(req: NextRequest) {
  const gate = await requireStaff();
  if (!gate.ok) return gate.response;

  const cp = readCheckpoint();
  const includeItems = req.nextUrl.searchParams.get("include") === "items";
  return NextResponse.json(
    { success: true, checkpoint: includeItems ? cp : { ...summaryOf(cp), matchedItems: [], synthesizedItems: {} }, itemsIncluded: includeItems },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const gate = await requireStaff(["SUPER_ADMIN", "OPS_VAULT"]);
  if (!gate.ok) return gate.response;

  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ success: false, error: "Checkpoint payload too large." }, { status: 413 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: "Malformed request." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ success: false, error: "Malformed request." }, { status: 400 });
  }

  const action = String(body.action ?? "");

  try {
    let cp = readCheckpoint();
    const batchKey = asKey(body.batchKey, cp.batchKey);

    // A sync for a different batch means a new run started without an explicit
    // reset — carrying over the old batch's items/timers corrupts progress.
    if ((action === "sync_matches" || action === "sync_synth") && batchKey !== cp.batchKey) {
      cp = getDefaultCheckpoint();
      cp.batchKey = batchKey;
      cp.totalCount = asCount(body.totalCount, cp.totalCount);
    }

    if (action === "reset") {
      cp = getDefaultCheckpoint();
      cp.batchKey = asKey(body.batchKey, "next_5000");
      cp.totalCount = asCount(body.totalCount, 5000);
      writeCheckpoint(cp);
      return NextResponse.json({ success: true, checkpoint: summaryOf(cp) });
    }

    if (action === "sync_matches") {
      if (!Array.isArray(body.matches)) return NextResponse.json({ success: false, error: "matches must be an array." }, { status: 400 });
      const total = asCount(body.totalCount, cp.totalCount);
      cp.matchedItems = body.matches.slice(0, Math.min(MAX_ITEMS, total));
      cp.matchedCount = cp.matchedItems.length;
      tick(cp, cp.matchedCount, total, "matching");
      writeCheckpoint(cp);
      return NextResponse.json({ success: true, checkpoint: summaryOf(cp) });
    }

    if (action === "sync_synth") {
      const map = body.synthesizedMap;
      if (!map || typeof map !== "object" || Array.isArray(map)) {
        return NextResponse.json({ success: false, error: "synthesizedMap must be an object." }, { status: 400 });
      }
      const total = asCount(body.totalCount, cp.totalCount);
      const entries = Object.entries(map as Record<string, unknown>).slice(0, Math.min(MAX_ITEMS, total));
      cp.synthesizedItems = Object.fromEntries(entries);
      cp.synthesizedCount = entries.length;
      tick(cp, cp.synthesizedCount, total, "synthesizing");
      writeCheckpoint(cp);
      return NextResponse.json({ success: true, checkpoint: summaryOf(cp) });
    }

    if (action === "update" || body.checkpoint) {
      // Only the checkpoint's own scalar fields may be patched — never items.
      const patch = (body.checkpoint ?? {}) as Partial<Summary>;
      if (patch.stage !== undefined && STAGES.includes(patch.stage)) cp.stage = patch.stage;
      if (patch.batchKey !== undefined) cp.batchKey = asKey(patch.batchKey, cp.batchKey);
      if (patch.totalCount !== undefined) cp.totalCount = asCount(patch.totalCount, cp.totalCount);
      cp.lastUpdatedTime = Date.now();
      writeCheckpoint(cp);
      return NextResponse.json({ success: true, checkpoint: summaryOf(cp) });
    }

    return NextResponse.json({ success: false, error: "Unknown action." }, { status: 400 });
  } catch (error) {
    console.error("Checkpoint API error:", error);
    return NextResponse.json({ success: false, error: "Failed to update checkpoint" }, { status: 500 });
  }
}
