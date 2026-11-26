import { FormEvent, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Send, X } from "lucide-react";
import { api, ChatTurn } from "../api";
import { useT } from "../i18n";

const KEY = "lumen.support";

/** The support agent's face: the red robot of the agent team, drawn flat. */
export function SupportFace({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <radialGradient id="sf-shell" cx="35%" cy="30%" r="80%"><stop offset="0" stopColor="#FF8A7A" /><stop offset=".55" stopColor="#F0453A" /><stop offset="1" stopColor="#B4231B" /></radialGradient>
      </defs>
      <ellipse cx="20" cy="21" rx="18" ry="16" fill="url(#sf-shell)" />
      <ellipse cx="20" cy="22" rx="13" ry="9.5" fill="#0B1020" />
      <rect className="sf-eye" x="13" y="19" width="3.2" height="6" rx="1.6" fill="#7FE7FF" />
      <rect className="sf-eye" x="23.8" y="19" width="3.2" height="6" rx="1.6" fill="#7FE7FF" />
      <ellipse cx="14" cy="11" rx="4" ry="2" fill="#fff" opacity=".45" />
    </svg>
  );
}

type Msg = ChatTurn & { suggestions?: string[]; escalate?: boolean };

export default function SupportWidget() {
  const { t, lang } = useT();
  const loc = useLocation();
  const auditId = loc.pathname.match(/^\/audits\/([A-Za-z0-9_-]{1,64})/)?.[1];
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try { return JSON.parse(sessionStorage.getItem(KEY) || "[]"); } catch { return []; }
  });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [handoff, setHandoff] = useState(false);
  const [contact, setContact] = useState("");
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("lumen:support", show);
    return () => window.removeEventListener("lumen:support", show);
  }, []);

  useEffect(() => {
    try { sessionStorage.setItem(KEY, JSON.stringify(msgs.slice(-30))); } catch { /* storage off */ }
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" });
  }, [msgs, open]);

  const ask = async (q: string) => {
    const question = q.trim();
    if (!question || busy) return;
    setText("");
    const history = msgs.map(({ role, text }) => ({ role, text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const r = await api.support(question, history, lang, auditId);
      setMsgs((m) => [...m, { role: "agent", text: r.answer, suggestions: r.suggestions, escalate: r.escalate }]);
      if (r.escalate) setHandoff(true);
    } catch (e: any) {
      const slow = e?.name === "TimeoutError" || e?.name === "AbortError";
      setMsgs((m) => [...m, { role: "agent", text: slow ? t("sup.timeout") : e.message, escalate: true }]);
    } finally { setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); ask(text); };
  const sendTicket = async (e: FormEvent) => {
    e.preventDefault();
    const lastQ = [...msgs].reverse().find((m) => m.role === "user")?.text || text;
    if (!lastQ) return;
    try {
      const r = await api.ticket(lastQ, contact, msgs.map(({ role, text }) => ({ role, text })), auditId);
      setMsgs((m) => [...m, { role: "agent", text: `${t("sup.sent")}${r.id}` }]);
      setHandoff(false); setContact("");
    } catch (err: any) { setMsgs((m) => [...m, { role: "agent", text: err.message }]); }
  };
  const last = msgs[msgs.length - 1];
  const chips = last?.role === "agent" && last.suggestions?.length ? last.suggestions : msgs.length ? [] : [t("sup.q1"), t("sup.q2"), t("sup.q3")];

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button key="fab" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.6, opacity: 0 }}
            whileHover={{ y: -3 }} onClick={() => setOpen(true)} aria-label={t("sup.open")}
            className="fixed bottom-5 right-5 z-50 flex h-16 w-16 items-center justify-center rounded-full border border-line bg-surface shadow-lift">
            <SupportFace size={44} />
            <span className="absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-surface bg-ok" />
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div key="panel" role="dialog" aria-label={t("sup.title")}
            initial={{ opacity: 0, y: 24, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 24, scale: 0.97 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-x-3 bottom-3 z-50 flex max-h-[min(640px,calc(100vh-24px))] flex-col overflow-hidden rounded-3xl border border-line bg-surface shadow-lift sm:inset-x-auto sm:right-5 sm:w-[380px]">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <SupportFace size={36} />
              <div className="min-w-0">
                <div className="font-semibold">{t("sup.title")}</div>
                <div className="meta flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-ok" />{t("sup.status")}</div>
              </div>
              <button onClick={() => setOpen(false)} aria-label={t("sup.close")} className="ml-auto rounded-lg p-2 text-ink-soft hover:bg-line/60 hover:text-ink"><X size={18} /></button>
            </div>
            {auditId && <div className="meta border-b border-line bg-signal/5 px-4 py-1.5">{t("sup.aboutAudit")}</div>}
            <div ref={list} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
              <Bubble role="agent" text={t("sup.hello")} />
              {msgs.map((m, i) => <Bubble key={i} role={m.role} text={m.text} />)}
              {busy && <div className="flex gap-1 px-2 py-2">{[0, 1, 2].map((i) => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-ink-faint" style={{ animationDelay: `${i * 0.12}s` }} />)}</div>}
            </div>
            {chips.length > 0 && !busy && (
              <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                {chips.map((c) => <button key={c} onClick={() => ask(c)} className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-soft hover:border-signal/50 hover:text-ink">{c}</button>)}
              </div>
            )}
            {handoff ? (
              <form onSubmit={sendTicket} className="flex gap-2 border-t border-line p-3">
                <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={200} placeholder={t("sup.contact")} aria-label={t("sup.contact")}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-signal" />
                <button className="btn-primary px-3 text-sm">{t("sup.handoff")}</button>
              </form>
            ) : (
              <form onSubmit={submit} className="flex gap-2 border-t border-line p-3">
                <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t("sup.place")} aria-label={t("sup.place")}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-signal" />
                <button className="btn-primary px-3" disabled={!text.trim() || busy} aria-label={t("sup.send")}><Send size={16} /></button>
              </form>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Bubble({ role, text }: ChatTurn) {
  const mine = role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${mine ? "rounded-br-md bg-signal text-white" : "rounded-bl-md bg-canvas text-ink"}`}>{text}</div>
    </motion.div>
  );
}
