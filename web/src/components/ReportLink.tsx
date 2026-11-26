import { ReactNode, useState } from "react";
import { api } from "../api";
import { useApp } from "../App";

type Fmt = "md" | "html" | "json" | "pdf" | "docx" | "xlsx";

/** Direct link on an open server; fetch-with-token download in private mode (no token in URLs). */
export default function ReportLink({ id, fmt, name, className, children, open }: { id: string; fmt: Fmt; name?: string; className: string; children: ReactNode; open?: boolean }) {
  const { health } = useApp();
  const [busy, setBusy] = useState(false);
  if (!health?.private_mode) {
    return open
      ? <a className={className} href={api.reportUrl(id, fmt)} target="_blank" rel="noreferrer">{children}</a>
      : <a className={className} href={api.reportUrl(id, fmt, true)}>{children}</a>;
  }
  return (
    <button className={className} disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api.download(id, fmt, name || `lumen_${id}`); } catch (e: any) { alert(e.message); } finally { setBusy(false); }
    }}>{children}</button>
  );
}
