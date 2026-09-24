import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { toStableError } from "@/lib/ops/errors.server";

const BUCKET = "submission-docs";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];
/** Company roles allowed to attach documents (mirrors submission_docs_insert RLS). */
const UPLOAD_ROLES = ["owner", "finance"] as const;

/**
 * Storage layout: "<company_id>/<submission_id>/<safe file name>". The DB
 * enforces the same prefix on submission_documents.file_path.
 */
function pathPrefix(companyId: string, submissionId: string): string {
  return `${companyId}/${submissionId}/`;
}

/** Strips anything that is not a plain file-name character (no slashes, no dot-only names). */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(-120);
  return cleaned.length > 0 ? cleaned : "document";
}

/** Documents attached to a product submission. Access follows the table RLS. */
export const listSubmissionDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ submissionId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("submission_documents")
      .select("id, file_name, file_path, mime_type, size_bytes, created_at, uploaded_by")
      .eq("submission_id", data.submissionId)
      .order("created_at", { ascending: false });
    if (error) throw toStableError("documents.list", error);
    return rows ?? [];
  });

const UploadInput = z.object({
  submissionId: z.string().uuid(),
  fileName: z.string().min(1).max(180),
  mimeType: z.string().min(3).max(120),
  // Raw base64 payload (no data: prefix); capped well under the size limit.
  content: z.string().min(4).max(MAX_BYTES * 2),
});

export const uploadSubmissionDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => UploadInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!ALLOWED.includes(data.mimeType)) throw new Error("FILE_TYPE_NOT_ALLOWED");

    const bytes = Uint8Array.from(atob(data.content), (c) => c.charCodeAt(0));
    if (bytes.byteLength > MAX_BYTES) throw new Error("FILE_TOO_LARGE");

    // The submission read is RLS-scoped: a non-member cannot resolve it at all.
    const { data: submission, error: subErr } = await supabase
      .from("product_submissions")
      .select("id, company_id, status")
      .eq("id", data.submissionId)
      .single();
    if (subErr || !submission) throw new Error("SUBMISSION_NOT_FOUND");

    // Verify membership with an upload-capable role BEFORE touching storage
    // (the service-role upload below bypasses storage RLS).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const roleChecks = await Promise.all(
      UPLOAD_ROLES.map((role) =>
        supabaseAdmin.rpc("has_company_role", {
          _user_id: userId,
          _company_id: submission.company_id,
          _role: role,
        }),
      ),
    );
    if (roleChecks.some((r) => r.error)) {
      console.error("[documents] role check failed");
      throw new Error("INTERNAL_ERROR");
    }
    if (!roleChecks.some((r) => r.data === true)) throw new Error("FORBIDDEN");

    const safeName = safeFileName(data.fileName);
    // A random prefix inside the file-name segment keeps uploads unique.
    const filePath = `${pathPrefix(submission.company_id, submission.id)}${crypto.randomUUID()}-${safeName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, bytes, { contentType: data.mimeType, upsert: false });
    if (upErr) {
      console.error("[documents] storage upload failed", upErr.name);
      throw new Error("UPLOAD_FAILED");
    }

    // Insert through the user's client so RLS decides who may attach.
    const { data: row, error } = await supabase
      .from("submission_documents")
      .insert({
        submission_id: submission.id,
        company_id: submission.company_id,
        file_name: safeName,
        file_path: filePath,
        mime_type: data.mimeType,
        size_bytes: bytes.byteLength,
        uploaded_by: userId,
      })
      .select("id, file_name, file_path, mime_type, size_bytes, created_at, uploaded_by")
      .single();
    if (error) {
      await supabaseAdmin.storage.from(BUCKET).remove([filePath]);
      throw toStableError("documents.insert", error, "FORBIDDEN");
    }
    return row;
  });

/** Short-lived signed link; issued only after the row is readable by the caller. */
export const getSubmissionDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("submission_documents")
      .select("file_path, company_id, submission_id")
      .eq("id", data.documentId)
      .single();
    if (error || !row) throw new Error("DOCUMENT_NOT_FOUND");
    // Only sign objects inside this document's own company/submission folder.
    if (!row.file_path.startsWith(pathPrefix(row.company_id, row.submission_id))) {
      console.error("[documents] file_path outside expected prefix", { documentId: data.documentId });
      throw new Error("DOCUMENT_NOT_FOUND");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(row.file_path, 120);
    if (signErr || !signed) {
      if (signErr) console.error("[documents] sign failed", signErr.name);
      throw new Error("SIGN_FAILED");
    }
    return { url: signed.signedUrl };
  });

export const deleteSubmissionDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("submission_documents")
      .select("id, file_path, company_id, submission_id")
      .eq("id", data.documentId)
      .single();
    if (!row) throw new Error("DOCUMENT_NOT_FOUND");

    const { error, count } = await context.supabase
      .from("submission_documents")
      .delete({ count: "exact" })
      .eq("id", data.documentId);
    if (error) throw toStableError("documents.delete", error, "FORBIDDEN");
    if (!count) throw new Error("FORBIDDEN");

    // Never remove an object outside the document's own folder.
    if (row.file_path.startsWith(pathPrefix(row.company_id, row.submission_id))) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from(BUCKET).remove([row.file_path]);
    }
    return { ok: true };
  });
