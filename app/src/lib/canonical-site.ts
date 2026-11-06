"use client";

import { useSyncExternalStore } from "react";

const origin = process.env.NEXT_PUBLIC_APP_ORIGIN;
const subscribe = () => () => {};

/** A deployment alias is a viewer, never an alternative wallet-signing origin. */
export function useCanonicalSite() {
  const isCanonical = useSyncExternalStore(subscribe,
    () => !origin || window.location.origin === origin,
    () => !origin,
  );
  return { isCanonical, canonicalOrigin: origin };
}
