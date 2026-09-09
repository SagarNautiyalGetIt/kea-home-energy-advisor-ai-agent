"""Finding the right help article, without a vector database.

Twenty-odd articles is not a retrieval problem, it is a matching problem, and the honest
implementations at this size are a scored token overlap or an embedding index. The overlap
wins here for reasons that are not laziness:

* It has **no dependency and no build step.** An embedding index means a model download, a
  cache to invalidate when the corpus changes, and a cold-start cost on a service whose
  whole latency budget is one agent turn.
* It is **inspectable.** When a question retrieves the wrong article, `explain()` says
  which terms matched and how much each was worth. "The embedding was closer" is not
  something anybody can act on.
* It **fails legibly.** Below `MIN_SCORE` it returns nothing rather than the least-bad
  article, so a question about something the corpus does not cover produces "I don't have
  anything on that" instead of a confident answer from an article about something else.
  That last property is worth more than the recall an embedding index would buy.

## Why `asks` carries most of the weight

Each article lists the ways a customer actually phrases the question. That is the field
doing the work: "why am I charged when I was away" and "what is the daily charge" are the
same article and share almost no vocabulary, and no amount of scoring over the article body
connects them. Writing the phrasings down is cheap, and it is the same trick the tool
descriptions use on the model — say what question this answers, not what it contains.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.knowledge.articles import ARTICLES, Article

#: Weight per matched token, by where it matched. An `asks` hit is worth far more than a
#: body hit because `asks` is a deliberate statement that this article answers that
#: question, while a body hit can be one incidental use of a common word.
WEIGHT_ASK = 3.0
WEIGHT_TITLE = 2.0
WEIGHT_BODY = 0.5
WEIGHT_TOPIC = 1.5

#: A whole `asks` phrase appearing in the question, not just its words. "how do I change my
#: plan" matching the phrasing exactly is a different quality of evidence from four of its
#: words appearing scattered through a sentence.
WEIGHT_PHRASE = 6.0

#: Below this, return nothing. Set by hand against the corpus: one common word in common
#: with an article is noise, and answering from a near-miss is worse than saying there is
#: nothing on it — the customer cannot tell the difference, which is the whole problem.
MIN_SCORE = 3.0

#: Words carrying no retrieval signal. Deliberately short: an aggressive stop list removes
#: "off" from "why does my hot water go off" and "out" from "my power is out", both of
#: which are load-bearing here.
_STOP = frozenset(
    (
        "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
        "for", "from", "get", "got", "had", "has", "have", "how", "i", "if", "in", "is",
        "it", "its", "me", "my", "of", "on", "or", "so", "that", "the", "their", "them",
        "there", "they", "this", "to", "was", "what", "when", "where", "which", "who",
        "why", "will", "with", "you", "your",
    )
)

_TOKEN = re.compile(r"[a-z0-9']+")


def _tokens(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOP and len(t) > 1]


@dataclass(frozen=True)
class Hit:
    article: Article
    score: float
    matched: list[str]
    """Which terms earned the score. Returned so a wrong retrieval can be diagnosed from
    the result rather than by re-running the query with a debugger."""


def _body_text(article: Article) -> str:
    return " ".join(
        [article.title, article.not_covered, *(f.text for f in article.facts)]
    )


def search(query: str, *, topic: str | None = None, limit: int = 3) -> list[Hit]:
    """Rank the corpus against one customer question.

    `limit` defaults to three rather than one. A customer asking "I'm moving and I can't
    afford the final bill" is asking two questions, and handing the model only the
    best-scoring article guarantees half an answer — worse, it guarantees the half the
    scoring happened to favour, which on that sentence would be the moving one.
    """
    terms = _tokens(query)
    if not terms:
        return []

    lowered = query.lower()
    hits: list[Hit] = []

    for article in ARTICLES:
        if topic and article.topic != topic:
            continue

        score = 0.0
        matched: list[str] = []

        for phrase in article.asks:
            if phrase in lowered:
                score += WEIGHT_PHRASE
                matched.append(f'"{phrase}"')

        ask_terms = set(_tokens(" ".join(article.asks)))
        title_terms = set(_tokens(article.title))
        body_terms = set(_tokens(_body_text(article)))
        topic_terms = set(_tokens(article.topic))

        for term in set(terms):
            if term in ask_terms:
                score += WEIGHT_ASK
                matched.append(term)
            elif term in title_terms:
                score += WEIGHT_TITLE
                matched.append(term)
            elif term in topic_terms:
                score += WEIGHT_TOPIC
                matched.append(term)
            elif term in body_terms:
                score += WEIGHT_BODY
                matched.append(term)

        if score >= MIN_SCORE:
            hits.append(Hit(article=article, score=round(score, 2), matched=matched))

    hits.sort(key=lambda h: (-h.score, h.article.id))
    return hits[:limit]


def explain(query: str) -> list[tuple[str, float, list[str]]]:
    """Every article's score for a query, ranked. For diagnosing a bad retrieval.

    Not reachable from the API. It exists so "why did that question find the outages
    article" is a question with an answer, which is the property a scored index has and an
    embedding index does not.
    """
    return [
        (h.article.id, h.score, h.matched) for h in search(query, limit=len(ARTICLES))
    ]
