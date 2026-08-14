import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "submission-docs";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

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
    if (error) throw new Error(error.message);
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

    const safeName = data.fileName.replace(/[^\w.\- ]+/g, "_").slice(-120);
    const filePath = `${submission.company_id}/${submission.id}/${crypto.randomUUID()}-${safeName}`;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, bytes, { contentType: data.mimeType, upsert: false });
    if (upErr) throw new Error(upErr.message);

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
      throw new Error(error.message === "" ? "FORBIDDEN" : error.message);
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
      .select("file_path")
      .eq("id", data.documentId)
      .single();
    if (error || !row) throw new Error("DOCUMENT_NOT_FOUND");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(row.file_path, 120);
    if (signErr || !signed) throw new Error(signErr?.message ?? "SIGN_FAILED");
    return { url: signed.signedUrl };
  });

export const deleteSubmissionDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ documentId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("submission_documents")
      .select("id, file_path")
      .eq("id", data.documentId)
      .single();
    if (!row) throw new Error("DOCUMENT_NOT_FOUND");

    const { error, count } = await context.supabase
      .from("submission_documents")
      .delete({ count: "exact" })
      .eq("id", data.documentId);
    if (error) throw new Error(error.message);
    if (!count) throw new Error("FORBIDDEN");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from(BUCKET).remove([row.file_path]);
    return { ok: true };
  });
