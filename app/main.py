import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request

from app.brand_matcher import find_brand_match
from app.checker import UrlInputError, analyze_url
from app.database import (
    import_brand_domains,
    import_domains,
    initialize_database,
    list_brand_domains,
    lookup_domain,
    lookup_popular_domain,
)
from app.security_middleware import RequestBodyLimitMiddleware
from app.verdict import build_verdict


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STATIC_DIR = PROJECT_ROOT / "app" / "static"
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "url_safe.sqlite3"
DEMO_DOMAINS_PATH = PROJECT_ROOT / "data" / "domains.csv"
BRAND_DOMAINS_PATH = PROJECT_ROOT / "data" / "brands.csv"


class CheckRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2048)


class CheckResult(BaseModel):
    hostname: str
    canonical_hostname: str
    classification: Literal["known", "suspicious", "impersonation", "unknown"]
    title: str
    explanation: str
    reasons: list[str]
    source: str | None = None
    matched_brand: str | None = None
    official_domain: str | None = None
    popular_rank: int | None = None
    tranco_list_id: str | None = None
    tranco_downloaded_at: str | None = None


def create_app(database_path: Path | None = None) -> FastAPI:
    db_path = database_path or Path(os.environ.get("URLSAFE_DB_PATH", DEFAULT_DATABASE_PATH))
    production = os.environ.get("URLSAFE_ENV", "development").lower() == "production"
    allowed_hosts = [
        host.strip()
        for host in os.environ.get(
            "URLSAFE_ALLOWED_HOSTS",
            "localhost,127.0.0.1,testserver",
        ).split(",")
        if host.strip()
    ]
    limiter = Limiter(key_func=get_remote_address, storage_uri="memory://")

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        initialize_database(db_path)
        import_domains(db_path, DEMO_DOMAINS_PATH, ignore_existing=True)
        import_brand_domains(db_path, BRAND_DOMAINS_PATH, ignore_existing=True)
        yield

    application = FastAPI(
        title="url_safe",
        description="Analyse locale de liens sans les ouvrir.",
        lifespan=lifespan,
        docs_url=None if production else "/docs",
        redoc_url=None if production else "/redoc",
        openapi_url=None if production else "/openapi.json",
    )
    application.add_middleware(TrustedHostMiddleware, allowed_hosts=allowed_hosts)
    application.add_middleware(RequestBodyLimitMiddleware, max_body_size=4096)
    application.state.limiter = limiter
    application.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    application.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

    @application.middleware("http")
    async def add_security_headers(request: Request, call_next) -> Response:
        response = await call_next(request)
        if request.url.path == "/api/check":
            response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'none'; object-src 'none'; "
            "frame-ancestors 'none'; form-action 'self'; "
            "connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), geolocation=(), microphone=()"
        return response

    @application.get("/", include_in_schema=False)
    def home() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @application.get("/confidentialite", include_in_schema=False)
    def privacy_policy() -> FileResponse:
        return FileResponse(STATIC_DIR / "confidentialite.html")

    @application.get("/extension", include_in_schema=False)
    def extension_page() -> FileResponse:
        return FileResponse(STATIC_DIR / "extension.html")

    @application.post("/api/check", response_model=CheckResult)
    @limiter.limit(os.environ.get("URLSAFE_RATE_LIMIT", "30/minute"))
    def check_link(request: Request, payload: CheckRequest) -> CheckResult:
        try:
            analysis = analyze_url(payload.url)
        except UrlInputError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

        record = lookup_domain(db_path, str(analysis["canonical_hostname"]))
        popularity = lookup_popular_domain(db_path, str(analysis["canonical_hostname"]))
        brand_match = find_brand_match(
            str(analysis["canonical_hostname"]),
            list_brand_domains(db_path),
        )
        reasons = list(analysis.pop("reasons"))
        analysis.pop("submitted_url", None)
        analysis.pop("normalized_url", None)

        verdict = build_verdict(
            reasons=reasons,
            record=record,
            brand_match=brand_match,
        )

        return CheckResult(
            **analysis,
            classification=verdict.classification,
            title=verdict.title,
            explanation=verdict.explanation,
            reasons=verdict.reasons,
            source=verdict.source,
            matched_brand=verdict.matched_brand,
            official_domain=verdict.official_domain,
            popular_rank=int(popularity["rank"]) if popularity else None,
            tranco_list_id=str(popularity["list_id"]) if popularity else None,
            tranco_downloaded_at=str(popularity["downloaded_at"]) if popularity else None,
        )

    return application


app = create_app()