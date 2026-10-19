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
        title="Lien clair",
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

        if record and record["status"] == "malicious":
            classification = "suspicious"
            title = "Domaine signalé"
            explanation = "Une source de référence locale signale ce domaine. N’ouvre pas ce lien."
            reasons.append(f"Signalé par : {record['source']}.")
        elif brand_match and brand_match["match_type"] in {
            "lookalike",
            "nested_brand_domain",
            "unicode_lookalike",
        }:
            classification = "impersonation"
            title = f"Ressemble à {brand_match['brand_name']}"
            official_domain = str(brand_match["official_hostname"])
            if brand_match["match_type"] == "nested_brand_domain":
                explanation = (
                    f"Le domaine officiel {official_domain} apparaît dans une partie secondaire de l’adresse. "
                    "Cela ne signifie pas que le site appartient à cette marque."
                )
                reasons.append("Un domaine officiel est utilisé comme sous-domaine d’un autre site.")
            elif brand_match["match_type"] == "unicode_lookalike":
                explanation = (
                    f"Des caractères du domaine sont confondables avec ceux de {official_domain} selon les données Unicode. "
                    "Cela indique une imitation possible, pas une fraude confirmée."
                )
                reasons.append(f"Caractères Unicode confondables avec le domaine officiel {official_domain}.")
            else:
                explanation = (
                    f"Le nom de domaine diffère d’un caractère de {official_domain}. "
                    "Cela peut être une imitation, mais ce signal ne prouve pas une fraude."
                )
                reasons.append(f"Ressemblance avec le domaine officiel {official_domain}.")
        elif reasons:
            classification = "suspicious"
            title = "À examiner"
            explanation = "Des éléments inhabituels ont été repérés. Cela ne prouve pas à lui seul que le lien est malveillant."
        elif brand_match and brand_match["match_type"] == "official":
            classification = "known"
            title = f"Domaine répertorié pour {brand_match['brand_name']}"
            explanation = "Le domaine correspond au registre local de la marque; cela ne garantit pas que chaque page soit sûre."
        elif record and record["status"] == "known":
            classification = "known"
            title = "Domaine répertorié"
            explanation = "Ce domaine est dans la liste locale, ce qui ne garantit pas que cette page ou ce lien soit sûr."
        else:
            classification = "unknown"
            title = "Aucun signal local"
            explanation = "Aucune correspondance dans la base locale. Ce résultat ne certifie pas la sécurité du lien."

        return CheckResult(
            **analysis,
            classification=classification,
            title=title,
            explanation=explanation,
            reasons=reasons,
            source=(
                record["source"]
                if record
                else str(brand_match["source"])
                if brand_match
                else None
            ),
            matched_brand=str(brand_match["brand_name"]) if brand_match else None,
            official_domain=str(brand_match["official_hostname"]) if brand_match else None,
            popular_rank=int(popularity["rank"]) if popularity else None,
            tranco_list_id=str(popularity["list_id"]) if popularity else None,
            tranco_downloaded_at=str(popularity["downloaded_at"]) if popularity else None,
        )

    return application


app = create_app()