import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Paperclip, DownloadSimple, Trash } from "@phosphor-icons/react";
import { useI18n } from "@/lib/i18n";
import {
  listSubmissionDocuments,
  uploadSubmissionDocument,
  getSubmissionDocumentUrl,
  deleteSubmissionDocument,
} from "@/lib/submissions/documents.functions";

const MAX_BYTES = 10 * 1024 * 1024;

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("READ_FAILED"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function SubmissionDocuments({
  submissionId,
  canUpload = false,
  canDelete = false,
}: {
  submissionId: string;
  canUpload?: boolean;
  canDelete?: boolean;
}) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const listFn = useServerFn(listSubmissionDocuments);
  const uploadFn = useServerFn(uploadSubmissionDocument);
  const urlFn = useServerFn(getSubmissionDocumentUrl);
  const deleteFn = useServerFn(deleteSubmissionDocument);

  const { data, isLoading } = useQuery({
    queryKey: ["submission-docs", submissionId],
    queryFn: () => listFn({ data: { submissionId } }),
  });

  const mapError = (e: unknown) => {
    const msg = e instanceof Error ? e.message : "Error";
    if (msg === "FILE_TOO_LARGE") return t("fileTooLarge");
    if (msg === "FILE_TYPE_NOT_ALLOWED") return t("fileTypeNotAllowed");
    if (msg === "FORBIDDEN") return t("permissionRequired");
    return msg;
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_BYTES) throw new Error("FILE_TOO_LARGE");
      const content = await toBase64(file);
      return uploadFn({
        data: {
          submissionId,
          fileName: file.name,
          mimeType: file.type || "application/pdf",
          content,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("documentUploaded"));
      qc.invalidateQueries({ queryKey: ["submission-docs", submissionId] });
    },
    onError: (e) => toast.error(mapError(e)),
    onSettled: () => setBusy(false),
  });

  const remove = useMutation({
    mutationFn: (documentId: string) => deleteFn({ data: { documentId } }),
    onSuccess: () => {
      toast.success(t("documentDeleted"));
      qc.invalidateQueries({ queryKey: ["submission-docs", submissionId] });
    },
    onError: (e) => toast.error(mapError(e)),
  });

  const open = async (documentId: string) => {
    try {
      const { url } = await urlFn({ data: { documentId } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(mapError(e));
    }
  };

  const rows = data ?? [];

  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-caption font-semibold text-ink">
          <Paperclip size={14} aria-hidden />
          {t("documents")} ({rows.length})
        </div>
        {canUpload && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                upload.mutate(file);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={busy || upload.isPending}
              onClick={() => fileRef.current?.click()}
              className="min-h-9 rounded-md border border-border px-3 text-caption font-semibold text-ink hover:border-[var(--gold-deep)] disabled:opacity-50"
            >
              {upload.isPending ? t("loading") : t("attachDocument")}
            </button>
          </>
        )}
      </div>

      <p className="mt-1 text-caption text-ink-soft">{t("documentsHint")}</p>

      {isLoading ? (
        <div className="mt-2 text-caption text-ink-soft">{t("loading")}</div>
      ) : rows.length === 0 ? (
        <div className="mt-2 text-caption text-ink-soft">{t("noDocuments")}</div>
      ) : (
        <ul className="mt-2 divide-y divide-border/40">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="truncate text-caption font-medium text-ink">{d.file_name}</div>
                <div className="text-[10px] text-ink-soft">
                  {Math.round(Number(d.size_bytes ?? 0) / 1024)} KB ·{" "}
                  {new Date(d.created_at).toLocaleDateString(lang === "ar" ? "ar" : "en-US")}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  aria-label={`${t("download")} ${d.file_name}`}
                  onClick={() => open(d.id)}
                  className="min-h-9 rounded-md border border-border px-2 text-ink hover:border-[var(--gold-deep)]"
                >
                  <DownloadSimple size={14} aria-hidden />
                </button>
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`${t("delete")} ${d.file_name}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(d.id)}
                    className="min-h-9 rounded-md border border-[var(--bear)]/40 px-2 text-[var(--bear)] disabled:opacity-40"
                  >
                    <Trash size={14} aria-hidden />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
