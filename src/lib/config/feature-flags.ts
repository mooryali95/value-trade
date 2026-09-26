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
 * Open signup is replaced by the gated access-request flow
 * (/request-access). Accounts are created from e-mail links the server
 * sends after an approval or for a company invitation (Supabase Auth
 * invitation -> /auth/update-password), or by Google sign-in. If direct
 * signup ever needs to come back temporarily, flip this back to `true` --
 * no other code changes needed. Note that the Supabase Auth setting
 * "allow new users to sign up" is separate (Lovable Cloud auth settings).
 */
export const ENABLE_LEGACY_SELF_SIGNUP = false;
