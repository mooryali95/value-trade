// The running e2e stack (e2e/stack/start.sh writes <run dir>/stack.env).
import fs from "node:fs";
import path from "node:path";

export type StackEnv = {
  E2E_DB: string;
  E2E_RUN_DIR: string;
  APP_URL: string;
  SUPABASE_URL: string;
  PGRST_URL: string;
  DATABASE_URL: string;
  MAIL_LOG: string;
  JWT_SECRET: string;
  ANON_KEY: string;
  SERVICE_ROLE_KEY: string;
};

/** Same default as stack/start.sh: E2E_RUN_DIR, else /tmp/vt-e2e/<E2E_DB or vt_e2e>. */
export function stackEnvPath(): string {
  if (process.env.E2E_STACK_ENV) return process.env.E2E_STACK_ENV;
  const runDir =
    process.env.E2E_RUN_DIR || path.join("/tmp/vt-e2e", process.env.E2E_DB || "vt_e2e");
  return path.join(runDir, "stack.env");
}

let cached: StackEnv | null = null;

export function stack(): StackEnv {
  if (cached) return cached;
  const file = stackEnvPath();
  if (!fs.existsSync(file)) {
    throw new Error(
      `No running e2e stack: ${file} does not exist. Start it with 'bash e2e/stack/start.sh' ` +
        `(or run the whole suite with 'npm run test:e2e').`,
    );
  }
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  for (const k of ["APP_URL", "SUPABASE_URL", "DATABASE_URL", "MAIL_LOG", "ANON_KEY"]) {
    if (!env[k]) throw new Error(`${file} has no ${k}`);
  }
  cached = env as unknown as StackEnv;
  return cached;
}

/** localStorage key supabase-js uses for the session: sb-<first host label>-auth-token. */
export function sessionStorageKey(): string {
  return `sb-${new URL(stack().SUPABASE_URL).hostname.split(".")[0]}-auth-token`;
}
