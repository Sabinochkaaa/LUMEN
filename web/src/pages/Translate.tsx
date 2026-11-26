import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Clock, Download, FileText, FileUp, Languages, Loader2, Trash2 } from "lucide-react";
import { api, TranslationResult } from "../api";
import { LANGS, useT } from "../i18n";
import AgentBuddy from "../components/AgentBuddy";
import { CopyButton, ErrorBox, PageHead } from "../components/ui";

/** One finished translation, kept in this browser so the user sees what they translated before. */
interface Entry { id: string; at: number; name: string; target: string; image?: string; res: TranslationResult }

const KEY = "lumen.tr.history";
const MAX = 8;
const IMG = /\.(png|jpe?g|webp|bmp|tiff?)$/i;

function loadHistory(): Entry[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
function saveHistory(list: Entry[]) {
  // photos make entries heavy: drop the oldest until the browser accepts it
  for (let n = list.length; n > 0; n--) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, n))); return; } catch { /* quota — try fewer */ }
  }
  try { localStorage.removeItem(KEY); } catch { /* storage disabled */ }
}

/** Downscaled copy of the photo (JPEG, ≤ 1000 px) — shown under the overlay and kept in history. */
function shrink(file: File): Promise<string> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1000 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(""); };
    img.src = url;
  });
}

function Overlay({ src, overlay, show }: { src: string; overlay: NonNullable<TranslationResult["overlay"]>; show: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / overlay.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [overlay.width]);
  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-xl border border-line">
      <img src={src} alt="" className="block w-full" />
      <AnimatePresence>
        {show && overlay.boxes.map((b, i) => (
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }}
            title={b.orig}
            className="absolute flex items-center overflow-hidden rounded-[3px] px-1 font-semibold leading-none shadow-sm"
            style={{
              // a little bigger than the OCR box so ascenders and descenders of the original are covered
              left: `${((b.x - b.h * 0.2) / overlay.width) * 100}%`, top: `${((b.y - b.h * 0.25) / overlay.height) * 100}%`,
              minWidth: `${((b.w + b.h * 0.4) / overlay.width) * 100}%`, height: `${((b.h * 1.5) / overlay.height) * 100}%`,
              fontSize: Math.max(9, b.h * scale * 0.78), whiteSpace: "nowrap",
              background: "#fff", color: "#0E1A33",
            }}>
            {b.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

type View = "overlay" | "text" | "original" | "side";

/** the translator's tablet glows in the colour of the target language */
const TINT: Record<string, string> = { ru: "#2F6BFF", kk: "#00AFCA", en: "#7C4DFF" };

export default function Translate() {
  const { t, lang } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [target, setTarget] = useState(lang === "en" ? "ru" : "en");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<Entry[]>(loadHistory);
  // the last translation is shown right away, so a returning user sees what they translated
  const [cur, setCur] = useState<Entry | null>(() => history[0] ?? null);
  const [view, setView] = useState<View>(() => (history[0]?.res.overlay && history[0]?.image ? "overlay" : "text"));
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!fresh) return; const id = setTimeout(() => setFresh(false), 4000); return () => clearTimeout(id); }, [fresh]);

  const pick = async (f: File | null) => {
    setFile(f); setError("");
    setPreview(f && IMG.test(f.name) ? await shrink(f) : "");
  };
  const run = async () => {
    if (!file) return;
    setBusy(true); setError(""); setCur(null);
    try {
      const res = await api.translate(file, target);
      const e: Entry = { id: Math.random().toString(36).slice(2), at: Date.now(), name: file.name, target, image: preview || undefined, res };
      setCur(e);
      setView(res.overlay && preview ? "overlay" : "text");
      const next = [e, ...history.filter((h) => !(h.name === e.name && h.target === e.target))].slice(0, MAX);
      setHistory(next); saveHistory(next);
      setFresh(true);
    } catch (err: any) { setError(err.message); } finally { setBusy(false); }
  };
  const open = (e: Entry) => { setCur(e); setView(e.res.overlay && e.image ? "overlay" : "text"); };
  const clear = () => { setHistory([]); saveHistory([]); };

  const res = cur?.res;
  const base = (res?.source_name || "document").replace(/\.[^.]+$/, "") + "_" + (cur?.target || target);
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const views: [View, string][] = cur?.image
    ? [["overlay", t("tr.overlay")], ["text", t("tr.text")], ["original", t("tr.original")]]
    : [["text", t("tr.text")], ["side", t("tr.side")], ["original", t("tr.original")]];
  const langLabel = (c: string) => LANGS.find((l) => l.code === c)?.label ?? c;
  const pre = "whitespace-pre-wrap font-mono text-[13px] leading-relaxed";

  return (
    <div>
      <PageHead title={t("tr.title")} sub={t("tr.sub")} />
      <AgentBuddy agent={3} tint={TINT[target]}
        mood={busy ? "working" : fresh ? "done" : "idle"}
        say={busy ? t("buddy.trBusy", { lang: langLabel(target) })
          : error ? t("buddy.trError")
          : fresh && cur ? t("buddy.trDone", { lang: langLabel(cur.target) })
          : file ? t("buddy.trPicked", { name: file.name, lang: langLabel(target) })
          : t("buddy.trIdle")}
        onPick={() => input.current?.click()} />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr] lg:grid-rows-[auto_1fr]">
          <div className="card flex min-w-0 flex-col gap-4 p-6 lg:col-start-1 lg:row-start-1">
            <button onClick={() => input.current?.click()} className="group flex flex-col items-center overflow-hidden rounded-xl border-2 border-dashed border-line px-4 py-6 text-center transition-colors hover:border-signal/50">
              <input ref={input} type="file" hidden accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.rtf,.png,.jpg,.jpeg"
                onChange={(e) => { pick(e.target.files?.[0] || null); e.target.value = ""; }} />
              {preview ? <img src={preview} alt="" className="mb-3 max-h-40 rounded-lg object-contain shadow-sm" />
                : file ? <FileText size={28} className="text-signal" /> : <FileUp size={28} className="text-signal" />}
              <div className="mt-2 max-w-full truncate font-medium">{file ? file.name : t("new.drop")}</div>
              <div className="meta mt-1">{file ? `${(file.size / 1024).toFixed(0)} KB · ${t("tr.change")}` : "PDF, DOCX, MD, TXT, HTML, RTF, PNG/JPG"}</div>
            </button>
            <div>
              <div className="mb-1.5 text-sm font-medium">{t("tr.target")}</div>
              <div className="grid grid-cols-3 gap-2">
                {LANGS.map((l) => (
                  <button key={l.code} onClick={() => setTarget(l.code)} className={`relative rounded-xl border px-3 py-2.5 text-sm transition-colors ${target === l.code ? "border-transparent text-white" : "border-line hover:border-signal/50"}`}>
                    {target === l.code && <motion.span layoutId="tr-lang" className="absolute inset-0 rounded-xl grad-bg" />}
                    <span className="relative font-medium">{l.label}</span>
                  </button>
                ))}
              </div>
            </div>
            {error && <ErrorBox error={error} />}
            <button className="btn-primary justify-center py-3" disabled={!file || busy} onClick={run}>
              {busy ? <><Loader2 size={16} className="animate-spin" />{t("tr.running")}</> : <><Languages size={16} />{t("tr.run")}</>}
            </button>
          </div>

          {history.length > 0 && (
            <div className="card order-3 min-w-0 self-start p-5 lg:order-none lg:col-start-1 lg:row-start-2">
              <div className="mb-3 flex items-center gap-2">
                <Clock size={15} className="text-ink-soft" />
                <div className="font-semibold">{t("tr.history")}</div>
                <button onClick={clear} className="meta ml-auto flex items-center gap-1 hover:text-ink"><Trash2 size={13} />{t("tr.clear")}</button>
              </div>
              <ul className="space-y-1">
                {history.map((h) => (
                  <li key={h.id}>
                    <button onClick={() => open(h)} className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-line/50 ${cur?.id === h.id ? "bg-line/60" : ""}`}>
                      {h.image ? <img src={h.image} alt="" className="h-9 w-9 shrink-0 rounded object-cover" />
                        : <span className="grid h-9 w-9 shrink-0 place-items-center rounded bg-line/70"><FileText size={16} className="text-ink-soft" /></span>}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{h.name}</span>
                        <span className="meta block">→ {langLabel(h.target)} · {new Date(h.at).toLocaleString(lang === "en" ? "en-GB" : lang === "kk" ? "kk-KZ" : "ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="meta mt-2">{t("tr.historyNote")}</div>
            </div>
          )}

        <div className="card flex min-h-[420px] min-w-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <div className="h2">{t("tr.result")}</div>
            {cur && <span className="meta truncate">· {cur.name} → {langLabel(cur.target)} · {res?.model}</span>}
            {res && <div className="ml-auto flex gap-2">
              <CopyButton text={res.markdown} label={t("tr.copy")} />
              <button className="btn-line" onClick={() => download(res.markdown, base + ".md")}><Download size={15} />MD</button>
              <button className="btn-primary" onClick={() => api.translationDocx(res.markdown, base)}><Download size={15} />Word</button>
            </div>}
          </div>
          {res && (
            <div className="flex gap-1 border-b border-line px-4 py-2">
              {views.map(([k, l]) => (
                <button key={k} onClick={() => setView(k)} className={`relative rounded-lg px-3 py-1.5 text-sm ${view === k ? "font-medium text-signal" : "text-ink-soft hover:text-ink"}`}>
                  {view === k && <motion.span layoutId="tr-view" className="absolute inset-0 rounded-lg bg-signal/15" />}
                  <span className="relative">{l}</span>
                </button>
              ))}
            </div>
          )}
          {busy ? (
            <div className="relative flex-1 overflow-hidden p-6">
              <div className="lens-beam" />
              {Array.from({ length: 14 }).map((_, i) => <div key={i} className="mb-3 h-3 animate-pulse rounded bg-line" style={{ width: `${35 + ((i * 41) % 60)}%` }} />)}
            </div>
          ) : res && cur ? (
            <motion.div key={cur.id + view} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 overflow-auto p-5">
              {cur.image && (view === "overlay" || view === "original") ? (
                <>
                  {view === "overlay" && !res.overlay && <p className="meta mb-3">{t("tr.noOverlay")}</p>}
                  {res.overlay ? <Overlay src={cur.image} overlay={res.overlay} show={view === "overlay"} />
                    : <img src={cur.image} alt="" className="w-full rounded-xl border border-line" />}
                  {view === "original" && res.source_text && <pre className={`${pre} mt-4 text-ink-soft`}>{res.source_text}</pre>}
                </>
              ) : view === "side" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div><div className="meta mb-2">{t("tr.original")}</div><pre className={`${pre} text-ink-soft`}>{res.source_text}</pre></div>
                  <div><div className="meta mb-2">{t("tr.text")}</div><pre className={pre}>{res.markdown}</pre></div>
                </div>
              ) : view === "original" ? (
                <pre className={`${pre} text-ink-soft`}>{res.source_text || "—"}</pre>
              ) : (
                <pre className={pre}>{res.markdown}</pre>
              )}
              {res.warnings?.map((w) => <p key={w} className="meta mt-4">⚠ {w}</p>)}
            </motion.div>
          ) : <div className="meta flex flex-1 items-center justify-center p-6">{t("tr.empty")}</div>}
        </div>
      </div>
    </div>
  );
}
