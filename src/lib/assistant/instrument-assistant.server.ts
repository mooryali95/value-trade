/**
 * Investor assistant: builds a grounded context for one listed instrument
 * from platform data only, and streams an answer from the Lovable AI
 * Gateway (Responses API, raw HTTP). Server-only.
 */
import { loadPublicInstrument, loadRecentTrades, loadShariahRulings } from "@/lib/market/public-market.server";

export type AssistantFile = { filename: string; dataUrl: string };
const MAX_PDFS = 3;
const MAX_PDF_BYTES = 8 * 1024 * 1024;

function toBase64(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export const ASSISTANT_MODEL = "openai/gpt-6-astra";
const GATEWAY = "https://ai.gateway.lovable.dev/v1/responses";

export async function buildInstrumentContext(slug: string): Promise<{ symbol: string; context: string; files: AssistantFile[] } | null> {
  const found = await loadPublicInstrument(slug);
  if (!found) return null;
  const i = found.instrument;
  const [trades, rulings] = await Promise.all([
    loadRecentTrades(i.symbol, 30).catch(() => []),
    loadShariahRulings().catch(() => []),
  ]);
  const ruling = rulings.find((r) => r.symbol === i.symbol);

  // Offering documents: prospectus link and file list of the source submission.
  let docs = "None published on the platform.";
  const pdfs: AssistantFile[] = [];
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: brand } = await supabaseAdmin
      .from("brands").select("source_submission_id").eq("symbol", i.symbol).eq("published", true).maybeSingle();
    if (brand?.source_submission_id) {
      const [{ data: sub }, { data: files }] = await Promise.all([
        supabaseAdmin.from("product_submissions").select("prospectus_url, submitted_at").eq("id", brand.source_submission_id).maybeSingle(),
        supabaseAdmin.from("submission_documents").select("file_name, file_path, mime_type, size_bytes, created_at").eq("submission_id", brand.source_submission_id),
      ]);
      const parts: string[] = [];
      if (sub?.prospectus_url) parts.push(`Prospectus link: ${sub.prospectus_url} (content not loaded)`);
      for (const f of files ?? []) {
        const isPdf = f.mime_type === "application/pdf" && (f.size_bytes ?? 0) <= MAX_PDF_BYTES && pdfs.length < MAX_PDFS;
        let loaded = false;
        if (isPdf) {
          const { data: blob } = await supabaseAdmin.storage.from("submission-docs").download(f.file_path);
          if (blob) { pdfs.push({ filename: f.file_name, dataUrl: `data:application/pdf;base64,${toBase64(await blob.arrayBuffer())}` }); loaded = true; }
        }
        parts.push(`Document file: ${f.file_name} (${f.mime_type ?? "unknown type"}), uploaded ${f.created_at}; ${loaded ? "full contents attached below" : "contents not loaded"}`);
      }
      if (parts.length) docs = parts.join("\n");
    }
  } catch {
    docs = "Could not be loaded.";
  }

  const context = [
    `Symbol: ${i.symbol}`,
    `Name (AR/EN): ${i.nameAr} / ${i.nameEn}`,
    `Asset class: ${i.assetClass}`,
    `Sector: ${i.sector ?? "n/a"}`,
    `Issuer: ${i.companyNameEn ?? i.companyNameAr ?? "n/a"}`,
    `Reference price (SAR, set at listing, not a trade): ${i.referencePrice}`,
    `Last traded price: ${i.lastPrice ?? "no trades yet"}`,
    `24h change %: ${i.change24hPct ?? "n/a"}; 24h trades: ${i.trades24h}; 24h value: ${i.volume24hValue}`,
    `Today open/high/low: ${i.dayOpen ?? "-"} / ${i.dayHigh ?? "-"} / ${i.dayLow ?? "-"}`,
    `Allowed price band today: ${i.bandLow} – ${i.bandHigh}`,
    `Last trade at: ${i.lastTradeAt ?? "never"}`,
    `Shariah ruling: ${ruling ? `${ruling.status} since ${ruling.effectiveAt}${ruling.reason ? ` — ${ruling.reason}` : ""}` : "no ruling yet"}`,
    `Recent trades (newest first, price x qty @ time):`,
    ...(trades.length ? trades.map((t) => `  ${t.price} x ${t.qty} @ ${t.tradedAt}`) : ["  none"]),
    `Offering documents:`,
    docs,
  ].join("\n");
  return { symbol: i.symbol, context, files: pdfs };
}

const INSTRUCTIONS = (lang: "ar" | "en") => `You are the investor information assistant of the "Value Unit" trading platform.
Answer ONLY from the PLATFORM DATA block and the attached offering documents (prospectus etc.); when summarising a document, cite its file name. If the data does not contain the answer (for example document contents that were not loaded), say so plainly and suggest the investor open the document. Never invent figures, forecasts or facts.
Do not give buy/sell recommendations or personalised advice. Keep answers concise (under ~200 words), use short Markdown bullets where useful.
Reply in ${lang === "ar" ? "Arabic" : "English"}. Prices are in SAR.`;

/** Streams plain answer text. Throws a Response carrying the gateway status on failure. */
export async function streamAnswer(opts: {
  apiKey: string; context: string; files?: AssistantFile[]; question: string; lang: "ar" | "en"; signal: AbortSignal;
}): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(GATEWAY, {
    method: "POST",
    signal: opts.signal,
    headers: { "Content-Type": "application/json", "Lovable-API-Key": opts.apiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: ASSISTANT_MODEL,
      instructions: INSTRUCTIONS(opts.lang),
      input: [{ role: "user", content: [
        ...(opts.files ?? []).map((f) => ({ type: "input_file", filename: f.filename, file_data: f.dataUrl })),
        { type: "input_text", text: `PLATFORM DATA:\n${opts.context}\n\nQUESTION:\n${opts.question}` },
      ] }],
      stream: true,
      store: false,
      reasoning: { effort: "low", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    }),
  });
  if (!res.ok || !res.body) {
    console.error("[assistant] gateway status", res.status);
    throw new Response(null, { status: res.status });
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Keep reading until at least one text delta is emitted (or the stream ends).
      for (let sent = false; !sent; ) {
      const { done, value } = await reader.read();
      if (done) { controller.close(); return; }
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") { controller.enqueue(enc.encode(ev.delta)); sent = true; }
          else if (ev.type === "error" || ev.type === "response.failed") { reader.cancel().catch(() => {}); controller.error(new Error("STREAM_FAILED")); return; }
        } catch { /* partial or non-JSON line */ }
      }
      }
    },
    cancel() { reader.cancel().catch(() => {}); },
  });
}
