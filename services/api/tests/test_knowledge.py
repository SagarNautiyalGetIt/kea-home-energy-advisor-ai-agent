"""The help corpus, and the two properties that keep it from becoming a FAQ page.

Reference material is where a model's own training fills gaps fluently and plausibly, about
a company whose policies it has never seen. "Kea gives you 14 days to pay" would cost a
customer money and pass every other check in this repository, because it contains no figure
derived from meter data. So the tests here are about the fencing rather than the content.
"""

from __future__ import annotations

import pytest

from app.agent.tools import dispatch
from app.knowledge import ARTICLES, TOPICS, Basis, search
from app.pipeline import build_context


@pytest.fixture
async def ctx():
    return await build_context("H-JUL")


# ---------- the two structural rules ----------


def test_no_article_carries_prose() -> None:
    """There is no stored answer anywhere in the corpus, and there must not be.

    An assistant that pastes a paragraph per topic is the twenty-six-intent router rebuilt
    in a new place, with the same symptom: one canned response regardless of what was
    actually asked. `Article` therefore has `facts` and no `answer`, and this is the test
    that keeps somebody from adding one.
    """
    from dataclasses import fields

    names = {f.name for f in fields(ARTICLES[0])}
    assert "answer" not in names
    assert "response" not in names
    assert "reply" not in names


def test_every_fact_says_what_kind_of_claim_it_is() -> None:
    """`Basis` is per fact, not per article, because a single answer mixes them — "a
    retailer must give notice, and Kea's own period is X" is one regulated fact and one
    company fact carrying very different weight."""
    for article in ARTICLES:
        assert article.facts, f"{article.id} has no facts"
        for fact in article.facts:
            assert isinstance(fact.basis, Basis), f"{article.id}: {fact.text[:40]}"
            # Anything that is not "how this system behaves" has to be checkable by the
            # customer somewhere other than here.
            if fact.basis in (Basis.REGULATION,):
                assert fact.source, f"{article.id}: a regulation fact with no source"


def test_illustrative_facts_are_fenced() -> None:
    """The category a model would otherwise invent, so it is the one that is explicitly
    attributed. Every `kea_illustrative` fact must arrive with instructions never to
    present it as Kea's actual policy."""
    guidance = Basis.KEA_ILLUSTRATIVE.how_to_say_it
    assert "NOT Kea's actual terms" in guidance
    assert "Never state it as Kea's policy" in guidance


def test_every_article_is_well_formed() -> None:
    ids = [a.id for a in ARTICLES]
    assert len(ids) == len(set(ids)), "duplicate article ids"

    for article in ARTICLES:
        assert article.topic in TOPICS, f"{article.id}: unknown topic {article.topic}"
        assert article.asks, f"{article.id} has no phrasings to match on"
        for other in article.see_also:
            assert other in ids, f"{article.id} points at missing article {other}"


# ---------- retrieval ----------


@pytest.mark.parametrize(
    ("question", "expected"),
    [
        ("why am I charged when the house was empty", "daily-fixed-charge"),
        ("I am moving house next week, what do I do", "moving-house"),
        ("can I get help paying my power bill", "payment-difficulty"),
        ("I think my meter is wrong", "meter-disputes"),
        ("stop texting me about my bill", "bill-shock-alerts"),
        ("which appliance is using the most power", "appliance-attribution"),
        ("how long does switching take", "switching-plans"),
        ("what do you do with my data", "privacy-and-data"),
        ("my power is out", "outages"),
        ("I need power for medical equipment", "medically-dependent"),
        ("what is an estimated read", "estimated-reads"),
        ("should I be on the low user plan", "low-user-vs-standard"),
    ],
)
def test_a_question_finds_its_article(question: str, expected: str) -> None:
    hits = search(question)
    assert hits, f"nothing found for {question!r}"
    assert expected in {h.article.id for h in hits}, (
        f"{question!r} found {[h.article.id for h in hits]}, wanted {expected}"
    )


def test_a_question_the_corpus_does_not_cover_returns_nothing() -> None:
    """The property that makes this safe: below the floor it returns nothing rather than
    the least-bad article. Answering from a near miss produces a confident answer built
    out of an article about something else, and the customer cannot tell."""
    assert search("what is the capital of France") == []
    assert search("can you write me a poem") == []


def test_two_questions_in_one_message_find_both_articles() -> None:
    """Handing the model only the best-scoring article guarantees half an answer — and
    guarantees the half the scoring happened to favour."""
    hits = {h.article.id for h in search("I'm moving house and I can't afford the final bill")}
    assert "moving-house" in hits
    assert "payment-difficulty" in hits


def test_a_bad_retrieval_can_be_diagnosed() -> None:
    """The reason this is a scored index rather than an embedding one: "the embedding was
    closer" is not something anybody can act on."""
    from app.knowledge.search import explain

    ranked = explain("why am I charged when the house was empty")
    assert ranked[0][0] == "daily-fixed-charge"
    assert ranked[0][2], "no terms reported for the top hit"


# ---------- the tool ----------


async def test_the_tool_returns_material_and_not_an_answer(ctx) -> None:
    result = await dispatch(
        ctx, "search_help_topics", {"question": "why am I charged when I was away"}
    )

    assert result["available"] is True
    article = result["articles"][0]
    assert article["facts"]
    assert "answer" not in article
    assert "not an answer to repeat" in result["guidance"]
    # Each fact arrives with how it may be attributed, so the model does not have to
    # remember which categories exist.
    assert all("how_to_say_it" in f for f in article["facts"])


async def test_the_tool_says_so_when_it_has_nothing(ctx) -> None:
    """And says what to do instead, which is the part that stops the model answering from
    general knowledge about power companies."""
    result = await dispatch(
        ctx, "search_help_topics", {"question": "what is the capital of France"}
    )

    assert result["available"] is False
    assert "general knowledge" in result["reason"]


async def test_an_unknown_topic_filter_is_corrected_not_ignored(ctx) -> None:
    result = await dispatch(
        ctx, "search_help_topics", {"question": "how do I pay", "topic": "invoices"}
    )
    assert "error" in result
    assert "payments" in result["valid_topics"]


async def test_the_limits_of_an_article_survive_into_the_result(ctx) -> None:
    """`this_does_not_answer` is usually the exact thing the customer is about to assume
    was said — an article about payment arrangements that does not say "this does not tell
    you whether YOU qualify" will be used to tell somebody they qualify."""
    result = await dispatch(
        ctx, "search_help_topics", {"question": "I can't pay my bill, what help is there"}
    )
    hardship = next(
        a for a in result["articles"] if a["id"] == "payment-difficulty"
    )
    assert "must NOT quote specific arrangement terms" in hardship["this_does_not_answer"]


async def test_an_article_that_names_a_tool_says_to_use_it(ctx) -> None:
    """Doing it is the answer; directions to a settings screen are not."""
    result = await dispatch(
        ctx, "search_help_topics", {"question": "how do I change my alert threshold"}
    )
    alerts = next(a for a in result["articles"] if a["id"] == "bill-shock-alerts")
    assert "update_alert_settings" in alerts["what_you_can_do_about_it"]


def test_the_corpus_covers_the_account_questions_the_meter_cannot() -> None:
    """A coverage floor rather than a count. Each of these is a question the assistant
    previously had no source for at all and answered by offering the team."""
    covered = {a.topic for a in ARTICLES}
    for topic in ("billing", "payments", "hardship", "plans", "meters", "moving", "privacy"):
        assert topic in covered, f"nothing in the corpus covers {topic}"
