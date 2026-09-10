"""Normal heating demand, by region and month.

## The constant this replaces

`fixtures.NORMAL_HDD_PER_DAY = 8.1` is a typical **July day in Auckland**. It was the
right shape for a demo where all five households sit in one city in one month — and
`MartRepository.context()` handed it to *every* account regardless of where the meter is
or what month the data covers.

That is invisible on the demo cohort and wrong the moment a real account is added.
"Colder than normal" is the comparison the entire weather attribution rests on, so a
Dunedin household in January was being measured against an Auckland July: it would read
as dramatically warmer than normal every time, and the weather driver would absorb
dollars that belong somewhere else. Every figure downstream would still be arithmetically
correct and still be about the wrong place.

`mart_account_context.climate_region` exists precisely so this join can be made. This
module is the lookup it feeds.

## Where these numbers come from, and what they are not

Degree-day normals derived from NIWA 1991–2020 climate normals for the main centres, at
the New Zealand 18 °C base. They are **approximate and illustrative** — good enough to
stop a Dunedin winter being scored against an Auckland one, not good enough to publish.

⚠️ KEA-42 (real NIWA observations) is still open. Until it lands, anything derived from
these is illustrative in exactly the way the tariff rate is, and must be labelled that
way on any surface that shows it. Do not put a figure derived from this table on a slide
as measured.

The fallback is deliberately the national middle rather than Auckland: an unknown region
scored against the largest city would be silently wrong in one direction, whereas the
middle is honestly uncertain in both.
"""

from __future__ import annotations

#: Mean heating degree days per day, base 18 °C, by month (1-12).
#:
#: Read down a column to see the thing that matters: Auckland's July is 8.1 and
#: Dunedin's is 12.4. Scoring the second against the first is a 50% error in the input
#: to the weather regression.
_NORMALS: dict[str, tuple[float, ...]] = {
    #                 Jan  Feb  Mar  Apr  May  Jun  Jul  Aug  Sep  Oct  Nov  Dec
    "northland":     (1.2, 1.1, 1.8, 3.4, 5.2, 6.8, 7.4, 6.9, 5.6, 4.2, 2.8, 1.7),
    "auckland":      (1.5, 1.4, 2.2, 4.0, 6.0, 7.7, 8.1, 7.6, 6.3, 4.8, 3.2, 2.0),
    "waikato":       (2.0, 2.0, 3.1, 5.2, 7.5, 9.3, 9.8, 9.1, 7.5, 5.8, 4.0, 2.6),
    "bay of plenty": (1.8, 1.7, 2.7, 4.7, 6.9, 8.6, 9.1, 8.5, 7.0, 5.4, 3.7, 2.4),
    "taranaki":      (2.2, 2.1, 3.0, 4.9, 7.0, 8.7, 9.2, 8.7, 7.3, 5.7, 4.1, 2.8),
    "hawkes bay":    (2.1, 2.0, 3.0, 5.1, 7.4, 9.2, 9.7, 9.0, 7.4, 5.7, 3.9, 2.6),
    "manawatu":      (2.4, 2.3, 3.3, 5.4, 7.7, 9.4, 9.9, 9.3, 7.8, 6.1, 4.4, 3.0),
    "wellington":    (2.3, 2.2, 3.1, 5.0, 7.2, 8.9, 9.4, 8.9, 7.5, 6.0, 4.3, 2.9),
    "nelson":        (2.0, 2.0, 3.2, 5.6, 8.2, 10.2, 10.8, 9.8, 7.9, 6.0, 4.1, 2.6),
    "canterbury":    (2.6, 2.7, 4.2, 6.8, 9.6, 11.6, 12.1, 11.0, 8.9, 6.9, 4.8, 3.2),
    "otago":         (3.0, 3.0, 4.5, 7.1, 9.9, 11.9, 12.4, 11.3, 9.2, 7.2, 5.2, 3.6),
    "southland":     (3.4, 3.4, 4.9, 7.4, 10.1, 12.0, 12.5, 11.5, 9.5, 7.6, 5.6, 4.0),
}

#: Aliases for the spellings that turn up in source data. `mart_account_context` copies
#: `climate_region` through from the property record, which is free text upstream.
_ALIASES: dict[str, str] = {
    "aukland": "auckland",
    "tamaki makaurau": "auckland",
    "christchurch": "canterbury",
    "otautahi": "canterbury",
    "dunedin": "otago",
    "otepoti": "otago",
    "invercargill": "southland",
    "te whanganui-a-tara": "wellington",
    "hawke's bay": "hawkes bay",
    "manawatu-whanganui": "manawatu",
    "whanganui": "manawatu",
    "tasman": "nelson",
    "marlborough": "nelson",
    "west coast": "canterbury",
    "gisborne": "hawkes bay",
    "waikato region": "waikato",
}

#: The national middle, for an account whose region we do not recognise. Deliberately not
#: Auckland — see the module docstring.
_FALLBACK = (2.2, 2.2, 3.3, 5.4, 7.7, 9.5, 10.0, 9.3, 7.7, 6.0, 4.2, 2.8)


#: The base these normals are measured at, and therefore the base every observation
#: compared against them must be measured at.
#:
#: The warehouse uses 16 (`hdd_base_c` in dbt_project.yml, applied in
#: `fct_weather_daily.sql`). That is not a disagreement to resolve — both are legitimate
#: conventions, and the warehouse is entitled to its own. It is only a disagreement if a
#: number crosses between them, which is exactly what `mart_daily_usage.heating_degree_days`
#: did until KEA-147: base-16 observations scored against these base-18 normals, so every
#: winter month read as warmer than typical and the weather driver clamped to zero.
#:
#: Anything compared against `normal_hdd_per_day()` must come from
#: `heating_degree_day()` below, never from the warehouse column.
HDD_BASE_C = 18.0


def heating_degree_day(temp_mean_c: float | None) -> float:
    """One day's heating demand, from its mean temperature, at `HDD_BASE_C`.

    Takes a temperature rather than a degree day on purpose: a temperature carries no
    base, so a caller cannot accidentally hand this function a number measured against a
    different threshold. That mistake is silent — it produces a plausible figure that is
    wrong in one direction — and it is the one KEA-147 fixed.

    `None` is zero, matching the zero-fill in `MartRepository`: a day with no weather
    join is a day that cannot explain a rise, not a day that does not exist.
    """
    if temp_mean_c is None:
        return 0.0
    return round(max(HDD_BASE_C - float(temp_mean_c), 0.0), 2)


def normal_hdd_per_day(region: str | None, month: int) -> float:
    """Typical heating degree days for one day in `region` during `month` (1-12).

    Unknown regions and out-of-range months both fall back rather than raising: this sits
    on the request path for every weather attribution, and an account with a misspelled
    region should get a hedged answer, not a 500.
    """
    if not 1 <= month <= 12:
        return _FALLBACK[6]  # July, the middle of the NZ heating season
    key = (region or "").strip().lower()
    key = _ALIASES.get(key, key)
    return _NORMALS.get(key, _FALLBACK)[month - 1]


def is_known_region(region: str | None) -> bool:
    """Whether the lookup was a real match or the fallback.

    Callers use this to decide whether to hedge. An attribution built on the national
    middle is a weaker claim than one built on the household's own region, and the
    difference should reach the customer rather than being smoothed over.
    """
    key = (region or "").strip().lower()
    return _ALIASES.get(key, key) in _NORMALS
