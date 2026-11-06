// Read-only status snapshots: one refresh in flight, explicit freshness, no trading side effects.
export function createSnapshotCache({ load, maxAgeMs = 10_000, retryDelayMs = 5_000, now = Date.now }) {
  let value = null;
  let updatedAt = null;
  let lastAttempt = -Infinity;
  let pending = null;
  let error = false;
  let generation = 0;
  const fresh = () => updatedAt !== null && now() - updatedAt <= maxAgeMs;
  const peek = () => ({
    lastState: value,
    lastStateAt: updatedAt,
    stateStatus: fresh() ? "fresh" : value !== null ? "stale" : pending ? "refreshing" : "unavailable",
    stateRefreshing: pending !== null,
    stateError: error ? "Chain snapshot refresh failed; previous values are not current." : null,
  });
  function refresh() {
    if (pending) return pending;
    lastAttempt = now();
    const version = generation;
    const job = Promise.resolve().then(load).then((next) => {
      if (version !== generation) return;
      value = next;
      updatedAt = now();
      error = false;
    }).catch(() => { if (version === generation) error = true; }).finally(() => {
      if (pending === job) pending = null;
    });
    pending = job;
    return job;
  }
  return {
    get() {
      if (!fresh() && !pending && now() - lastAttempt >= retryDelayMs) void refresh();
      return peek();
    },
    peek,
    refresh,
    record(next) { value = next; updatedAt = now(); error = false; },
    invalidate() { generation++; updatedAt = null; pending = null; lastAttempt = -Infinity; },
  };
}
