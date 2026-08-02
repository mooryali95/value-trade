/**
 * Feature flags — plain constants, not a remote-config system. This project
 * has no flag infrastructure; wiring one for a single boolean would be
 * over-engineering. When a flag needs runtime/per-user toggling later,
 * promote it into a real system then.
 */

/**
 * Controls whether the legacy direct self-signup form (email + password,
 * instant account, no approval) is still reachable from /auth.
 *
 * Phase 1 of the roadmap replaces open signup with the gated
 * access-request flow (/request-access). Both are live at once during
 * testing: set this to `false` once the new flow is verified in
 * production, to fully retire direct signup.
 */
export const ENABLE_LEGACY_SELF_SIGNUP = true;
