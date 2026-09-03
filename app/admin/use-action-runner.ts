"use client";

// Wraps `act` from useRm so every ops action (a) is pre-checked against the
// client policy map and (b) surfaces a refusal as a toast instead of an
// unhandled rejection (audit: Medium — `try { await act() } finally {}` swallowed
// every 403 and the button just stopped spinning).

import { useCallback } from "react";
import { useFintech } from "../components/global-fintech-provider";
import { RmActionError, type RmSession } from "../lib/use-rm";
import type { Role } from "../lib/rm-types";
import { canRun, requirementLabel } from "./action-policy";

type ActFn = <T = unknown>(action: string, payload?: Record<string, unknown>) => Promise<T>;

export type RunResult<T> = { ok: true; result: T } | { ok: false; error: string; code: string };

export interface ActionRunner {
  role: Role | null;
  /** Client-side policy check for `action`. */
  can: (action: string) => boolean;
  /** Tooltip for a control the role cannot use, or undefined when permitted. */
  why: (action: string) => string | undefined;
  /** Runs the action; never throws. Refusals and failures land in a toast. */
  run: <T = unknown>(action: string, payload?: Record<string, unknown>, opts?: { success?: string; quiet?: boolean }) => Promise<RunResult<T>>;
}

export function useActionRunner(rm: { act: ActFn; session: RmSession | null }): ActionRunner {
  const { addToast } = useFintech();
  const role = rm.session?.role ?? null;
  const act = rm.act;

  const can = useCallback((action: string) => canRun(role, action), [role]);
  const why = useCallback((action: string) => (canRun(role, action) ? undefined : requirementLabel(action)), [role]);

  const run = useCallback(
    async <T = unknown>(action: string, payload: Record<string, unknown> = {}, opts: { success?: string; quiet?: boolean } = {}): Promise<RunResult<T>> => {
      if (!canRun(role, action)) {
        const error = requirementLabel(action);
        addToast("Not permitted", error, "loss");
        return { ok: false, error, code: "FORBIDDEN" };
      }
      try {
        const result = await act<T>(action, payload);
        if (opts.success) addToast("Done", opts.success, "info");
        return { ok: true, result };
      } catch (e) {
        const error = e instanceof Error ? e.message : "Action failed";
        const code = e instanceof RmActionError ? e.code : "FAILED";
        const status = e instanceof RmActionError ? e.status : 0;
        if (!opts.quiet) {
          addToast(status === 401 ? "Session expired" : status === 403 ? "Refused" : "Action failed", error, "loss");
        }
        return { ok: false, error, code };
      }
    },
    [role, act, addToast],
  );

  return { role, can, why, run };
}
