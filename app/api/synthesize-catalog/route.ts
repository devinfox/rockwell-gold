import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { requireStaff } from "../../lib/api-guard";

/** Hard ceiling so a hung child can't hold the request open indefinitely. */
const TIMEOUT_MS = 120_000;

export async function POST(req: NextRequest) {
  const gate = await requireStaff(["SUPER_ADMIN", "OPS_VAULT"]);
  if (!gate.ok) return gate.response;

  try {
    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    if (!items.length) return NextResponse.json({ success: true, synthesized: [] });

    const scriptPath = path.join(process.cwd(), "scripts", "synthesize_batch.py");
    const child = spawn("python3", [scriptPath]);

    let stdoutData = "";
    let stderrData = "";
    child.stdout.on("data", (d) => { stdoutData += d.toString(); });
    child.stderr.on("data", (d) => { stderrData += d.toString(); });

    return await new Promise<NextResponse>((resolve) => {
      let settled = false;
      const done = (res: NextResponse) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res);
      };

      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        console.error("[synthesizer] timed out after {TIMEOUT_MS}ms");
        done(NextResponse.json({ success: false, error: "The synthesizer timed out." }, { status: 504 }));
      }, TIMEOUT_MS);

      child.on("error", (err) => {
        console.error("[synthesizer] failed to start:", err);
        done(NextResponse.json({ success: false, error: "Could not start the synthesizer." }, { status: 500 }));
      });

      child.on("close", (code) => {
        if (code !== 0) {
          // Detail is logged server-side only — stderr leaks paths and env (audit S-08).
          console.error("[synthesizer] exited", code, stderrData);
          return done(NextResponse.json({ success: false, error: "The synthesizer failed." }, { status: 500 }));
        }
        try {
          return done(NextResponse.json({ success: true, synthesized: JSON.parse(stdoutData) }));
        } catch (err) {
          console.error("[synthesizer] produced invalid JSON:", err);
          return done(NextResponse.json({ success: false, error: "The synthesizer returned an invalid response." }, { status: 500 }));
        }
      });

      child.stdin.write(JSON.stringify(items));
      child.stdin.end();
    });
  } catch (error) {
    console.error("[synthesizer] route error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
