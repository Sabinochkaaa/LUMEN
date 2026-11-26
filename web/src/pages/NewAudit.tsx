import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, CircleAlert, FileUp, Loader2, PlayCircle, SkipForward, Sparkles } from "lucide-react";
import { api, Line, StageEvent } from "../api";
import DocumentLens from "../components/DocumentLens";
import { ErrorBox, PageHead } from "../components/ui";
import { useApp } from "../App";

const PROVIDERS = [
  { v: "", label: "Автовыбор (по ключам на сервере)" },
  { v: "anthropic", label: "Claude — Anthropic API" },
  { v: "gemini", label: "Gemini — Google AI Studio" },
  { v: "openai", label: "OpenAI-совместимый (OpenRouter, DeepSeek…)" },
  { v: "claude-cli", label: "Claude Code CLI" },
  { v: "offline", label: "Без LLM — только правила" },
];

type Stage = { key: string; title: string; status?: StageEvent["status"]; message?: string; ms?: number };

export default function NewAudit() {
  const nav = useNavigate();
  const { health } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [stages, setStages] = useState<Stage[]>([]);
  const [run, setRun] = useState<{ id: string; name: string; demo: boolean } | null>(null);
  const [done, setDone] = useState<{ id: string; readiness: string } | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const preview = useCallback(async (f: File) => {
    if (/\.(md|markdown|txt)$/i.test(f.name)) {
      const text = await f.text();
      setLines(text.replace(/\r\n?/g, "\n").split("\n").map((t, i) => ({ no: i + 1, text: t })));
    } else setLines([]);
  }, []);

  const pick = (f?: File | null) => {
    if (!f) return;
    if (!/\.(pdf|docx|md|markdown|txt)$/i.test(f.name)) { setError("Поддерживаются PDF, DOCX, MD и TXT."); return; }
    if (f.size > 20 * 1024 * 1024) { setError("Файл больше 20 МБ."); return; }
    setError(""); setFile(f); preview(f);
  };

  const listen = (id: string) => {
    const es = api.events(id);
    es.addEventListener("queued", (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      setStages(d.stages.map((s: Stage) => ({ ...s })));
    });
    es.addEventListener("stage", (e) => {
      const ev: StageEvent = JSON.parse((e as MessageEvent).data);
      setStages((prev) => prev.map((s) => s.key === ev.key ? { ...s, status: ev.status, message: ev.message, ms: ev.elapsed_ms } : s));
    });
    es.addEventListener("result", (e) => { setDone(JSON.parse((e as MessageEvent).data)); es.close(); });
    es.addEventListener("error", (e) => {
      const data = (e as MessageEvent).data;
      if (data) { setError(JSON.parse(data).message); es.close(); }
    });
  };

  const start = async () => {
    if (!file) return;
    setError(""); setDone(null);
    try {
      const r = await api.upload(file, provider || undefined, model || undefined);
      setRun({ id: r.audit_id, name: file.name, demo: false });
      listen(r.audit_id);
    } catch (e: any) { setError(e.message); }
  };

  const demo = async () => {
    setError(""); setDone(null);
    try {
      const text = await fetch("/api/demo/document").then((r) => r.text());
      setLines(text.split("\n").map((t, i) => ({ no: i + 1, text: t })));
      const r = await api.demo();
      setRun({ id: r.audit_id, name: "demo_requirements.md", demo: true });
      listen(r.audit_id);
    } catch (e: any) { setError(e.message); }
  };

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => nav(`/audits/${done.id}`), 1600);
    return () => clearTimeout(t);
  }, [done, nav]);

  const finished = stages.filter((s) => s.status && s.status !== "running").length;
  const pct = stages.length ? Math.round((finished / stages.length) * 100) : 0;
  const scanning = !!run && !done && !error;

  if (run) {
    return (
      <div>
        <PageHead title={done ? "Анализ завершён" : "LÜMEN Core читает документ"}
          sub={<>{run.name}{run.demo && <span className="chip ml-2 bg-amber-50 text-amber-800">демо-прогон</span>}</>}
          right={done && <button className="btn-primary" onClick={() => nav(`/audits/${done.id}`)}>Открыть результаты</button>} />
        <div className="mb-6 h-1.5 overflow-hidden rounded-full bg-line">
          <motion.div className="h-full bg-signal" animate={{ width: `${pct}%` }} transition={{ ease: "easeOut", duration: 0.5 }} />
        </div>
        {error && <div className="mb-4"><ErrorBox error={error} /></div>}
        <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
          <div>
            {lines.length ? (
              <DocumentLens lines={lines} scanning={scanning} height={620} />
            ) : (
              <div className="relative h-[620px] overflow-hidden rounded-xl border border-line bg-[#FBFCFE] p-6">
                {scanning && <div className="lens-beam" />}
                {Array.from({ length: 22 }).map((_, i) => (
                  <div key={i} className="mb-3 h-3 rounded bg-line" style={{ width: `${40 + ((i * 37) % 55)}%` }} />
                ))}
                <p className="meta absolute bottom-4 left-6">PDF и DOCX извлекаются на сервере — текст появится в отчёте с номерами строк и страниц.</p>
              </div>
            )}
          </div>
          <ol className="card divide-y divide-line" aria-live="polite">
            {stages.map((s, i) => (
              <li key={s.key} className="flex items-start gap-3 px-5 py-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                  style={{ background: s.status === "done" ? "#E7F6EE" : s.status === "error" ? "#FDECEA" : s.status === "running" ? "#EAF0FF" : "#F3F5F9",
                    color: s.status === "done" ? "#12A150" : s.status === "error" ? "#D92D20" : s.status === "running" ? "#1F4FD8" : "#98A2B3" }}>
                  {s.status === "done" ? <Check size={14} /> : s.status === "running" ? <Loader2 size={14} className="animate-spin" /> :
                    s.status === "error" ? <CircleAlert size={14} /> : s.status === "skipped" ? <SkipForward size={13} /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`text-[14px] ${s.status ? "text-ink" : "text-ink-faint"}`}>{s.title}</div>
                  <AnimatePresence>
                    {s.message && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="meta mt-0.5 break-words">
                        {s.message}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {!!s.ms && s.ms > 300 && <span className="meta tabular-nums">{(s.ms / 1000).toFixed(1)} с</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHead title="Новый аудит требований"
        sub="Статическая проверка документа до разработки по ISO/IEC/IEEE 29148 и IEEE 830 с FinTech-экспертизой." />
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          role="button" tabIndex={0}
          className={`card flex min-h-[340px] cursor-pointer flex-col items-center justify-center border-2 border-dashed px-8 text-center transition-colors ${drag ? "border-signal bg-signal-wash" : "border-line hover:border-signal/50"}`}>
          <input ref={input} type="file" hidden accept=".pdf,.docx,.md,.markdown,.txt" onChange={(e) => pick(e.target.files?.[0])} />
          <FileUp size={36} strokeWidth={1.5} className="text-signal" />
          {file ? (
            <>
              <div className="mt-4 text-lg font-medium">{file.name}</div>
              <div className="meta">{(file.size / 1024).toFixed(1)} КБ · нажмите, чтобы выбрать другой файл</div>
            </>
          ) : (
            <>
              <div className="mt-4 text-lg font-medium">Перетащите документ требований сюда</div>
              <div className="meta mt-1">или нажмите, чтобы выбрать файл · PDF, DOCX, MD, TXT · до 20 МБ</div>
            </>
          )}
        </div>
        <div className="card flex flex-col gap-4 p-6">
          <div>
            <label className="text-sm font-medium" htmlFor="prov">Модель анализа</label>
            <select id="prov" className="input mt-1.5" value={provider} onChange={(e) => setProvider(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.v} value={p.v} disabled={!!p.v && p.v !== "offline" && health ? !health.providers[p.v] : false}>
                  {p.label}{p.v && p.v !== "offline" && health && !health.providers[p.v] ? " — нет ключа" : ""}
                </option>
              ))}
            </select>
            <p className="meta mt-1.5">Сейчас по умолчанию: {health ? `${health.provider_label}, ${health.model}` : "—"}</p>
          </div>
          <div>
            <label className="text-sm font-medium" htmlFor="model">Конкретная модель (необязательно)</label>
            <input id="model" className="input mt-1.5" placeholder="например, claude-opus-5-5" value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          {error && <ErrorBox error={error} />}
          <button className="btn-primary justify-center py-3" disabled={!file} onClick={start}>
            <Sparkles size={16} />Запустить аудит
          </button>
          <div className="border-t border-line pt-4">
            <button className="btn-line w-full justify-center" onClick={demo}><PlayCircle size={16} />Посмотреть демо-прогон</button>
            <p className="meta mt-2">Демо использует подготовленный документ и смоделированные ответы модели. Он помечается в истории и не смешивается с реальными проверками.</p>
          </div>
        </div>
      </div>
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[
          ["Доказательства, а не мнения", "Каждое замечание цитирует документ дословно и указывает строку. Цитату, которой нет в тексте, агент помечает «требует проверки»."],
          ["Вопросы вместо догадок", "Если в требовании не хватает числа или правила, LÜMEN формулирует вопрос владельцу с вариантами ответа и риском."],
          ["Отраслевой взгляд", "Идемпотентность, денежные единицы, повторная доставка событий и права доступа — только там, где это применимо к документу."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl border border-line bg-white/60 p-5">
            <div className="font-medium">{t}</div>
            <p className="meta mt-1.5 leading-relaxed">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
