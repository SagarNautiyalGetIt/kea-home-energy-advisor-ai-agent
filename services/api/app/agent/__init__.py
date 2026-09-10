"""The agent: one model, a set of tools over the customer's own data, and a loop.

This package replaces the four-layer narrate-only pipeline (ADR-0002 / ADR-0011). The
model now reads the question, decides what it needs to know, fetches it, and writes the
answer. Python's job is to *serve* data, correctly and scoped to the signed-in customer —
not to decide in advance what the answer will be.

    prompts.py   who Sparky is and what it may not claim
    tools.py     the catalogue, and the dispatcher that runs one
    loop.py      question -> (tool calls)* -> answer

See `docs/adr/0011-agentic-tool-use.md` for why this replaced the pipeline.
"""

from app.agent.loop import AgentResult, AgentUnavailable, ToolInvocation, answer_once, run_agent
from app.agent.tools import TOOL_SCHEMAS, ToolContext, dispatch

__all__ = [
    "TOOL_SCHEMAS",
    "AgentResult",
    "AgentUnavailable",
    "ToolContext",
    "ToolInvocation",
    "answer_once",
    "dispatch",
    "run_agent",
]
