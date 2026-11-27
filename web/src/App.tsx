import { Suspense, cloneElement, createContext, lazy, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useOutlet, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  FilePlus2, FileText, GitFork, HelpCircle, Landmark, LayoutDashboard, Languages, ListChecks, Lock, Menu, PenLine, Settings as Cog, ShieldAlert, ShieldCheck, X,
} from "lucide-react";
import AgentBuddy from "./components/AgentBuddy";
import { api, Audit, Health } from "./api";
import { LangProvider, useT } from "./i18n";
import { ThemeProvider } from "./theme";
import Landing from "./pages/Landing";
import SupportWidget from "./components/SupportWidget";
// heavy screens (graph, charts) load on demand: the first visit downloads only the landing
const Overview = lazy(() => import("./pages/Overview"));
const NewAudit = lazy(() => import("./pages/NewAudit"));
const AuditHome = lazy(() => import("./pages/AuditHome"));
const Requirements = lazy(() => import("./pages/Requirements"));
const Issues = lazy(() => import("./pages/Issues"));
const Graph = lazy(() => import("./pages/Graph"));
const Clarifications = lazy(() => import("./pages/Clarifications"));
const Fintech = lazy(() => import("./pages/Fintech"));
const Compare = lazy(() => import("./pages/Compare"));
const Translate = lazy(() => import("./pages/Translate"));
const Generate = lazy(() => import("./pages/Generate"));
const Reports = lazy(() => import("./pages/Reports"));
const Settings = lazy(() => import("./pages/Settings"));
import { Empty, ErrorBox, LangSwitch, Loading, Logo, ThemeSwitch } from "./components/ui";

// ---------------------------------------------------------------- shared state
interface Ctx { health: Health | null; lastId: string | null; setLastId: (id: string) => void; admin: boolean; refreshAuth: () => void }
const AppCtx = createContext<Ctx>({ health: null, lastId: null, setLastId: () => {}, admin: false, refreshAuth: () => {} });
export const useApp = () => useContext(AppCtx);

export function useAudit() {
  const { id = "" } = useParams();
  const { setLastId } = useApp();
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [missing, setMissing] = useState(false);
  const reload = useCallback(() => {
    api.get(id).then((a) => { setAudit(a); setError(""); setMissing(false); })
      .catch((e) => { setError(String(e.message || e)); setMissing(e?.status === 404); });
  }, [id]);
  useEffect(() => { setAudit(null); reload(); if (id) setLastId(id); }, [id, reload, setLastId]);
  return { audit, setAudit, error, missing, reload, id };
}

export function AuditGate({ children }: { children: (a: Audit, set: (a: Audit) => void) => JSX.Element }) {
  const { audit, setAudit, error, missing } = useAudit();
  const { t } = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const { setLastId } = useApp();
  // a report that is gone (deleted, or kept only on a server disk that was reset): forget it and open the newest one
  useEffect(() => {
    if (!missing) return;
    setLastId("");
    const section = loc.pathname.split("/").slice(3).join("/");
    nav(`/pick/${section}`, { replace: true });
  }, [missing, loc.pathname, nav, setLastId]);
  if (missing) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!audit) return <Loading text={t("ui.loadingAudit")} />;
  return children(audit, setAudit);
}

// ---------------------------------------------------------------- layout
// design 2.0: plain icons, grouped menu (docs/DESIGN.md §6)
const NAV = [
  { to: "/dashboard", key: "nav.overview", icon: LayoutDashboard, group: "nav.gCheck" },
  { to: "/new", key: "nav.new", icon: FilePlus2, group: "nav.gCheck" },
  { to: "/generate", key: "nav.generate", icon: PenLine, group: "nav.gCheck" },
  { to: "requirements", key: "nav.requirements", icon: ListChecks, audit: true, group: "nav.gReport" },
  { to: "issues", key: "nav.issues", icon: ShieldAlert, audit: true, group: "nav.gReport" },
  { to: "graph", key: "nav.graph", icon: GitFork, audit: true, group: "nav.gReport" },
  { to: "clarifications", key: "nav.clarifications", icon: HelpCircle, audit: true, group: "nav.gReport" },
  { to: "fintech", key: "nav.fintech", icon: Landmark, audit: true, group: "nav.gReport" },
  { to: "/translate", key: "nav.translate", icon: Languages, group: "nav.gTools" },
  { to: "/reports", key: "nav.reports", icon: FileText, group: "nav.gTools" },
];
const GROUPS = ["nav.gCheck", "nav.gReport", "nav.gTools"];

function NavItem({ to, label, icon: Icon, onNav }: { to: string; label: string; icon: typeof Cog; onNav?: () => void }) {
  return (
    <NavLink to={to} onClick={onNav}
      className={({ isActive }) => `relative flex items-center gap-3 rounded-md px-3 py-[7px] text-[14px] transition-colors ${isActive ? "bg-surface-2 font-medium text-ink" : "text-ink-soft hover:bg-surface-2 hover:text-ink"}`}>
      {({ isActive }) => (<>
        {isActive && <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />}
        <Icon size={17} strokeWidth={1.7} className={isActive ? "text-ink" : "text-ink-faint"} />
        <span className="flex-1 truncate">{label}</span>
      </>)}
    </NavLink>
  );
}

function Sidebar({ onNav }: { onNav?: () => void }) {
  const { lastId, health, admin } = useApp();
  const { t } = useT();
  return (
    <aside className="flex h-full w-60 flex-col border-r border-line bg-surface">
      <NavLink to="/" className="flex items-center gap-2.5 px-5 pb-5 pt-5" onClick={onNav}>
        <Logo size={36} />
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-[0.06em]">LÜMEN</div>
          <div className="truncate text-[11.5px] text-ink-faint">{t("brand.sub")}</div>
        </div>
      </NavLink>
      <nav className="flex-1 overflow-y-auto px-3" aria-label="LÜMEN">
        {GROUPS.map((g) => (
          <div key={g} className="mb-4">
            <div className="px-3 pb-1.5 text-[11.5px] font-medium text-ink-faint">{t(g)}</div>
            <div className="space-y-px">
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavItem key={n.key} label={t(n.key)} icon={n.icon} onNav={onNav}
                  to={n.audit ? (lastId ? `/audits/${lastId}/${n.to}` : `/pick/${n.to}`) : n.to} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-3 border-t border-line p-3">
        <NavItem to="/settings" label={t("nav.settings")} icon={Cog} onNav={onNav} />
        <div className="flex items-center justify-between gap-2 px-1">
          <LangSwitch />
          <ThemeSwitch compact />
        </div>
        <div className="px-2 text-[12px] text-ink-soft">
          <div className="flex items-center gap-2">
            <span className={`h-1.5 w-1.5 rounded-full ${health ? "bg-ok" : "bg-ink-faint"}`} />
            <span className="truncate">{health ? t("status.online") : t("status.offline")}{health ? <span className="text-ink-faint"> · <span title={health.model}>{health.provider_label}</span></span> : null}</span>
          </div>
          {health?.login_enabled && (
            <NavLink to="/settings" onClick={onNav} className="mt-1.5 flex items-center gap-1.5 font-medium text-ink-soft hover:text-ink">
              {admin ? <><ShieldCheck size={13} className="text-ok" />{t("nav.admin")}</> : <><Lock size={13} />{t("nav.signIn")}</>}
            </NavLink>
          )}
        </div>
      </div>
    </aside>
  );
}

function AnimatedOutlet() {
  const loc = useLocation();
  const outlet = useOutlet();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={loc.pathname} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12, ease: "easeOut" }}>
        {outlet && cloneElement(outlet, { key: loc.pathname })}
      </motion.div>
    </AnimatePresence>
  );
}

function Shell() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { t } = useT();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="relative flex min-h-full">
      <div className="sticky top-0 z-10 hidden h-screen lg:block"><Sidebar /></div>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog">
            <motion.div className="absolute inset-0 bg-black/30" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={() => setOpen(false)} />
            <motion.div className="relative h-full w-60 shadow-lift" initial={{ x: -240 }} animate={{ x: 0 }} exit={{ x: -240 }} transition={{ duration: 0.18, ease: "easeOut" }}>
              <Sidebar onNav={() => setOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <main className="relative z-[1] min-w-0 flex-1 overflow-x-clip">
        <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface px-4 py-2.5 lg:hidden">
          <button className="btn-ghost px-2" onClick={() => setOpen(!open)} aria-label={t("ui.menu")}>{open ? <X size={18} /> : <Menu size={18} />}</button>
          <Logo size={30} /><span className="font-semibold tracking-[0.06em]">LÜMEN</span>
        </div>
        <div className="mx-auto max-w-[1280px] px-5 py-7 md:px-10"><AnimatedOutlet /></div>
      </main>
    </div>
  );
}

function Pick() {
  const { section = "" } = useParams();
  const nav = useNavigate();
  const { t } = useT();
  const [items, setItems] = useState<{ id: string }[] | null>(null);
  useEffect(() => { api.list().then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  useEffect(() => { if (items?.length) nav(`/audits/${items[0].id}/${section}`, { replace: true }); }, [items, nav, section]);
  if (items === null || items.length) return <Loading />;
  const agent = section.startsWith("issues") || section.startsWith("compare") ? 1 : section.startsWith("fintech") ? 2 : section.startsWith("clarif") ? 4 : 0;
  return (
    <div>
      <AgentBuddy agent={agent} mood="idle" say={t("ab.noAudit")} onPick={() => nav("/new")} />
      <Empty title={t("ov.emptyT")} text={t("ov.emptyD")} action={<NavLink to="/new" className="btn-primary">{t("land.cta")}</NavLink>} />
    </div>
  );
}

function Root() {
  const [health, setHealth] = useState<Health | null>(null);
  const [lastId, setLast] = useState<string | null>(() => localStorage.getItem("lumen.last"));
  const setLastId = useCallback((id: string) => {
    if (id) localStorage.setItem("lumen.last", id); else localStorage.removeItem("lumen.last");
    setLast(id || null);
  }, []);
  const [admin, setAdmin] = useState(false);
  const refreshAuth = useCallback(() => { api.me().then((m) => setAdmin(m.admin)).catch(() => setAdmin(false)); }, []);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); refreshAuth(); }, [refreshAuth]);
  return (
    <AppCtx.Provider value={{ health, lastId, setLastId, admin, refreshAuth }}>
      <Suspense fallback={<Loading />}>
      <Routes>
        <Route index element={<Landing />} />
        <Route element={<Shell />}>
          <Route path="dashboard" element={<Overview />} />
          <Route path="new" element={<NewAudit />} />
          <Route path="translate" element={<Translate />} />
          <Route path="generate" element={<Generate />} />
          <Route path="audits/:id" element={<AuditHome />} />
          <Route path="audits/:id/requirements" element={<Requirements />} />
          <Route path="audits/:id/issues" element={<Issues />} />
          <Route path="audits/:id/graph" element={<Graph />} />
          <Route path="audits/:id/clarifications" element={<Clarifications />} />
          <Route path="audits/:id/fintech" element={<Fintech />} />
          <Route path="audits/:id/compare" element={<Compare />} />
          <Route path="pick/:section" element={<Pick />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      </Suspense>
      <SupportWidget />
    </AppCtx.Provider>
  );
}

export default function App() {
  return <ThemeProvider><LangProvider><Root /></LangProvider></ThemeProvider>;
}
