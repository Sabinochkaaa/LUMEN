import { Fragment, ReactNode } from "react";

/**
 * A small, safe Markdown renderer for translated and generated specs: headings, tables, lists, bold, inline code,
 * rules and code blocks. It builds React elements only (no HTML strings), so text from a document can never run.
 */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    out.push(tok.startsWith("**") ? <strong key={m.index}>{tok.slice(2, -2)}</strong>
      : <code key={m.index} className="rounded bg-line/60 px-1 py-0.5 font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export default function MarkdownView({ text }: { text: string }) {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      blocks.push(<pre key={i} className="my-3 overflow-auto rounded-xl bg-line/40 p-3 font-mono text-[12.5px]">{body.join("\n")}</pre>);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(ln) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const head = cells(ln);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={i} className="my-3 overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-[13.5px]">
            <thead className="bg-line/40"><tr>{head.map((h, k) => <th key={k} className="px-3 py-2 font-semibold">{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, k) => <tr key={k} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className="px-3 py-2">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(ln);
    if (h) {
      const size = ["text-[22px] mt-2", "text-[18px] mt-5", "text-[15.5px] mt-4", "text-[14.5px] mt-3"][h[1].length - 1];
      blocks.push(<div key={i} className={`${size} mb-2 font-semibold`}>{inline(h[2])}</div>);
      i++;
      continue;
    }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(ln)) { blocks.push(<hr key={i} className="my-4 border-line" />); i++; continue; }
    if (/^\s*([*-]|\d+\.)\s+/.test(ln)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(ln);
      while (i < lines.length && /^\s*([*-]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([*-]|\d+\.)\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={i} className={`my-2 space-y-1 pl-5 ${ordered ? "list-decimal" : "list-disc"}`}>{items.map((x, k) => <li key={k}>{inline(x)}</li>)}</L>);
      continue;
    }
    if (!ln.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*\||\s*([*-]|\d+\.)\s|```)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    blocks.push(<p key={i} className="my-2">{para.map((p, k) => <Fragment key={k}>{k > 0 && <br />}{inline(p.replace(/\s+$/, ""))}</Fragment>)}</p>);
  }
  return <div className="text-[14.5px] leading-relaxed">{blocks}</div>;
}
