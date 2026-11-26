import { Suspense, cloneElement, createContext, lazy, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useOutlet, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  FilePlus2, FileText, GitFork, HelpCircle, Landmark, LayoutDashboard, Languages, ListChecks, Lock, Menu, Settings as Cog, ShieldAlert, ShieldCheck, X,
} from "lucide-react";
import { api, Audit, Health } from "./api";
import { LangProvider, useT } from "./i18n";
import { ThemeProvider } from "./theme";
import Landing from "./pages/Landing";
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
  const reload = useCallback(() => {
    api.get(id).then((a) => { setAudit(a); setError(""); }).catch((e) => setError(String(e.message || e)));
  }, [id]);
  useEffect(() => { setAudit(null); reload(); if (id) setLastId(id); }, [id, reload, setLastId]);
  return { audit, setAudit, error, reload, id };
}

export function AuditGate({ children }: { children: (a: Audit, set: (a: Audit) => void) => JSX.Element }) {
  const { audit, setAudit, error } = useAudit();
  const { t } = useT();
  if (error) return <ErrorBox error={error} />;
  if (!audit) return <Loading text={t("ui.loadingAudit")} />;
  return children(audit, setAudit);
}

// ---------------------------------------------------------------- layout
const NAV = [
  { to: "/dashboard", key: "nav.overview", icon: LayoutDashboard },
  { to: "/new", key: "nav.new", icon: FilePlus2 },
  { to: "requirements", key: "nav.requirements", icon: ListChecks, audit: true },
  { to: "issues", key: "nav.issues", icon: ShieldAlert, audit: true },
  { to: "graph", key: "nav.graph", icon: GitFork, audit: true },
  { to: "clarifications", key: "nav.clarifications", icon: HelpCircle, audit: true },
  { to: "fintech", key: "nav.fintech", icon: Landmark, audit: true },
  { to: "/translate", key: "nav.translate", icon: Languages },
  { to: "/reports", key: "nav.reports", icon: FileText },
  { to: "/settings", key: "nav.settings", icon: Cog },
];

function Sidebar({ onNav }: { onNav?: () => void }) {
  const { lastId, health, admin } = useApp();
  const { t } = useT();
  return (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-surface/80 backdrop-blur-xl">
      <NavLink to="/" className="flex items-center gap-2.5 px-6 pb-6 pt-7" onClick={onNav}>
        <Logo />
        <div>
          <div className="text-[17px] font-semibold tracking-[0.08em]">LÜMEN</div>
          <div className="-mt-0.5 text-[11.5px] text-ink-faint">{t("brand.sub")}</div>
        </div>
      </NavLink>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3" aria-label="LÜMEN">
        {NAV.map((n) => {
          const target = n.audit ? (lastId ? `/audits/${lastId}/${n.to}` : `/pick/${n.to}`) : n.to;
          return (
            <NavLink key={n.key} to={target} onClick={onNav}
              className={({ isActive }) => `relative flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors ${isActive ? "font-medium text-signal" : "text-ink-soft hover:bg-ink/5 hover:text-ink"}`}>
              {({ isActive }) => (<>
                {isActive && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-xl bg-signal/10" transition={{ type: "spring", stiffness: 450, damping: 35 }} />}
                <n.icon size={17} strokeWidth={1.8} className="relative" />
                <span className="relative">{t(n.key)}</span>
              </>)}
            </NavLink>
          );
        })}
      </nav>
      <div className="space-y-2 p-3">
        <LangSwitch />
        <ThemeSwitch compact />
        <div className="rounded-xl bg-ink/5 px-4 py-3 text-[12px] text-ink-soft">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${health ? "bg-ok shadow-[0_0_8px_rgb(var(--ok))]" : "bg-ink-faint"}`} />
            {health ? t("status.online") : t("status.offline")}
          </div>
          {health && <div className="mt-1 truncate text-ink-faint" title={health.model}>{health.provider_label}</div>}
          {health?.login_enabled && (
            <NavLink to="/settings" onClick={onNav} className="mt-2 flex items-center gap-1.5 font-medium text-ink-soft hover:text-ink">
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
      <motion.div key={loc.pathname} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}>
        {outlet && cloneElement(outlet, { key: loc.pathname })}
      </motion.div>
    </AnimatePresence>
  );
}

export function Aurora() {
  return <div className="aurora" aria-hidden><i /><i /><i /></div>;
}

function Shell() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { t } = useT();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="relative flex min-h-full">
      <Aurora />
      <div className="sticky top-0 z-10 hidden h-screen lg:block"><Sidebar /></div>
      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog">
            <motion.div className="absolute inset-0 bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.div className="relative h-full w-64" initial={{ x: -260 }} animate={{ x: 0 }} exit={{ x: -260 }} transition={{ type: "spring", stiffness: 380, damping: 36 }}>
              <Sidebar onNav={() => setOpen(false)} />
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <main className="relative z-[1] min-w-0 flex-1 overflow-x-clip">
        <div className="flex items-center gap-3 border-b border-line bg-surface/80 px-4 py-3 backdrop-blur lg:hidden">
          <button className="btn-ghost px-2" onClick={() => setOpen(!open)} aria-label={t("ui.menu")}>{open ? <X size={18} /> : <Menu size={18} />}</button>
          <Logo size={24} /><span className="font-semibold tracking-[0.08em]">LÜMEN</span>
        </div>
        <div className="mx-auto max-w-[1280px] px-5 py-8 md:px-10"><AnimatedOutlet /></div>
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
  if (items === null) return <Loading />;
  return <Empty title={t("ov.emptyT")} text={t("ov.emptyD")} action={<NavLink to="/new" className="btn-primary">{t("land.cta")}</NavLink>} />;
}

function Root() {
  const [health, setHealth] = useState<Health | null>(null);
  const [lastId, setLast] = useState<string | null>(() => localStorage.getItem("lumen.last"));
  const setLastId = useCallback((id: string) => { localStorage.setItem("lumen.last", id); setLast(id); }, []);
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
    </AppCtx.Provider>
  );
}

export default function App() {
  return <ThemeProvider><LangProvider><Root /></LangProvider></ThemeProvider>;
}
