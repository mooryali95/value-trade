// Local Supabase gateway for the e2e stack (LOCAL / CI ONLY, never production).
//   /rest/v1/*     -> PostgREST (prefix stripped, headers passed through)
//   /auth/v1/*     -> minimal GoTrue stub backed by auth.users in the local database
//   /storage/v1/*  -> tiny file-system object store (upload / sign / download / remove)
//   /health        -> 200 once the database answers
// Auth e-mails (invite, recovery, signup confirmation, generate_link) are not
// sent: one line per link is appended to $RUN_DIR/mail.log:
//   <ISO time> <kind> <email> <link>
// Env: PORT, PGRST_URL, JWT_SECRET, DATABASE_URL, PUBLIC_URL, RUN_DIR, DEFAULT_REDIRECT
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

process.on("uncaughtException", (e) => console.error("[gateway] uncaught", e));
process.on("unhandledRejection", (e) => console.error("[gateway] unhandled rejection", e));

const PORT = Number(process.env.PORT || 54321);
const PGRST = new URL(process.env.PGRST_URL || "http://127.0.0.1:3001");
const SECRET = process.env.JWT_SECRET;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://127.0.0.1:${PORT}`;
const RUN_DIR = process.env.RUN_DIR || path.join(process.cwd(), "run");
const STORE = path.join(RUN_DIR, "storage");
const MAIL_LOG = path.join(RUN_DIR, "mail.log");
const TTL = 3600;
if (!SECRET) throw new Error("JWT_SECRET required");
fs.mkdirSync(STORE, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
// An idle client losing its connection must not crash the gateway.
pool.on("error", (e) => console.error("[gateway] pg pool error:", e.message));

// ------------------------------------------------------------------ JWT ---
const b64u = (buf) => Buffer.from(buf).toString("base64url");
function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return null;
  const s = crypto.createHmac("sha256", SECRET).update(`${parts[0]}.${parts[1]}`).digest("base64url");
  if (s.length !== parts[2].length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(parts[2]))) return null;
  try {
    const p = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (p.exp && p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}
const hashPw = (pw) => crypto.createHash("sha256").update(String(pw)).digest("hex");

// ------------------------------------------------------------ user store ---
const USER_COLS = "id, email, raw_user_meta_data, raw_app_meta_data, email_confirmed_at, created_at, updated_at, last_sign_in_at, invited_at, encrypted_password";
async function ensureColumns() {
  await pool.query(`ALTER TABLE auth.users
    ADD COLUMN IF NOT EXISTS encrypted_password text,
    ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz,
    ADD COLUMN IF NOT EXISTS invited_at timestamptz,
    ADD COLUMN IF NOT EXISTS banned_until timestamptz`);
}
async function userById(id) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id))) return null;
  const r = await pool.query(`SELECT ${USER_COLS} FROM auth.users WHERE id = $1`, [id]);
  return r.rows[0] || null;
}
async function userByEmail(email) {
  const r = await pool.query(`SELECT ${USER_COLS} FROM auth.users WHERE lower(email) = lower($1)`, [String(email || "")]);
  return r.rows[0] || null;
}
function shape(u) {
  if (!u) return null;
  const iso = (d) => (d ? new Date(d).toISOString() : null);
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, phone: "",
    email_confirmed_at: iso(u.email_confirmed_at), confirmed_at: iso(u.email_confirmed_at),
    invited_at: iso(u.invited_at), last_sign_in_at: iso(u.last_sign_in_at),
    app_metadata: { provider: "email", providers: ["email"], ...(u.raw_app_meta_data || {}) },
    user_metadata: u.raw_user_meta_data || {},
    identities: [], is_anonymous: false,
    created_at: iso(u.created_at), updated_at: iso(u.updated_at),
  };
}
const refreshTokens = new Map(); // token -> { userId, method }
const linkTokens = new Map(); // token -> { userId, type, redirectTo }
// amr method recorded in the access token, like GoTrue: "password" for a
// password sign-in, the link type ("invite", "recovery", ...) for an e-mail link.
const AMR_BY_LINK = { invite: "invite", recovery: "recovery", magiclink: "otp", signup: "otp", email: "otp" };
function session(u, method = "password") {
  const now = Math.floor(Date.now() / 1000);
  const su = shape(u);
  const access_token = sign({
    aud: "authenticated", exp: now + TTL, iat: now, iss: `${PUBLIC_URL}/auth/v1`, sub: u.id, email: u.email, phone: "",
    app_metadata: su.app_metadata, user_metadata: su.user_metadata, role: "authenticated", aal: "aal1",
    amr: [{ method, timestamp: now }], session_id: crypto.randomUUID(), is_anonymous: false,
  });
  const refresh_token = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh_token, { userId: u.id, method });
  return { access_token, token_type: "bearer", expires_in: TTL, expires_at: now + TTL, refresh_token, user: su };
}
function logMail(kind, email, link) {
  fs.appendFileSync(MAIL_LOG, `${new Date().toISOString()} ${kind} ${email} ${link}\n`);
}
function makeLink(u, type, redirectTo) {
  const token = crypto.randomBytes(20).toString("hex");
  linkTokens.set(token, { userId: u.id, type, redirectTo });
  const q = new URLSearchParams({ token, type });
  if (redirectTo) q.set("redirect_to", redirectTo);
  return { token, link: `${PUBLIC_URL}/auth/v1/verify?${q}` };
}

// --------------------------------------------------------------- helpers ---
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD");
  res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "authorization,apikey,content-type,x-client-info,prefer,range,accept-profile,content-profile,x-supabase-api-version");
  res.setHeader("Access-Control-Expose-Headers", "content-range,x-total-count,link,content-profile,preference-applied,location");
  res.setHeader("Access-Control-Max-Age", "600");
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}
const authErr = (res, status, code, msg) => json(res, status, { code: status, error_code: code, msg });
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}
const parseJson = (buf) => { try { return buf.length ? JSON.parse(buf.toString()) : {}; } catch { return {}; } };
function bearer(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
function isService(req) {
  const c = bearer(req) ? verify(bearer(req)) : verify(req.headers.apikey);
  return c?.role === "service_role";
}

// ------------------------------------------------------------------ auth ---
async function handleAuth(req, res, url, sub) {
  const body = parseJson(await readBody(req));
  const m = req.method;
  if (sub === "/settings" && m === "GET") {
    return json(res, 200, { external: { email: true, phone: false, google: false }, disable_signup: false, mailer_autoconfirm: false, phone_autoconfirm: false, sms_provider: "", saml_enabled: false });
  }
  if (sub === "/health" && m === "GET") return json(res, 200, { name: "GoTrue (e2e stub)", version: "e2e" });
  if (sub === "/.well-known/jwks.json") return json(res, 200, { keys: [] });
  if (sub === "/token" && m === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const u = await userByEmail(body.email);
      if (!u || !u.encrypted_password || u.encrypted_password !== hashPw(body.password)) {
        return authErr(res, 400, "invalid_credentials", "Invalid login credentials");
      }
      if (!u.email_confirmed_at) return authErr(res, 400, "email_not_confirmed", "Email not confirmed");
      await pool.query("UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1", [u.id]);
      return json(res, 200, session(await userById(u.id)));
    }
    if (grant === "refresh_token") {
      const entry = refreshTokens.get(body.refresh_token);
      if (!entry) return authErr(res, 400, "refresh_token_not_found", "Invalid Refresh Token: Refresh Token Not Found");
      refreshTokens.delete(body.refresh_token);
      const u = await userById(entry.userId);
      if (!u) return authErr(res, 400, "user_not_found", "User not found");
      // A refreshed session keeps the original sign-in method, like GoTrue.
      return json(res, 200, session(u, entry.method));
    }
    return authErr(res, 400, "unsupported_grant_type", "Unsupported grant type (e2e stub)");
  }
  if (sub === "/signup" && m === "POST") {
    if (!body.email || !body.password) return authErr(res, 422, "validation_failed", "Email and password required");
    if (String(body.password).length < 6) return authErr(res, 422, "weak_password", "Password should be at least 6 characters.");
    if (await userByEmail(body.email)) return authErr(res, 422, "user_already_exists", "User already registered");
    const r = await pool.query(
      "INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data) VALUES (lower($1), $2, $3) RETURNING id",
      [body.email, hashPw(body.password), body.data || {}]);
    const u = await userById(r.rows[0].id);
    const { link } = makeLink(u, "signup", url.searchParams.get("redirect_to") || body.options?.emailRedirectTo);
    logMail("signup-confirmation", u.email, link);
    return json(res, 200, shape(u)); // unconfirmed: no session, like a project with email confirmation on
  }
  if (sub === "/recover" && m === "POST") {
    const u = await userByEmail(body.email);
    if (u) logMail("recovery", u.email, makeLink(u, "recovery", url.searchParams.get("redirect_to")).link);
    return json(res, 200, {});
  }
  if (sub === "/otp" && m === "POST") return json(res, 200, {});
  if (sub === "/resend" && m === "POST") return json(res, 200, {});
  if (sub === "/verify" && (m === "GET" || m === "POST")) {
    const token = m === "GET" ? url.searchParams.get("token") : body.token_hash || body.token;
    const entry = linkTokens.get(token);
    if (!entry) {
      // Like GoTrue: a browser following a used or unknown link is sent back
      // to the app with the error in the fragment.
      const back = m === "GET" ? url.searchParams.get("redirect_to") || process.env.DEFAULT_REDIRECT : null;
      if (back) {
        const frag = new URLSearchParams({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" });
        res.writeHead(303, { location: `${back}#${frag}` });
        return res.end();
      }
      return authErr(res, 403, "otp_expired", "Email link is invalid or has expired");
    }
    linkTokens.delete(token);
    await pool.query("UPDATE auth.users SET email_confirmed_at = coalesce(email_confirmed_at, now()) WHERE id = $1", [entry.userId]);
    const s = session(await userById(entry.userId), AMR_BY_LINK[entry.type] || "otp");
    if (m === "POST") return json(res, 200, s);
    const target = url.searchParams.get("redirect_to") || entry.redirectTo || process.env.DEFAULT_REDIRECT || "/";
    const frag = new URLSearchParams({ access_token: s.access_token, expires_at: String(s.expires_at), expires_in: String(s.expires_in), refresh_token: s.refresh_token, token_type: "bearer", type: entry.type });
    res.writeHead(303, { location: `${target}#${frag}` });
    return res.end();
  }
  if (sub === "/logout" && m === "POST") return json(res, 204);
  if (sub === "/user" && (m === "GET" || m === "PUT")) {
    const claims = verify(bearer(req));
    if (!claims || !claims.sub) return authErr(res, 403, "bad_jwt", "invalid JWT: unable to parse or verify signature");
    const u = await userById(claims.sub);
    if (!u) return authErr(res, 403, "user_not_found", "User from sub claim in JWT does not exist");
    if (m === "PUT") {
      if (body.password !== undefined) {
        if (String(body.password).length < 6) return authErr(res, 422, "weak_password", "Password should be at least 6 characters.");
        await pool.query("UPDATE auth.users SET encrypted_password = $2, updated_at = now() WHERE id = $1", [u.id, hashPw(body.password)]);
      }
      if (body.data) await pool.query("UPDATE auth.users SET raw_user_meta_data = coalesce(raw_user_meta_data,'{}'::jsonb) || $2::jsonb, updated_at = now() WHERE id = $1", [u.id, JSON.stringify(body.data)]);
      return json(res, 200, shape(await userById(u.id)));
    }
    return json(res, 200, shape(u));
  }
  if (sub === "/authorize") return authErr(res, 400, "provider_disabled", "OAuth is not available in the local e2e stack");

  // ------------------------------------------------------------ admin ---
  if (sub.startsWith("/admin/") || sub === "/invite") {
    if (!isService(req)) return authErr(res, 403, "not_admin", "User not allowed");
    if (sub === "/admin/users" && m === "GET") {
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const per = Math.min(1000, Math.max(1, Number(url.searchParams.get("per_page") || 50)));
      const total = (await pool.query("SELECT count(*)::int n FROM auth.users")).rows[0].n;
      const r = await pool.query(`SELECT ${USER_COLS} FROM auth.users ORDER BY created_at, id LIMIT $1 OFFSET $2`, [per, (page - 1) * per]);
      const links = [];
      if (page * per < total) links.push(`<${PUBLIC_URL}/auth/v1/admin/users?page=${page + 1}&per_page=${per}>; rel="next"`);
      links.push(`<${PUBLIC_URL}/auth/v1/admin/users?page=${Math.max(1, Math.ceil(total / per))}&per_page=${per}>; rel="last"`);
      return json(res, 200, { users: r.rows.map(shape), aud: "authenticated" }, { "x-total-count": String(total), link: links.join(", ") });
    }
    const um = sub.match(/^\/admin\/users\/([0-9a-f-]{36})$/i);
    if (um && m === "GET") {
      const u = await userById(um[1]);
      return u ? json(res, 200, shape(u)) : authErr(res, 404, "user_not_found", "User not found");
    }
    if (um && m === "PUT") {
      const u = await userById(um[1]);
      if (!u) return authErr(res, 404, "user_not_found", "User not found");
      if (body.password) await pool.query("UPDATE auth.users SET encrypted_password=$2 WHERE id=$1", [u.id, hashPw(body.password)]);
      if (body.email_confirm) await pool.query("UPDATE auth.users SET email_confirmed_at=coalesce(email_confirmed_at, now()) WHERE id=$1", [u.id]);
      if (body.user_metadata) await pool.query("UPDATE auth.users SET raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||$2::jsonb WHERE id=$1", [u.id, JSON.stringify(body.user_metadata)]);
      if (body.app_metadata) await pool.query("UPDATE auth.users SET raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||$2::jsonb WHERE id=$1", [u.id, JSON.stringify(body.app_metadata)]);
      return json(res, 200, shape(await userById(u.id)));
    }
    if (um && m === "DELETE") {
      await pool.query("DELETE FROM auth.users WHERE id = $1", [um[1]]);
      return json(res, 200, {});
    }
    if (sub === "/admin/users" && m === "POST") {
      if (!body.email) return authErr(res, 422, "validation_failed", "Email required");
      if (await userByEmail(body.email)) return authErr(res, 422, "email_exists", "A user with this email address has already been registered");
      const r = await pool.query(
        `INSERT INTO auth.users (email, encrypted_password, raw_user_meta_data, raw_app_meta_data, email_confirmed_at)
         VALUES (lower($1), $2, $3, $4, CASE WHEN $5 THEN now() END) RETURNING id`,
        [body.email, body.password ? hashPw(body.password) : null, body.user_metadata || body.data || {}, body.app_metadata || {}, !!body.email_confirm]);
      return json(res, 200, shape(await userById(r.rows[0].id)));
    }
    if (sub === "/invite" && m === "POST") {
      if (!body.email) return authErr(res, 422, "validation_failed", "Email required");
      let u = await userByEmail(body.email);
      if (u && u.email_confirmed_at) return authErr(res, 422, "email_exists", "A user with this email address has already been registered");
      if (!u) {
        const r = await pool.query("INSERT INTO auth.users (email, raw_user_meta_data, invited_at) VALUES (lower($1), $2, now()) RETURNING id", [body.email, body.data || {}]);
        u = await userById(r.rows[0].id);
      }
      logMail("invite", u.email, makeLink(u, "invite", url.searchParams.get("redirect_to")).link);
      return json(res, 200, shape(u));
    }
    if (sub === "/admin/generate_link" && m === "POST") {
      const type = body.type;
      const redirectTo = url.searchParams.get("redirect_to") || body.redirect_to;
      let u = await userByEmail(body.email);
      if (!u && (type === "invite" || type === "signup")) {
        const r = await pool.query("INSERT INTO auth.users (email, raw_user_meta_data, invited_at, encrypted_password) VALUES (lower($1), $2, CASE WHEN $3 = 'invite' THEN now() END, $4) RETURNING id",
          [body.email, body.data || {}, type, body.password ? hashPw(body.password) : null]);
        u = await userById(r.rows[0].id);
      }
      if (!u) return authErr(res, 404, "user_not_found", "User with this email not found");
      if (type === "invite" && u.email_confirmed_at) return authErr(res, 422, "email_exists", "A user with this email address has already been registered");
      const { token, link } = makeLink(u, type, redirectTo);
      logMail(`generate_link:${type}`, u.email, link);
      return json(res, 200, { ...shape(u), action_link: link, email_otp: String(crypto.randomInt(100000, 999999)), hashed_token: token, redirect_to: redirectTo || null, verification_type: type });
    }
    return authErr(res, 404, "not_found", `Not implemented in the e2e auth stub: ${m} ${sub}`);
  }
  return authErr(res, 404, "not_found", `Not implemented in the e2e auth stub: ${m} ${sub}`);
}

// --------------------------------------------------------------- storage ---
const safePath = (p) => path.join(STORE, path.normalize(decodeURIComponent(p)).replace(/^(\.\.(\/|\\|$))+/, ""));
async function handleStorage(req, res, url, sub) {
  const buf = await readBody(req);
  const m = req.method;
  let mm;
  if ((mm = sub.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && m === "POST") {
    const token = sign({ url: `${mm[1]}/${mm[2]}`, exp: Math.floor(Date.now() / 1000) + 3600 });
    return json(res, 200, { signedURL: `/object/sign/${mm[1]}/${mm[2]}?token=${token}` });
  }
  if ((mm = sub.match(/^\/object\/sign\/([^/]+)\/(.+)$/)) && m === "GET") {
    const c = verify(url.searchParams.get("token"));
    if (!c || c.url !== `${mm[1]}/${mm[2]}`) return json(res, 400, { statusCode: "400", error: "InvalidJWT", message: "invalid signature" });
    const f = safePath(`${mm[1]}/${mm[2]}`);
    if (!fs.existsSync(f)) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(fs.readFileSync(f));
  }
  if ((mm = sub.match(/^\/object\/([^/]+)$/)) && m === "DELETE") {
    const prefixes = parseJson(buf).prefixes || [];
    for (const p of prefixes) fs.rmSync(safePath(`${mm[1]}/${p}`), { force: true });
    return json(res, 200, prefixes.map((p) => ({ name: p, bucket_id: mm[1] })));
  }
  if ((mm = sub.match(/^\/object\/([^/]+)\/(.+)$/)) && (m === "POST" || m === "PUT")) {
    const f = safePath(`${mm[1]}/${mm[2]}`);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, buf);
    return json(res, 200, { Key: `${mm[1]}/${mm[2]}`, Id: crypto.randomUUID() });
  }
  if ((mm = sub.match(/^\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/)) && m === "GET") {
    const f = safePath(`${mm[1]}/${mm[2]}`);
    if (!fs.existsSync(f)) return json(res, 404, { statusCode: "404", error: "not_found", message: "Object not found" });
    res.writeHead(200, { "content-type": "application/octet-stream" });
    return res.end(fs.readFileSync(f));
  }
  if (sub.startsWith("/bucket")) return json(res, 200, []);
  return json(res, 404, { statusCode: "404", error: "not_found", message: `Not implemented in the e2e auth stub: ${m} ${sub}` });
}

// -------------------------------------------------------------- PostgREST ---
function proxyRest(req, res, rest) {
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  // Supabase's gateway turns a bare apikey into the Authorization header.
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
  const up = http.request({ hostname: PGRST.hostname, port: PGRST.port, method: req.method, path: rest || "/", headers }, (r) => {
    const h = { ...r.headers };
    delete h["access-control-allow-origin"];
    res.writeHead(r.statusCode || 502, h);
    r.pipe(res);
  });
  up.on("error", (e) => json(res, 502, { code: "PGRST_UNAVAILABLE", message: String(e.message) }));
  req.pipe(up);
}

await ensureColumns();
http.createServer(async (req, res) => {
  const t0 = Date.now();
  if (req.method !== "OPTIONS") {
    res.on("finish", () => {
      const p = req.url.split("?")[0];
      console.log(`[gateway] ${req.method} ${p} ${res.statusCode} ${Date.now() - t0}ms`);
    });
  }
  cors(req, res);
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const url = new URL(req.url, PUBLIC_URL);
  try {
    if (url.pathname.startsWith("/rest/v1")) return proxyRest(req, res, req.url.slice("/rest/v1".length));
    if (url.pathname.startsWith("/auth/v1")) return await handleAuth(req, res, url, url.pathname.slice("/auth/v1".length) || "/");
    if (url.pathname.startsWith("/storage/v1")) return await handleStorage(req, res, url, url.pathname.slice("/storage/v1".length));
    if (url.pathname === "/" || url.pathname === "/health") {
      await pool.query("SELECT 1");
      return json(res, 200, { ok: true, service: "value-unit e2e gateway" });
    }
    return json(res, 404, { message: `Not available in the local e2e stack: ${url.pathname}` });
  } catch (e) {
    console.error("[gateway]", req.method, req.url, e);
    if (!res.headersSent) json(res, 500, { code: 500, error_code: "unexpected_failure", msg: "e2e gateway error" });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`[gateway] listening on ${PUBLIC_URL}`));
