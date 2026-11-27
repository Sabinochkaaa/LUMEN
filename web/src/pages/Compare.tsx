import { useEffect, useState } from "react";
import AuditBuddy from "../components/AuditBuddy";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, CheckCircle2, CircleDot, PlusCircle } from "lucide-react";
import { AuditGate } from "../App";
import { api, Audit, AuditSummary, CmpItem, CompareResult } from "../api";
import { useT } from "../i18n";
import AuditHeader from "../components/AuditHeader";
import { ErrorBox, Loading, Num, ReadinessBadge, SevBadge, fmtDate } from "../components/panelUi";

export default function Compare() {
  return <AuditGate>{(a) => <View a={a} />}</AuditGate>;
}

function View({ a }: { a: Audit }) {
  const { t, lang } = useT();
  const [others, setOthers] = useState<AuditSummary[] | null>(null);
  const [base, setBase] = useState("");
  const [res, setRes] = useState<CompareResult | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.list().then((r) => {
      const o = r.items.filter((x) => x.id !== a.id);
      setOthers(o);
      const same = o.find((x) => x.document_title === a.passport.document_title) || o[0];
      if (same) setBase(same.id);
    }).catch((e) => setError(e.message));
  }, [a]);
  useEffect(() => {
    if (!base) return;
    setRes(null);
    api.compare(base, a.id).then(setRes).catch((e) => setError(e.message));
  }, [base, a.id]);

  return (
    <div>
      <AuditHeader a={a} />
      <AuditBuddy a={a} page="compare" />
      <h2 className="text-xl font-semibold">{t("cmp.title")}</h2>
      <p className="meta mb-5 mt-1 max-w-2xl">{t("cmp.sub")}</p>
      {error && <ErrorBox error={error} />}
      {others === null ? <Loading /> : !others.length ? (
        <div className="card p-6 meta">{t("cmp.none")} <Link to="/new" className="text-signal">{t("nav.new")}</Link></div>
      ) : (<>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">{t("cmp.pick")}</span>
          <select className="input w-full max-w-md sm:w-auto" value={base} onChange={(e) => setBase(e.target.value)}>
            {others.map((o) => <option key={o.id} value={o.id}>{o.document_title || o.document_name} — {fmtDate(o.analysed_at, lang)}</option>)}
          </select>
        </div>
        {!res ? <Loading /> : (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="card mb-6 grid items-center gap-6 p-6 md:grid-cols-[1fr_auto_1fr_auto]">
              <Side s={res.base} lang={lang} />
              <ArrowRight className="hidden text-ink-faint md:block" />
              <Side s={res.new} lang={lang} />
              <div className="text-center">
                <div className={`text-[34px] font-semibold ${res.delta_quality >= 0 ? "text-ok" : "text-bad"}`}>{res.delta_quality >= 0 ? "+" : ""}<Num value={res.delta_quality} decimals={1} /></div>
                <div className="meta">{t("cmp.delta")}</div>
              </div>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Col title={t("cmp.fixed")} items={res.fixed} tone="ok" icon={<CheckCircle2 size={17} />} />
              <Col title={t("cmp.remaining")} items={res.remaining} tone="warn" icon={<CircleDot size={17} />} />
              <Col title={t("cmp.added")} items={res.added} tone="bad" icon={<PlusCircle size={17} />} />
            </div>
          </motion.div>
        )}
      </>)}
    </div>
  );
}

function Side({ s, lang }: { s: CompareResult["base"]; lang: string }) {
  return (
    <div>
      <div className="meta">{fmtDate(s.analysed_at, lang)}</div>
      <div className="font-medium">{s.document}</div>
      <div className="mt-2 flex items-center gap-2"><ReadinessBadge r={s.readiness} /><span className="text-lg font-semibold tabular-nums">{s.quality_index}</span></div>
    </div>
  );
}

function Col({ title, items, tone, icon }: { title: string; items: CmpItem[]; tone: string; icon: JSX.Element }) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-2 font-semibold" style={{ color: `rgb(var(--${tone}))` }}>{icon}{title}<span className="ml-auto text-2xl tabular-nums"><Num value={items.length} /></span></div>
      <ul className="space-y-2">
        {items.map((f, i) => (
          <motion.li key={f.id + i} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.03 }} className="rounded-lg bg-ink/[0.03] px-3 py-2 text-[13px]">
            <div className="flex items-center gap-2"><SevBadge sev={f.severity} short /></div>
            <div className="mt-1 leading-snug">{f.title}</div>
            {f.where && <div className="meta mt-0.5">{f.where}</div>}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}
