import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  FileSearch, FilePlus2, GitFork, HelpCircle, LayoutDashboard, ListChecks, Settings as Cog, ShieldAlert, FileText, Landmark, Menu, X,
} from "lucide-react";
import { api, Audit, Health } from "./api";
import Overview from "./pages/Overview";
import NewAudit from "./pages/NewAudit";
import AuditHome from "./pages/AuditHome";
import Requirements from "./pages/Requirements";
import Issues from "./pages/Issues";
import Graph from "./pages/Graph";
import Clarifications from "./pages/Clarifications";
import Fintech from "./pages/Fintech";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import { Empty, ErrorBox, Loading } from "./components/ui";

// ---------------------------------------------------------------- shared state
interface Ctx {
  health: Health | null;
  lastId: string | null;
  setLastId: (id: string) => void;
}
const AppCtx = createContext<Ctx>({ health: null, lastId: null, setLastId: () => {} });
export const useApp = () => useContext(AppCtx);

/** Loads the audit of the current route and keeps it in sync after edits. */
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
  if (error) return <ErrorBox error={error} />;
  if (!audit) return <Loading text="Загружаем результаты аудита…" />;
  return children(audit, setAudit);
}

// ---------------------------------------------------------------- layout
const NAV = [
  { to: "/", label: "Обзор", icon: LayoutDashboard, end: true },
  { to: "/new", label: "Новый аудит", icon: FilePlus2 },
  { to: "requirements", label: "Требования", icon: ListChecks, audit: true },
  { to: "issues", label: "Дефекты", icon: ShieldAlert, audit: true },
  { to: "graph", label: "Граф связей", icon: GitFork, audit: true },
  { to: "clarifications", label: "Вопросы владельцу", icon: HelpCircle, audit: true },
  { to: "fintech", label: "FinTech-риски", icon: Landmark, audit: true },
  { to: "/reports", label: "Отчёты", icon: FileText },
  { to: "/settings", label: "Настройки", icon: Cog },
];

function Sidebar({ onNav }: { onNav?: () => void }) {
  const { lastId, health } = useApp();
  return (
    <aside className="flex h-full w-64 flex-col border-r border-line bg-white">
      <div className="px-6 pb-6 pt-7">
        <div className="flex items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="#0E1A33" /><path d="M10 7v18h12" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" /><circle cx="21" cy="11" r="3" fill="#3BA7E8" /></svg>
          <div>
            <div className="text-[17px] font-semibold tracking-[0.08em]">LÜMEN</div>
            <div className="-mt-0.5 text-[11.5px] text-ink-faint">Requirements Intelligence</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Разделы">
        {NAV.map((n) => {
          const target = n.audit ? (lastId ? `/audits/${lastId}/${n.to}` : `/pick/${n.to}`) : n.to;
          return (
            <NavLink key={n.label} to={target} end={n.end} onClick={onNav}
              className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] transition-colors ${isActive ? "bg-signal-wash text-signal font-medium" : "text-ink-soft hover:bg-canvas hover:text-ink"}`}>
              <n.icon size={17} strokeWidth={1.8} />
              {n.label}
            </NavLink>
          );
        })}
      </nav>
      <div className="m-3 rounded-xl bg-canvas px-4 py-3 text-[12px] text-ink-soft">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${health ? "bg-emerald-500" : "bg-slate-300"}`} />
          {health ? "LÜMEN Core подключён" : "Нет связи с сервером"}
        </div>
        {health && <div className="mt-1 truncate text-ink-faint" title={health.model}>{health.provider_label}</div>}
      </div>
    </aside>
  );
}

function Shell() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div className="flex min-h-full">
      <div className="sticky top-0 hidden h-screen lg:block"><Sidebar /></div>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <div className="relative h-full w-64"><Sidebar onNav={() => setOpen(false)} /></div>
        </div>
      )}
      <main className="min-w-0 flex-1">
        <div className="flex items-center gap-3 border-b border-line bg-white px-4 py-3 lg:hidden">
          <button className="btn-ghost px-2" onClick={() => setOpen(!open)} aria-label="Меню">{open ? <X size={18} /> : <Menu size={18} />}</button>
          <span className="font-semibold tracking-[0.08em]">LÜMEN</span>
        </div>
        <div className="mx-auto max-w-[1280px] px-5 py-8 md:px-10"><Outlet /></div>
      </main>
    </div>
  );
}

function Pick() {
  const { section = "" } = useParams();
  const nav = useNavigate();
  const [items, setItems] = useState<{ id: string }[] | null>(null);
  useEffect(() => { api.list().then((r) => setItems(r.items)).catch(() => setItems([])); }, []);
  useEffect(() => { if (items?.length) nav(`/audits/${items[0].id}/${section}`, { replace: true }); }, [items, nav, section]);
  if (items === null) return <Loading />;
  return <Empty title="Аудитов пока нет" text="Загрузите документ требований — LÜMEN выделит требования, найдёт дефекты и сформирует вопросы к владельцу."
    action={<NavLink to="/new" className="btn-primary"><FileSearch size={16} />Начать аудит</NavLink>} />;
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [lastId, setLast] = useState<string | null>(() => localStorage.getItem("lumen.last"));
  const setLastId = useCallback((id: string) => { localStorage.setItem("lumen.last", id); setLast(id); }, []);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  return (
    <AppCtx.Provider value={{ health, lastId, setLastId }}>
      <Routes>
        <Route element={<Shell />}>
          <Route index element={<Overview />} />
          <Route path="new" element={<NewAudit />} />
          <Route path="audits/:id" element={<AuditHome />} />
          <Route path="audits/:id/requirements" element={<Requirements />} />
          <Route path="audits/:id/issues" element={<Issues />} />
          <Route path="audits/:id/graph" element={<Graph />} />
          <Route path="audits/:id/clarifications" element={<Clarifications />} />
          <Route path="audits/:id/fintech" element={<Fintech />} />
          <Route path="pick/:section" element={<Pick />} />
          <Route path="reports" element={<Reports />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </AppCtx.Provider>
  );
}
