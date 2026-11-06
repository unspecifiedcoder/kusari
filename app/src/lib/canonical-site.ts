"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_APP_ORIGIN } from "./wallet-safety";

const origin = process.env.NEXT_PUBLIC_APP_ORIGIN || DEFAULT_APP_ORIGIN;
const subscribe = () => () => {};

/** A deployment alias is a viewer, never an alternative wallet-signing origin. */
export function useCanonicalSite() {
  const isCanonical = useSyncExternalStore(subscribe,
    () => window.location.origin === origin,
    () => false,
  );
  return { isCanonical, canonicalOrigin: origin };
}
