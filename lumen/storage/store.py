"""Audit history storage: local JSON files (default, zero-config) or Supabase Postgres (persistent on Railway).

Supabase is accessed through its REST API (PostgREST) with the service key — no extra SDK. The table is
created by `supabase/migrations/001_audits.sql`. Reports are rendered from the stored JSON on demand.
"""
from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Optional

import httpx

from ..config import Settings, settings as default_settings
from ..models import AuditResult
from ..security import Cipher, dumps_sealed, loads_sealed, make_cipher, open_json, sealed_json

log = logging.getLogger("lumen.storage")


def summary(r: AuditResult) -> dict:
    s = r.scores
    return {
        "id": r.id, "document_name": r.passport.document_name, "document_title": r.passport.document_title,
        "analysed_at": r.passport.analysed_at, "model": r.passport.model, "provider": r.passport.provider,
        "mode": r.passport.mode, "readiness": r.readiness, "quality_index": s.quality_index,
        "requirements": s.total_requirements, "findings": s.findings_total, "critical": s.by_severity["CRITICAL"],
        "high": s.by_severity["HIGH"], "questions": len(r.questions), "open_questions": s.open_questions,
        "demo": r.demo, "duration_s": r.passport.duration_s, "private": r.private,
    }


class LocalStore:
    kind = "local"

    def __init__(self, root: Path, cipher: Optional[Cipher] = None):
        self.root = Path(root) / "audits"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self.cipher = cipher

    def _load(self, p: Path) -> AuditResult:
        return AuditResult.model_validate_json(loads_sealed(self.cipher, p.read_bytes()))

    def _p(self, audit_id: str) -> Path:
        safe = "".join(c for c in audit_id if c.isalnum() or c in "-_")
        return self.root / f"{safe}.json"

    def save(self, r: AuditResult) -> None:
        with self._lock:
            tmp = self._p(r.id).with_suffix(".tmp")
            tmp.write_bytes(dumps_sealed(self.cipher, r.model_dump_json()))
            tmp.replace(self._p(r.id))

    def get(self, audit_id: str) -> Optional[AuditResult]:
        p = self._p(audit_id)
        if not p.exists():
            return None
        return self._load(p)

    def list(self, limit: int = 100) -> list[dict]:
        items = []
        for p in sorted(self.root.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True)[:limit]:
            try:
                r = self._load(p)
                if not r.private:
                    items.append(summary(r))
            except Exception:  # corrupted file must not break the history page
                log.warning("skip unreadable audit %s", p.name)
        return items

    def delete(self, audit_id: str) -> bool:
        p = self._p(audit_id)
        if p.exists():
            p.unlink()
            return True
        return False


class SupabaseStore:
    kind = "supabase"

    def __init__(self, url: str, key: str, table: str = "audits", cipher: Optional[Cipher] = None):
        self.base = url.rstrip("/") + f"/rest/v1/{table}"
        self.h = {"apikey": key, "authorization": f"Bearer {key}", "content-type": "application/json"}
        self.cipher = cipher
        self.has_private_col = True

    def _c(self) -> httpx.Client:
        return httpx.Client(timeout=30, headers=self.h)

    def save(self, r: AuditResult) -> None:
        row = {**summary(r), "result": sealed_json(self.cipher, r.model_dump_json())}
        if not self.has_private_col:
            row.pop("private")
        with self._c() as c:
            resp = c.post(self.base, json=row, headers={"prefer": "resolution=merge-duplicates,return=minimal"})
            if resp.status_code == 400 and "private" in resp.text and self.has_private_col:
                log.warning("В таблице audits нет колонки private — выполните supabase/migrations/002_security.sql")
                self.has_private_col = False
                row.pop("private")
                resp = c.post(self.base, json=row, headers={"prefer": "resolution=merge-duplicates,return=minimal"})
            resp.raise_for_status()

    def get(self, audit_id: str) -> Optional[AuditResult]:
        with self._c() as c:
            resp = c.get(self.base, params={"id": f"eq.{audit_id}", "select": "result"})
            resp.raise_for_status()
            rows = resp.json()
        return AuditResult.model_validate_json(open_json(self.cipher, rows[0]["result"])) if rows else None

    def list(self, limit: int = 100) -> list[dict]:
        cols = ("id,document_name,document_title,analysed_at,model,provider,mode,readiness,quality_index,"
                "requirements,findings,critical,high,questions,open_questions,demo,duration_s")
        params = {"select": cols, "order": "analysed_at.desc", "limit": str(limit)}
        with self._c() as c:
            if self.has_private_col:
                resp = c.get(self.base, params={**params, "private": "not.is.true"})
                if resp.status_code == 400 and "private" in resp.text:
                    self.has_private_col = False
                else:
                    resp.raise_for_status()
                    return resp.json()
            resp = c.get(self.base, params=params)
            resp.raise_for_status()
            return resp.json()

    def delete(self, audit_id: str) -> bool:
        with self._c() as c:
            resp = c.delete(self.base, params={"id": f"eq.{audit_id}"})
            resp.raise_for_status()
        return True


class FallbackStore:
    """Supabase first; on any network/DB error fall back to local files so the product keeps working."""

    def __init__(self, primary: SupabaseStore, local: LocalStore):
        self.primary, self.local = primary, local
        self.kind = "supabase"
        self.degraded = False

    def _try(self, fn, *a, default=None):
        try:
            out = getattr(self.primary, fn)(*a)
            self.degraded = False
            return out
        except Exception as e:
            if not self.degraded:
                log.warning("Supabase недоступен (%s) — используется локальное хранилище", str(e)[:160])
            self.degraded = True
            return default if fn != "save" else None

    def save(self, r: AuditResult) -> None:
        self.local.save(r)
        self._try("save", r)

    def get(self, audit_id: str) -> Optional[AuditResult]:
        return self._try("get", audit_id) or self.local.get(audit_id)

    def list(self, limit: int = 100) -> list[dict]:
        remote = self._try("list", limit, default=None)
        if remote is None:
            return self.local.list(limit)
        ids = {x["id"] for x in remote}
        return remote + [x for x in self.local.list(limit) if x["id"] not in ids]

    def delete(self, audit_id: str) -> bool:
        self._try("delete", audit_id)
        return self.local.delete(audit_id)


def make_store(cfg: Settings | None = None):
    cfg = cfg or default_settings
    cipher = make_cipher(cfg.encryption_key)
    local = LocalStore(cfg.data_dir, cipher)
    if cfg.supabase_url and cfg.supabase_key:
        return FallbackStore(SupabaseStore(cfg.supabase_url, cfg.supabase_key, cipher=cipher), local)
    return local
