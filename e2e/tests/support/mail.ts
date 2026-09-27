// Auth e-mails of the stack: the gateway's auth stub appends one line per
// link it would have sent to mail.log: "<ISO time> <kind> <email> <link>".
import fs from "node:fs";
import { expect } from "@playwright/test";
import { stack } from "./stack";

export type MailKind = "invite" | "recovery" | "signup-confirmation" | `generate_link:${string}`;
export type Mail = { at: string; kind: string; email: string; link: string };

export function readMail(): Mail[] {
  const file = stack().MAIL_LOG;
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => l.trim().split(" "))
    .filter((p) => p.length === 4)
    .map(([at, kind, email, link]) => ({ at, kind, email, link }));
}

/** Waits for the newest `kind` link sent to `email` (polling the log) and returns it. */
export async function waitForMailLink(
  email: string,
  kind: MailKind,
  timeout = 30_000,
): Promise<string> {
  let link = "";
  await expect
    .poll(
      () => {
        const hit = readMail()
          .filter((m) => m.email === email.toLowerCase() && m.kind === kind)
          .pop();
        link = hit?.link ?? "";
        return link;
      },
      { message: `a "${kind}" e-mail link for ${email} in ${stack().MAIL_LOG}`, timeout },
    )
    .not.toBe("");
  return link;
}
