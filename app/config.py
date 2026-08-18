"""Runtime configuration. Environment-driven so the provider swaps without a code change."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    provider: str = os.getenv("KEA_PROVIDER", "ollama")
    ollama_model: str = os.getenv("KEA_OLLAMA_MODEL", "gemma3:4b")
    ollama_url: str = os.getenv("KEA_OLLAMA_URL", "http://localhost:11434")

    # Sprint 3 — unused until BedrockProvider is implemented.
    bedrock_model: str = os.getenv("KEA_BEDROCK_MODEL", "anthropic.claude-sonnet-5")
    aws_region: str = os.getenv("AWS_REGION", "ap-southeast-2")

    cors_origins: str = os.getenv("KEA_CORS_ORIGINS", "http://localhost:5173")

    # ADR-0006. asyncpg driver; the same URL shape points at RDS in Sprint 3.
    database_url: str = os.getenv(
        "KEA_DATABASE_URL", "postgresql+asyncpg://kea:kea@localhost:5432/kea"
    )

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()


def get_provider():
    """The only place a concrete provider is constructed."""
    if settings.provider == "bedrock":
        from app.providers.bedrock import BedrockProvider

        return BedrockProvider(model=settings.bedrock_model, aws_region=settings.aws_region)

    from app.providers.ollama import OllamaProvider

    return OllamaProvider(model=settings.ollama_model, base_url=settings.ollama_url)
