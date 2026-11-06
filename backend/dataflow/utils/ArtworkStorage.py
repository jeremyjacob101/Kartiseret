"""Deterministic, bounded TMDB artwork uploads to an S3-compatible bucket.

This module is intentionally independent of publication: callers must publish a
returned URL only after all uploads succeed. Unreferenced uploads are harmless.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from io import BytesIO
import json
import os
import re
from urllib.parse import quote, urlsplit



MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 20_000_000
PROCESSING_VERSION = "v1"
VARIANTS = {"poster": (185, 342, 780), "backdrop": (780, 1280)}
_PATH = re.compile(r"^/[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|webp)$", re.IGNORECASE)


@dataclass(frozen=True)
class ArtworkResult:
    source_path: str
    url: str
    variants: tuple[tuple[int, str], ...]


class ArtworkStorage:
    def __init__(self, client, bucket: str, image_origin: str, *, session=None):
        if not bucket:
            raise ValueError("Artwork bucket is required")
        parsed = urlsplit(image_origin)
        local_http = parsed.scheme == "http" and parsed.hostname in {
            "localhost",
            "127.0.0.1",
            "::1",
        }
        if (
            (parsed.scheme != "https" and not local_http)
            or not parsed.netloc
            or parsed.path
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
        ):
            raise ValueError("R2 image origin must be an HTTP(S) origin")
        self.client = client
        self.bucket = bucket
        self.image_origin = image_origin.rstrip("/")
        if session is None:
            import requests
            session = requests.Session()
        self.session = session

    @classmethod
    def from_environment(cls):
        """Return None when R2 is not configured, preserving legacy operation."""
        account_id = os.environ.get("R2_ACCOUNT_ID", "").strip()
        bucket = os.environ.get("R2_BUCKET", "").strip()
        image_origin = os.environ.get("R2_IMAGE_ORIGIN", "").strip()
        access_key = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
        secret_key = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
        if not any((account_id, bucket, image_origin, access_key, secret_key)):
            return None
        if not all((account_id, bucket, image_origin, access_key, secret_key)):
            raise ValueError("R2 configuration must set all five R2 variables")
        if not re.fullmatch(r"[a-fA-F0-9]{32}", account_id):
            raise ValueError("R2_ACCOUNT_ID must be a 32-character hexadecimal ID")
        if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])", bucket):
            raise ValueError("R2_BUCKET must be a 3-63 character bucket name")
        from backend.utils.log.r2_client import create_r2_s3_client
        client = create_r2_s3_client(access_key=access_key, secret_key=secret_key)
        return cls(client, bucket, image_origin)

    @classmethod
    def for_flow(cls, flow):
        storage = getattr(flow, "_artwork_storage", None)
        if storage is False:
            return None
        if storage is None:
            storage = cls.from_environment()
            flow._artwork_storage = storage if storage else False
        return storage

    def image_url(self, kind: str, source_path: str, width: int) -> str:
        if width not in VARIANTS.get(kind, ()):
            raise ValueError("Unsupported artwork variant")
        digest = sha256(source_path.encode("utf-8")).hexdigest()
        return f"{self.image_origin}/api/images/{PROCESSING_VERSION}/{kind}/{digest}/{width}.webp"

    def store(self, kind: str, source_path: str) -> ArtworkResult:
        if kind not in VARIANTS or not isinstance(source_path, str) or not _PATH.fullmatch(source_path):
            raise ValueError("Invalid TMDB artwork source")
        digest = sha256(source_path.encode("utf-8")).hexdigest()
        prefix = f"artwork/{PROCESSING_VERSION}/{kind}/{digest}"
        widths = VARIANTS[kind]
        urls = tuple((width, self.image_url(kind, source_path, width)) for width in widths)
        # A manifest is uploaded last; its existence proves the full set was uploaded.
        manifest = f"{prefix}/complete"
        try:
            self.client.head_object(Bucket=self.bucket, Key=manifest)
            primary_width = 342 if kind == "poster" else 1280
            return ArtworkResult(source_path, dict(urls)[primary_width], urls)
        except Exception as error:
            response = getattr(error, "response", {})
            code = str(response.get("Error", {}).get("Code", ""))
            if code not in {"404", "NoSuchKey", "NotFound"}:
                raise

        response = self.session.get(
            "https://image.tmdb.org/t/p/" + ("w780" if kind == "poster" else "w1280") + quote(source_path, safe="/"),
            timeout=(5, 30), stream=True, allow_redirects=False,
        )
        try:
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Unexpected TMDB image response")
            chunks, size = [], 0
            for chunk in response.iter_content(64 * 1024):
                size += len(chunk)
                if size > MAX_DOWNLOAD_BYTES:
                    raise ValueError("TMDB artwork exceeds download limit")
                chunks.append(chunk)
            payload = b"".join(chunks)
        finally:
            response.close()

        # Lazy import keeps the legacy pipeline usable without optional dependencies.
        from PIL import Image, ImageOps
        with Image.open(BytesIO(payload)) as source:
            if source.width * source.height > MAX_PIXELS:
                raise ValueError("TMDB artwork exceeds pixel limit")
            source.load()
            oriented = ImageOps.exif_transpose(source)
            image = oriented.convert("RGBA" if "A" in oriented.getbands() else "RGB")
            for width in widths:
                variant = image.copy()
                variant.thumbnail((width, MAX_PIXELS), Image.Resampling.LANCZOS)
                output = BytesIO()
                variant.save(output, format="WEBP", quality=82, method=4)
                self.client.put_object(Bucket=self.bucket, Key=f"{prefix}/{width}.webp", Body=output.getvalue(), ContentType="image/webp", CacheControl="public, max-age=31536000, immutable")
        self.client.put_object(
            Bucket=self.bucket,
            Key=manifest,
            Body=json.dumps({"source_path": source_path, "widths": widths}).encode(),
            ContentType="application/json",
            CacheControl="no-store",
        )
        primary_width = 342 if kind == "poster" else 1280
        return ArtworkResult(source_path, dict(urls)[primary_width], urls)

    @staticmethod
    def record_metadata(row, kind: str, result: ArtworkResult):
        provider_freshness = row.get("provider_freshness")
        if not isinstance(provider_freshness, dict):
            provider_freshness = {}
        artwork = provider_freshness.get("artwork")
        if not isinstance(artwork, dict):
            artwork = {}
        artwork[kind] = {
            "processing_version": PROCESSING_VERSION,
            "source_path": result.source_path,
            "published_url": result.url,
            "variants": [
                {"width": width, "url": url}
                for width, url in result.variants
            ],
        }
        provider_freshness["artwork"] = artwork
        row["provider_freshness"] = provider_freshness

    def resolve_row(self, flow, row, data):
        """Upload changed catalog images independently, retaining each last good URL."""
        for source_field, kind, target_field in (
            ("poster_path", "poster", "en_poster"),
            ("backdrop_path", "backdrop", "backdrop"),
        ):
            source_path = data.get(source_field) if isinstance(data, dict) else None
            if not source_path:
                continue
            try:
                result = self.store(kind, source_path)
                row[target_field] = result.url
                self.record_metadata(row, kind, result)
            except Exception as error:
                from backend.utils.log.r2_budget import R2BudgetError, R2BudgetExceeded

                if isinstance(error, (R2BudgetError, R2BudgetExceeded)):
                    raise
                if getattr(flow, "summaryEnabled", False):
                    flow.trace_event("artwork", "failed", type(error).__name__, key=row.get("tmdb_id"), payload={"kind": kind})
        return row


def resolve_tmdb_artwork(flow, row, data):
    """Apply local artwork URLs when configured, otherwise retain TMDB URLs."""
    poster_path = data.get("poster_path") if isinstance(data, dict) else None
    backdrop_path = data.get("backdrop_path") if isinstance(data, dict) else None
    storage = ArtworkStorage.for_flow(flow)
    if storage:
        return storage.resolve_row(flow, row, data)
    if poster_path:
        current = row.get("en_poster")
        if not isinstance(current, str) or not re.search(r"/api/images/v1/poster/[a-f0-9]{64}/\d+\.webp$", urlsplit(current).path):
            row["en_poster"] = f"https://image.tmdb.org/t/p/w342{poster_path}"
    if backdrop_path:
        current = row.get("backdrop")
        if not isinstance(current, str) or not re.search(r"/api/images/v1/backdrop/[a-f0-9]{64}/\d+\.webp$", urlsplit(current).path):
            row["backdrop"] = f"https://image.tmdb.org/t/p/w1280{backdrop_path}"
    return row
