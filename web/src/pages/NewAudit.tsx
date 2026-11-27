import { useCallback, useEffect, useRef, useState } from "react";
import AgentBuddy from "../components/AgentBuddy";
import { useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Check, CircleAlert, FileUp, Loader2, SkipForward } from "lucide-react";
import { api, Line, StageEvent } from "../api";
import DocumentLens from "../components/DocumentLens";
import AgentOffice from "../components/AgentOffice";
import { ErrorBox, PageHead } from "../components/ui";
import { useApp } from "../App";
import { useT } from "../i18n";

const PROVIDERS = ["", "anthropic", "gemini", "openrouter", "groq", "openai", "claude-cli", "offline"];
const PLABEL: Record<string, string> = { anthropic: "Claude — Anthropic", gemini: "Gemini — Google", openrouter: "OpenRouter", groq: "Groq", openai: "OpenAI-compatible", "claude-cli": "Claude Code CLI" };
type Stage = { key: string; title: string; status?: StageEvent["status"]; message?: string; ms?: number };

export default function NewAudit() {
  const nav = useNavigate();
  const { health, admin } = useApp();
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [run, setRun] = useState<{ id: string; name: string } | null>(null);
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const preview = useCallback(async (f: File) => {
    if (/\.(md|markdown|txt)$/i.test(f.name)) {
      const text = await f.text();
      setLines(text.replace(/\r\n?/g, "\n").split("\n").map((x, i) => ({ no: i + 1, text: x })));
    } else setLines([]);
  }, []);

  const pick = (f?: File | null) => {
    if (!f) return;
    if (!/\.(pdf|docx|md|markdown|txt|html?|rtf|png|jpe?g|webp|tiff?|bmp)$/i.test(f.name)) { setError(t("new.badFormat")); return; }
    if (f.size > 20 * 1024 * 1024) { setError(t("new.tooBig")); return; }
    setError(""); setFile(f); preview(f);
  };
  // a spec handed over from the generator arrives ready to review
  const loc = useLocation();
  useEffect(() => {
    const md = (loc.state as { markdown?: string; name?: string } | null)?.markdown;
    if (md) pick(new File([md], (loc.state as any).name || "generated_spec.md", { type: "text/markdown" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = async () => {
    if (!file) return;
    setError(""); setDone(null);
    try {
      const r = await api.upload(file, provider || undefined, model || undefined);
      setRun({ id: r.audit_id, name: file.name });
      api.events(r.audit_id, (type, d) => {
        if (type === "queued") setStages(d.stages.map((s: Stage) => ({ ...s })));
        else if (type === "stage") {
          const ev = d as StageEvent;
          setStages((prev) => prev.map((s) => s.key === ev.key ? { ...s, status: ev.status, message: ev.message, ms: ev.elapsed_ms } : s));
        } else if (type === "result") setDone(d);
        else if (type === "error") setError(d.message);
      });
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => nav(`/audits/${done.id}`), 1600);
    return () => clearTimeout(id);
  }, [done, nav]);

  const finished = stages.filter((s) => s.status && s.status !== "running").length;
  const pct = done ? 100 : stages.length ? Math.round((finished / stages.length) * 100) : 0;
  const scanning = !!run && !done && !error;

  if (run) {
    return (
      <div>
        <PageHead title={done ? t("new.done") : t("new.reading")} sub={run.name}
          right={done && <button className="btn-primary" onClick={() => nav(`/audits/${done.id}`)}>{t("new.open")}</button>} />
        <div className="mb-6 h-2 overflow-hidden rounded-full bg-line">
          <motion.div className="h-full bg-primary" animate={{ width: `${pct}%` }} transition={{ ease: "easeOut", duration: 0.5 }} />
        </div>
        {error && <div className="mb-4"><ErrorBox error={error} /></div>}
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          {lines.length ? <DocumentLens lines={lines} scanning={scanning} height={620} /> : (
            <div className="relative h-[620px] overflow-hidden rounded-md border border-line bg-surface-2 p-6">
              {scanning && <div className="scanbar" />}
              {Array.from({ length: 22 }).map((_, i) => <div key={i} className="mb-3 h-3 rounded bg-line" style={{ width: `${40 + ((i * 37) % 55)}%` }} />)}
              <p className="meta absolute bottom-4 left-6 right-6">{t("new.serverText")}</p>
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-4">
          <AgentOffice stages={stages} finished={!!done} />
          <ol className="card max-h-[300px] divide-y divide-line overflow-y-auto" aria-live="polite">
            {stages.map((s, i) => (
              <motion.li key={s.key} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="flex items-start gap-3 px-5 py-3">
                <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                  s.status === "done" ? "bg-ok/15 text-ok" : s.status === "error" ? "bg-bad/15 text-bad" : s.status === "running" ? "bg-signal/15 text-signal" : "bg-ink/5 text-ink-faint"}`}>
                  {s.status === "done" ? <Check size={14} /> : s.status === "running" ? <Loader2 size={14} className="animate-spin" /> :
                    s.status === "error" ? <CircleAlert size={14} /> : s.status === "skipped" ? <SkipForward size={13} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] ${s.status ? "text-ink" : "text-ink-faint"}`}>{t(`stage.${s.key}`)}</div>
                  <AnimatePresence>{s.message && <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="meta mt-0.5 break-words">{s.message}</motion.div>}</AnimatePresence>
                </div>
                {!!s.ms && s.ms > 300 && <span className="meta tabular-nums">{(s.ms / 1000).toFixed(1)} s</span>}
              </motion.li>
            ))}
          </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead title={t("new.title")} sub={t("new.sub")} />
      <AgentBuddy agent={0} mood="idle" say={file ? t("ab.newFile", { name: file.name }) : t("ab.new")} />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <motion.div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          onClick={() => input.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          role="button" tabIndex={0}
          className={`card relative flex min-h-[360px] cursor-pointer flex-col items-center justify-center overflow-hidden border-2 border-dashed px-8 text-center transition-colors ${drag ? "border-signal bg-signal/5" : "border-line hover:border-signal/50"}`}>
          <input ref={input} type="file" hidden accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.rtf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.bmp" onChange={(e) => pick(e.target.files?.[0])} />
          <div className="relative flex h-14 w-14 items-center justify-center rounded-lg border border-line bg-surface-2 text-ink-soft">
            <FileUp size={26} strokeWidth={1.6} />
          </div>
          {file ? (<>
            <div className="relative mt-5 text-lg font-medium">{file.name}</div>
            <div className="meta relative">{(file.size / 1024).toFixed(1)} KB · {t("new.other")}</div>
          </>) : (<>
            <div className="relative mt-5 text-lg font-medium">{t("new.drop")}</div>
            <div className="meta relative mt-1 max-w-md">{t("new.dropHint")}</div>
          </>)}
        </motion.div>
        <div className="card flex flex-col gap-4 p-6">
          <div>
            <label className="text-sm font-medium" htmlFor="prov">{t("new.model")}</label>
            <select id="prov" className="input mt-1.5" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => {
                const off = !!p && p !== "offline" && !!health && !health.providers[p];
                return <option key={p} value={p} disabled={off}>{p === "" ? t("new.auto") : p === "offline" ? t("new.offline") : PLABEL[p]}{off ? ` — ${t("new.noKey")}` : ""}</option>;
              })}
            </select>
            <p className="meta mt-1.5">{t("new.default")}: {health ? `${health.provider_label}, ${health.model}` : "—"}</p>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="model">{t("new.modelName")}</label>
            <input id="model" className="input mt-1.5" placeholder="claude-opus-5-5" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          {health?.auth_required && !admin && <p className="rounded-md bg-signal/10 px-3 py-2 text-[13px] text-signal">{t("new.adminNeeded")}</p>}
          {error && <ErrorBox error={error} />}
          <button className="btn-primary mt-auto h-11 justify-center" disabled={!file} onClick={start}>{t("new.start")}<ArrowRight size={16} /></button>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((n) => (
          <motion.div key={n} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 * n }} className="card p-5">
            <div className="font-medium">{t(`land.f${n}`)}</div>
            <p className="meta mt-1.5 leading-relaxed">{t(`land.f${n}d`)}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
