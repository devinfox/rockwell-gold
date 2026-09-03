"use client";

// The session the root layout resolved server-side from the httpOnly cookie,
// handed to the client tree so nav/orders/vault render the signed-in state on
// first paint instead of flashing "Sign in" until /api/auth answers
// (audit: Low — auth-state flash). It is a seed only: useRm and SiteNav
// replace it with whatever the server says on their first fetch.

import { createContext, useContext } from "react";
import type { Role } from "./rm-types";

export interface InitialSession {
  userId: string;
  name: string;
  email: string;
  role: Role;
}

export const InitialSessionContext = createContext<InitialSession | null>(null);

export function useInitialSession(): InitialSession | null {
  return useContext(InitialSessionContext);
}
