"""A reachable Ollama daemon is not proof that Sparky can answer safely."""

import asyncio

import httpx
import pytest

from app.providers.ollama import OllamaProvider


@pytest.mark.parametrize(
    ("selected", "installed", "expected"),
    [
        ("qwen3:4b", ["qwen3:4b"], True),
        ("qwen3:4b", ["qwen3:8b"], False),
        ("gemma3:4b", ["gemma3:4b"], False),
    ],
)
def test_readiness_requires_installed_tool_model(
    selected: str, installed: list[str], expected: bool
) -> None:
    async def check() -> None:
        def respond(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"models": [{"name": name} for name in installed]})

        provider = OllamaProvider(model=selected)
        provider._client = httpx.AsyncClient(transport=httpx.MockTransport(respond))
        try:
            assert await provider.health() is expected
        finally:
            await provider.aclose()

    asyncio.run(check())
