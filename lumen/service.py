"""Job service shared by the REST API and the Telegram bot: background audits with live progress."""
from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .config import Settings, settings as default_settings
from .engine.pipeline import STAGES, AuditError, run_audit
from .engine.scoring import compute
from .models import AuditResult, StageEvent
from .storage.store import make_store

log = logging.getLogger("lumen.service")
DEMO_DOC = Path(__file__).resolve().parent.parent / "examples" / "demo_requirements.md"


@dataclass
class Job:
    id: str
    name: str
    status: str = "queued"  # queued | running | done | error
    events: list[dict] = field(default_factory=list)
    error: str = ""
    private: bool = False
    created: float = field(default_factory=time.time)
    cond: threading.Condition = field(default_factory=threading.Condition)

    def push(self, kind: str, data: dict) -> None:
        with self.cond:
            self.events.append({"type": kind, "data": data})
            self.cond.notify_all()


class AuditService:
    def __init__(self, cfg: Settings | None = None):
        self.cfg = cfg or default_settings
        self.store = make_store(self.cfg)
        self.jobs: dict[str, Job] = {}
        self.pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="lumen-audit")
        self.uploads = Path(self.cfg.data_dir) / "uploads"
        self.uploads.mkdir(parents=True, exist_ok=True)

    def submit(self, path: Path, name: str, provider: Optional[str] = None, model: Optional[str] = None,
               demo: bool = False, private: bool = False) -> Job:
        job = Job(id=uuid.uuid4().hex[:20], name=name, private=private)  # 80-bit unguessable id
        self.jobs[job.id] = job
        job.push("queued", {"id": job.id, "name": name, "stages": [{"key": k, "title": t} for k, t in STAGES]})
        self.pool.submit(self._run, job, path, provider, model, demo)
        self._gc()
        return job

    def _gc(self) -> None:
        """Forget finished jobs older than an hour (results stay in storage)."""
        cutoff = time.time() - 3600
        for jid in [j.id for j in self.jobs.values() if j.status in ("done", "error") and j.created < cutoff]:
            self.jobs.pop(jid, None)

    def submit_demo(self, private: bool = False) -> Job:
        return self.submit(DEMO_DOC, DEMO_DOC.name, provider="mock", demo=True, private=private)

    def _run(self, job: Job, path: Path, provider, model, demo) -> None:
        job.status = "running"
        responder = None
        if provider == "mock":
            from .demo import demo_responder

            responder = demo_responder

        def cb(ev: StageEvent) -> None:
            job.push("stage", ev.model_dump())

        try:
            result = run_audit(path, provider=provider, model=model, display_name=job.name, progress=cb,
                               responder=responder, demo=demo, audit_id=job.id, cfg=self.cfg)
            result.private = job.private
            for key, title, msg in (("report", "Генерация отчёта", "Markdown, HTML и JSON доступны для скачивания"),
                                    ("save", "Сохранение отчёта", f"Хранилище: {self.store.kind}")):
                idx = next(i for i, (k, _) in enumerate(STAGES) if k == key) + 1
                ev = StageEvent(index=idx, total=len(STAGES), key=key, title=title, status="done", message=msg)
                result.stages.append(ev)
                cb(ev)
            self.store.save(result)
            job.status = "done"
            job.push("result", {"id": result.id, "readiness": result.readiness,
                                "quality_index": result.scores.quality_index})
        except AuditError as e:
            job.status, job.error = "error", str(e)
            job.push("error", {"message": str(e)})
        except Exception as e:  # never leave a client hanging on an unexpected failure
            log.exception("audit failed")
            job.status, job.error = "error", f"Внутренняя ошибка анализа: {type(e).__name__}: {str(e)[:300]}"
            job.push("error", {"message": job.error})
        finally:
            if path.parent == self.uploads:
                try:
                    path.unlink()
                except OSError:
                    pass

    def run_sync(self, path: Path, name: str, provider=None, model=None, demo=False, timeout: float = 1800) -> AuditResult:
        job = self.submit(path, name, provider, model, demo)
        with job.cond:
            job.cond.wait_for(lambda: job.status in ("done", "error"), timeout=timeout)
        if job.status != "done":
            raise AuditError(job.error or "Превышено время ожидания анализа")
        r = self.store.get(job.id)
        assert r is not None
        return r

    def update_question(self, audit_id: str, qid: str, status: Optional[str], answer: Optional[str]) -> AuditResult:
        r = self.store.get(audit_id)
        if r is None:
            raise KeyError(audit_id)
        q = next((x for x in r.questions if x.id == qid), None)
        if q is None:
            raise KeyError(qid)
        if status:
            q.status = status  # type: ignore[assignment]
        if answer is not None:
            q.answer = answer.strip()[:2000]
        return self._rescore(r)

    def _rescore(self, r: AuditResult) -> AuditResult:
        llm_ok = r.passport.mode != "offline"
        r.scores, r.readiness, r.readiness_reason = compute(r.requirements, r.assessments, r.findings, r.questions, llm_ok)
        self.store.save(r)
        return r


_service: Optional[AuditService] = None


def get_service() -> AuditService:
    global _service
    if _service is None:
        _service = AuditService()
    return _service
