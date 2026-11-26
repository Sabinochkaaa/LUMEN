"""LÜMEN REST API (FastAPI): upload → background audit → live SSE progress → results, reports, clarifications.

    uvicorn lumen.api.app:app --port 8000
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .. import PRODUCT_NAME, __version__
from ..config import PROVIDER_LABELS, agent_version, settings
from ..parsing.loader import FORMATS, SUPPORTED
from ..report.render import render_html, render_markdown
from ..service import get_service
from ..security import UploadRejected, client_ip, limiter, security_headers, token_ok, validate_upload
from ..storage.store import summary

log = logging.getLogger("lumen.api")
logging.getLogger("httpx").setLevel(logging.WARNING)  # httpx logs full URLs (Telegram token is in the URL)
MAX_UPLOAD = 20 * 1024 * 1024
WEB_DIST = Path(__file__).resolve().parent.parent.parent / "web" / "dist"

@asynccontextmanager
async def lifespan(_app):
    if settings.telegram_token and os.environ.get("LUMEN_BOT_IN_API", "1") == "1":
        from ..bot.telegram import TelegramBot

        threading.Thread(target=TelegramBot(settings.telegram_token, get_service()).run_forever, daemon=True,
                         name="lumen-telegram").start()
        log.info("Telegram-бот запущен внутри API")
    yield


app = FastAPI(title=f"{PRODUCT_NAME} API", version=__version__, lifespan=lifespan,
              description="AI-Powered Requirements Quality & Compliance Platform")
_cors = os.environ.get("LUMEN_CORS", "" if settings.production else "*")
if _cors:
    app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in _cors.split(",") if x.strip()],
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["X-API-Token", "Content-Type"])


@app.middleware("http")
async def guard(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path != "/api/health":
        ip = client_ip(request.headers, request.client.host if request.client else "unknown")
        ok, retry = limiter.allow(f"req:{ip}", settings.rate_requests_per_min, 60)
        if not ok:
            return JSONResponse({"detail": f"Слишком много запросов. Повторите через {retry} с."}, status_code=429,
                                headers={"Retry-After": str(retry)})
    response = await call_next(request)
    https = request.headers.get("x-forwarded-proto", request.url.scheme) == "https"
    for k, v in security_headers(path, https).items():
        response.headers.setdefault(k, v)
    return response


def require_token(x_api_token: Optional[str] = Header(default=None)) -> None:
    if not token_ok(x_api_token, settings.api_token):
        raise HTTPException(401, "Требуется токен доступа: введите его в разделе «Настройки» (LUMEN_API_TOKEN на сервере)")


def require_read(x_api_token: Optional[str] = Header(default=None)) -> None:
    if settings.private_mode:
        require_token(x_api_token)


def limit_audits(request: Request) -> None:
    ip = client_ip(request.headers, request.client.host if request.client else "unknown")
    ok, retry = limiter.allow(f"audit:{ip}", settings.rate_audits_per_hour, 3600)
    if not ok:
        raise HTTPException(429, f"Лимит запусков анализа исчерпан. Повторите через {retry // 60 + 1} мин.",
                            headers={"Retry-After": str(retry)})


@app.get("/api/health")
def health():
    svc = get_service()
    prov = settings.resolve_provider()
    return {
        "status": "ok", "product": PRODUCT_NAME, **agent_version(), "provider": prov,
        "provider_label": PROVIDER_LABELS.get(prov, prov), "model": settings.resolve_model(prov),
        "providers": settings.available_providers(), "storage": svc.store.kind,
        "storage_degraded": getattr(svc.store, "degraded", False), "auth_required": bool(settings.api_token),
        "private_mode": settings.private_mode, "public_demo": settings.public_demo or not settings.api_token,
        "encryption": bool(settings.encryption_key),
        "telegram": bool(settings.telegram_token), "formats": FORMATS,
    }


@app.post("/api/audits", dependencies=[Depends(require_token), Depends(limit_audits)])
async def create_audit(file: UploadFile = File(...), provider: Optional[str] = Form(None), model: Optional[str] = Form(None)):
    name = Path(file.filename or "document").name
    ext = Path(name).suffix.lower()
    if ext not in SUPPORTED:
        raise HTTPException(415, f"Формат «{ext or '?'}» не поддерживается. Допустимо: PDF, DOCX, MD, TXT, HTML, RTF, PNG, JPG.")
    data = await file.read(MAX_UPLOAD + 1)
    if len(data) > MAX_UPLOAD:
        raise HTTPException(413, "Файл больше 20 МБ")
    if not data.strip():
        raise HTTPException(422, "Файл пуст")
    try:
        validate_upload(name, data)
    except UploadRejected as e:
        raise HTTPException(422, str(e)) from None
    if provider and provider not in PROVIDER_LABELS and provider not in ("auto", "claude"):
        raise HTTPException(422, f"Неизвестный провайдер: {provider}")
    svc = get_service()
    safe = re.sub(r"[^\w.\-]+", "_", name)[-80:]
    import uuid as _uuid

    path = svc.uploads / f"{_uuid.uuid4().hex}_{safe}"
    path.write_bytes(data)
    job = svc.submit(path, name, provider=None if provider in (None, "", "auto") else provider, model=model or None)
    return {"job_id": job.id, "audit_id": job.id, "events": f"/api/audits/{job.id}/events"}


def demo_access(x_api_token: Optional[str] = Header(default=None)) -> None:
    if not settings.public_demo:  # demo uses scripted answers, no model cost — public by default
        require_token(x_api_token)


@app.post("/api/demo", dependencies=[Depends(demo_access), Depends(limit_audits)])
def create_demo():
    job = get_service().submit_demo()
    return {"job_id": job.id, "audit_id": job.id, "events": f"/api/audits/{job.id}/events", "demo": True}


@app.get("/api/demo/document", dependencies=[Depends(demo_access)])
def demo_document():
    from ..service import DEMO_DOC

    return PlainTextResponse(DEMO_DOC.read_text(encoding="utf-8"), media_type="text/markdown; charset=utf-8")


@app.get("/api/audits/{audit_id}/events", dependencies=[Depends(require_read)])
async def events(audit_id: str):
    job = get_service().jobs.get(audit_id)
    if job is None:
        r = get_service().store.get(audit_id)
        if r is None:
            raise HTTPException(404, "Прогон не найден")

        async def done_stream():
            for ev in r.stages:
                yield f"event: stage\ndata: {ev.model_dump_json()}\n\n"
            yield f"event: result\ndata: {json.dumps({'id': r.id, 'readiness': r.readiness})}\n\n"

        return StreamingResponse(done_stream(), media_type="text/event-stream")

    async def stream():
        sent = 0
        while True:
            with job.cond:
                batch = job.events[sent:]
            for ev in batch:
                yield f"event: {ev['type']}\ndata: {json.dumps(ev['data'], ensure_ascii=False)}\n\n"
            sent += len(batch)
            if job.status in ("done", "error") and sent >= len(job.events):
                break
            if not batch:
                yield ": keep-alive\n\n"
            await asyncio.sleep(0.25)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"cache-control": "no-cache", "x-accel-buffering": "no"})


@app.get("/api/audits", dependencies=[Depends(require_read)])
def list_audits(limit: int = Query(100, ge=1, le=500)):
    svc = get_service()
    items = svc.store.list(limit)
    running = [{"id": j.id, "document_name": j.name, "status": j.status} for j in svc.jobs.values()
               if j.status in ("queued", "running") and not j.private]
    return {"items": items, "running": running}


def _get(audit_id: str):
    r = get_service().store.get(audit_id)
    if r is None:
        job = get_service().jobs.get(audit_id)
        if job and job.status == "error":
            raise HTTPException(422, job.error)
        if job:
            raise HTTPException(409, "Анализ ещё выполняется")
        raise HTTPException(404, "Прогон не найден")
    return r


@app.get("/api/audits/{audit_id}", dependencies=[Depends(require_read)])
def get_audit(audit_id: str):
    r = _get(audit_id)
    return JSONResponse(json.loads(r.model_dump_json()) | {"summary": summary(r)})


@app.get("/api/audits/{audit_id}/report.{fmt}", dependencies=[Depends(require_read)])
def report(audit_id: str, fmt: Literal["md", "html", "json", "pdf", "docx", "xlsx"], download: bool = False):
    from fastapi.responses import Response

    from ..report.export import MIME, render as export_render

    r = _get(audit_id)
    base = re.sub(r"[^\w\-]+", "_", Path(r.passport.document_name).stem)[:60] or "report"
    fname = f"lumen_audit_{base}_{r.id}.{fmt}"
    headers = {"content-disposition": f'attachment; filename="{fname}"'} if download else {}
    if fmt in MIME:
        if fmt != "pdf":
            headers = {"content-disposition": f'attachment; filename="{fname}"'}
        try:
            return Response(export_render(r, fmt), media_type=MIME[fmt], headers=headers)
        except Exception as e:
            raise HTTPException(500, f"Не удалось сформировать {fmt.upper()}: {e}") from None
    if fmt == "md":
        return PlainTextResponse(render_markdown(r), media_type="text/markdown; charset=utf-8", headers=headers)
    if fmt == "html":
        return HTMLResponse(render_html(r), headers=headers)
    return JSONResponse(json.loads(r.model_dump_json()), headers=headers)


class QuestionPatch(BaseModel):
    status: Optional[Literal["open", "clarified", "rejected"]] = None
    answer: Optional[str] = None


@app.patch("/api/audits/{audit_id}/questions/{qid}", dependencies=[Depends(require_token)])
def patch_question(audit_id: str, qid: str, body: QuestionPatch):
    try:
        r = get_service().update_question(audit_id, qid, body.status, body.answer)
    except KeyError:
        raise HTTPException(404, "Вопрос или прогон не найден") from None
    q = next(x for x in r.questions if x.id == qid)
    return {"question": q.model_dump(), "scores": r.scores.model_dump(), "readiness": r.readiness,
            "readiness_reason": r.readiness_reason}


@app.delete("/api/audits/{audit_id}", dependencies=[Depends(require_token)])
def delete_audit(audit_id: str):
    if settings.production and not settings.api_token:
        raise HTTPException(403, "Удаление на публичном сервере доступно только с токеном (задайте LUMEN_API_TOKEN)")
    get_service().jobs.pop(audit_id, None)
    return {"deleted": get_service().store.delete(audit_id)}


@app.get("/api/criteria")
def criteria():
    from ..engine.criteria import REQUIREMENT_CRITERIA, SET_CRITERIA
    from ..engine.fintech import ASPECTS

    return {
        "requirement": [{"key": k, "name": v[0], "ref": v[1], "definition": v[2], "basis": v[3]} for k, v in REQUIREMENT_CRITERIA.items()],
        "set": [{"key": k, "name": v[0], "ref": v[1], "definition": v[2], "basis": v[3]} for k, v in SET_CRITERIA.items()],
        "fintech": [{"key": k, "name": n} for k, n, _ in ASPECTS],
    }


# ---------------------------------------------------------------- frontend (built React app)
if WEB_DIST.exists():
    app.mount("/assets", StaticFiles(directory=WEB_DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = WEB_DIST / path
        if path and target.is_file() and WEB_DIST in target.resolve().parents:
            return FileResponse(target)
        return FileResponse(WEB_DIST / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root():
        return {"product": PRODUCT_NAME, "docs": "/docs", "hint": "Соберите dashboard: cd web && npm i && npm run build"}
