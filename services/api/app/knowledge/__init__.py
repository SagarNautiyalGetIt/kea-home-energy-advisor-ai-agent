"""Reference material for the questions that are not about a meter reading.

"When is my bill due" is answered from the account. "Why am I charged when the house was
empty" is not — it is answered from how electricity retail works in New Zealand, and until
now the assistant had no source for that at all. It either guessed from whatever its
training holds about power companies, or it fell back to offering the team, which is the
sentence this whole rewrite was about removing.

    articles.py   the corpus: facts, each labelled with what kind of claim it is
    search.py     scored token overlap, returns nothing rather than a near miss

## The rule that makes this safe to have

**There is no stored answer anywhere in this package.** `Article` has `facts` and no
`answer` field. The tool hands the model the material plus the customer's actual question
and the model writes the reply, so "how does switching work" and "will switching cut my
power off for a day" produce different answers from the same article — which is the entire
difference between this and the FAQ page.

The second rule is `Basis`. Every fact says whether it is New Zealand regulation, how the
market works, how this system behaves, or a plausible retailer policy standing in for one
we do not have. The last of those is the category a model would otherwise invent, so it is
the one that is fenced: the guidance forces it to be attributed as an example, never as
Kea's terms.
"""

from app.knowledge.articles import ARTICLES, BY_ID, TOPICS, Article, Basis, Fact
from app.knowledge.search import Hit, search

__all__ = [
    "ARTICLES",
    "BY_ID",
    "TOPICS",
    "Article",
    "Basis",
    "Fact",
    "Hit",
    "search",
]
