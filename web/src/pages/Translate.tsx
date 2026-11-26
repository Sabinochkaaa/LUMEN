import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, FileUp, Languages, Loader2 } from "lucide-react";
import { api } from "../api";
import { LANGS, useT } from "../i18n";
import { CopyButton, ErrorBox, PageHead } from "../components/ui";

export default function Translate() {
  const { t, lang } = useT();
  const [file, setFile] = useState<File | null>(null);
  const [target, setTarget] = useState(lang === "en" ? "ru" : "en");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ markdown: string; model: string; source_name: string } | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const run = async () => {
    if (!file) return;
    setBusy(true); setError(""); setRes(null);
    try { setRes(await api.translate(file, target)); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const base = (res?.source_name || "document").replace(/\.[^.]+$/, "") + "_" + target;
  const download = (text: string, name: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  return (
    <div>
      <PageHead title={t("tr.title")} sub={t("tr.sub")} />
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="card flex flex-col gap-4 p-6">
          <button onClick={() => input.current?.click()} className="flex flex-col items-center rounded-xl border-2 border-dashed border-line px-4 py-8 text-center transition-colors hover:border-signal/50">
            <input ref={input} type="file" hidden accept=".pdf,.docx,.md,.markdown,.txt,.html,.htm,.rtf,.png,.jpg,.jpeg" onChange={(e) => { setFile(e.target.files?.[0] || null); setRes(null); }} />
            <FileUp size={28} className="text-signal" />
            <div className="mt-3 font-medium">{file ? file.name : t("new.drop")}</div>
            <div className="meta mt-1">PDF, DOCX, MD, TXT, HTML, RTF, PNG/JPG</div>
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
        <div className="card flex min-h-[420px] flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
            <div className="h2">{t("tr.result")}</div>
            {res && <span className="meta">· {res.model}</span>}
            {res && <div className="ml-auto flex gap-2">
              <CopyButton text={res.markdown} label={t("tr.copy")} />
              <button className="btn-line" onClick={() => download(res.markdown, base + ".md")}><Download size={15} />MD</button>
              <button className="btn-primary" onClick={() => api.translationDocx(res.markdown, base)}><Download size={15} />Word</button>
            </div>}
          </div>
          {busy ? (
            <div className="relative flex-1 overflow-hidden p-6">
              <div className="lens-beam" />
              {Array.from({ length: 14 }).map((_, i) => <div key={i} className="mb-3 h-3 animate-pulse rounded bg-line" style={{ width: `${35 + ((i * 41) % 60)}%` }} />)}
            </div>
          ) : res ? (
            <motion.pre initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 overflow-auto whitespace-pre-wrap p-5 font-mono text-[13px] leading-relaxed">{res.markdown}</motion.pre>
          ) : <div className="meta flex flex-1 items-center justify-center p-6">{t("tr.empty")}</div>}
        </div>
      </div>
    </div>
  );
}
