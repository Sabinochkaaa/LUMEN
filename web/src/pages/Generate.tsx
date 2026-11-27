import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Download, FileSearch, Loader2, Mic, Sparkles } from "lucide-react";
import { api } from "../api";
import { useT } from "../i18n";
import { useSpeech } from "../speech";
import AgentBuddy from "../components/AgentBuddy";
import { CopyButton, ErrorBox, PageHead } from "../components/ui";

const KEY = "lumen.generate.v1";

/** LÜMEN Author: an idea (typed or spoken) becomes a spec draft in the bank template, then goes straight to review. */
export default function Generate() {
  const { t, lang } = useT();
  const nav = useNavigate();
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fresh, setFresh] = useState(false);
  const [res, setRes] = useState<{ title: string; markdown: string } | null>(() => {
    try { return JSON.parse(localStorage.getItem(KEY) || "null"); } catch { return null; }
  });
  // spoken words appear in the field live; the phrase is appended to what was already typed
  const base = useRef<string | null>(null);
  const voice = useSpeech(lang, (said, final) => {
    if (base.current === null) base.current = idea ? idea.trimEnd() + " " : "";
    setIdea(base.current + said);
    if (final) base.current = null;
  });

  const run = async () => {
    setBusy(true); setError(""); setFresh(false);
    try {
      const r = await api.generate(idea, lang);
      setRes(r); setFresh(true);
      try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* storage off */ }
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const name = (res?.title || "spec").replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) || "spec";
  const download = () => {
    if (!res) return;
    const url = URL.createObjectURL(new Blob([res.markdown], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name + ".md"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const gaps = res ? (res.markdown.match(/\[уточнить|\[нақтылау|\[clarify/gi) || []).length : 0;

  return (
    <div>
      <PageHead title={t("gen.title")} sub={t("gen.sub")} />
      <AgentBuddy agent={0} mood={busy ? "working" : fresh ? "done" : "idle"}
        say={busy ? t("gen.busy") : error ? t("gen.err") : fresh && res ? t("gen.done", { n: gaps }) : voice.listening ? t("voice.listening") : t("gen.idle")} />
      <div className="grid gap-6 lg:grid-cols-[400px_1fr]">
        <div className="card flex min-w-0 flex-col gap-4 self-start p-6">
          <div className="text-sm font-medium">{t("gen.idea")}</div>
          <div className="relative">
            <textarea value={idea} onChange={(e) => setIdea(e.target.value)} maxLength={4000} rows={9} placeholder={t("gen.place")}
              className="w-full resize-y rounded-xl border border-line bg-canvas px-3.5 py-3 text-[14px] leading-relaxed outline-none focus:border-signal" />
            {voice.supported && (
              <button type="button" onClick={voice.toggle} aria-pressed={voice.listening} aria-label={t("voice.btn")} title={t("voice.btn")}
                className={`absolute bottom-3 right-3 grid h-9 w-9 place-items-center rounded-full ${voice.listening ? "bg-bad text-white" : "bg-line/80 text-ink-soft hover:text-ink"}`}>
                {voice.listening && <span className="absolute inset-0 animate-ping rounded-full bg-bad/40" />}
                <Mic size={16} className="relative" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[t("gen.ex1"), t("gen.ex2"), t("gen.ex3")].map((x) => (
              <button key={x} onClick={() => setIdea(x)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-soft hover:border-signal/50 hover:text-ink">{x.slice(0, 42)}…</button>
            ))}
          </div>
          {voice.error && <p className="text-[13px] text-bad">{t(`voice.${voice.error}`)}</p>}
          {error && <ErrorBox error={error} />}
          <button className="btn-primary justify-center py-3" disabled={idea.trim().length < 10 || busy} onClick={run}>
            {busy ? <><Loader2 size={16} className="animate-spin" />{t("gen.running")}</> : <><Sparkles size={16} />{t("gen.run")}</>}
          </button>
          <p className="meta">{t("gen.note")}</p>
        </div>

        <div className="card flex min-h-[420px] min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <div className="h2">{res?.title || t("gen.result")}</div>
            {res && <div className="ml-auto flex flex-wrap gap-2">
              <CopyButton text={res.markdown} label={t("tr.copy")} />
              <button className="btn-line" onClick={download}><Download size={15} />MD</button>
              <button className="btn-line" onClick={() => api.translationDocx(res.markdown, name)}><Download size={15} />Word</button>
              <button className="btn-primary" onClick={() => nav("/new", { state: { markdown: res.markdown, name: name + ".md" } })}>
                <FileSearch size={15} />{t("gen.review")}
              </button>
            </div>}
          </div>
          {busy ? (
            <div className="relative flex-1 overflow-hidden p-6">
              <div className="scanbar" />
              {Array.from({ length: 16 }).map((_, i) => <div key={i} className="mb-3 h-3 animate-pulse rounded bg-line" style={{ width: `${30 + ((i * 37) % 65)}%` }} />)}
            </div>
          ) : res ? (
            <motion.pre key={res.markdown.length} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex-1 overflow-auto whitespace-pre-wrap p-5 font-mono text-[13px] leading-relaxed">{res.markdown}</motion.pre>
          ) : <div className="meta flex flex-1 items-center justify-center p-6 text-center">{t("gen.empty")}</div>}
        </div>
      </div>
    </div>
  );
}
