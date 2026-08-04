import * as React from "react";

/**
 * Accessibility pattern: dynamic updates MUST be announced.
 *
 * `LiveRegion` renders a visually hidden polite/assertive announcer.
 * Use it for results counts, sort/filter changes, and async action outcomes.
 * Rules:
 *  - `polite` for passive updates (counts, sorting, filters).
 *  - `assertive` only for errors or outcomes the user is waiting on.
 *  - Never put focusable content inside a live region.
 */
export function LiveRegion({
  message,
  assertive = false,
}: {
  message: string;
  assertive?: boolean;
}) {
  return (
    <div
      aria-live={assertive ? "assertive" : "polite"}
      aria-atomic="true"
      role={assertive ? "alert" : "status"}
      className="sr-only"
    >
      {message}
    </div>
  );
}

/**
 * Announces table state (result count + active sort) whenever it changes.
 * Debounced through React state so rapid typing does not spam the reader.
 */
export function TableStatus({
  count,
  sortLabel,
  sortDir,
  labels,
}: {
  count: number;
  sortLabel?: string;
  sortDir?: "asc" | "desc";
  labels: { results: string; sortedBy: string; asc: string; desc: string };
}) {
  const message = React.useMemo(() => {
    const base = `${count} ${labels.results}`;
    if (!sortLabel) return base;
    return `${base} — ${labels.sortedBy} ${sortLabel} (${sortDir === "desc" ? labels.desc : labels.asc})`;
  }, [count, sortLabel, sortDir, labels]);

  const [announced, setAnnounced] = React.useState(message);
  React.useEffect(() => {
    const id = window.setTimeout(() => setAnnounced(message), 350);
    return () => window.clearTimeout(id);
  }, [message]);

  return <LiveRegion message={announced} />;
}