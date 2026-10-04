# Usage charts and time-band provenance

The signed-in fixture API supplies July daily household totals and an explicitly
illustrative half-hour profile for demo charts. The profile is shared with the
database seeder and preserves each daily total exactly. Its hourly readings and
peak/off-peak/night sums are labelled `demo`; they are invented intraday behaviour,
including for H-JUL whose daily totals came from the published Genesis chart.
The demo windows are 07:00–11:00 and 17:00–21:00 peak, 23:00–07:00 night, and the
remaining hours off-peak. These windows are an illustrative schedule, not a
customer's effective tariff. Estimated costs use the demo's blended unit rate.

This fixture profile is enabled only for the fixture repository. A production
account with missing intervals is never given this profile. Missing values remain
unavailable; a measured zero still displays zero. Dates outside the stored fixture
period remain unavailable rather than being filled with another day's shape.

The household-authorized `GET /api/households/{customer_id}/usage-series`
contract supplies `daily_peak_kwh`, `daily_off_peak_kwh`, `daily_night_kwh`,
`daily_quality` and `band_data_source`. A band is shown only when every supplied
reading in the selected date range is measured and non-null. Explicit demo bands
additionally require `band_data_source=demo`, `date_source=demo` and demo quality
on every selected date. Estimated or missing measured band readings are not
replaced with percentages of the daily total.

For the data team: provide dated, household-mapped meter imports and populate
the daily usage mart's measured tariff bands. The existing `off_peak_kwh` mart
column represents night; the API maps it to night and derives off-peak from
import minus peak minus night. Confirm this schema meaning before ingestion.
Actual tariff time windows must come from the customer's effective dated plan;
this endpoint does not supply windows, so mobile cannot label them reliably.

Day uses the dated hourly endpoint as a chart with 23, 24 or 25 actual NZ hourly
slots. Missing hours break the curve and area fill, while available hours remain
visible; no row list is shown by default. Tooltips identify each hour and its
quality. Week keeps all seven calendar-day slots. Month keeps four calendar-month
slots and labels partial coverage in its tooltips; the headline and time bands
cover only the selected month. Missing dates/months are chart gaps, never zeroes.
Comparison overlays require complete matching calendar coverage, so absent
readings cannot shift a line to another weekday or month. Individual comparison
bars remain visible when the corresponding current hour is missing. Day comparisons
with different 23/24/25-hour lengths are withheld with an explicit NZ daylight-saving
explanation, rather than aligning different hourly positions. Daily totals cannot
reconstruct observed hourly behaviour; the fixture chart is explicitly illustrative.

Validation: API tests reconcile demo hourly readings, daily totals and band sums;
preserve measured/estimated/missing production boundaries; check household token
scope and dates outside fixture coverage; and cover DST and zero/tiny totals.
Mobile tests cover gaps, comparison alignment, selected-month headlines and demo
provenance. These checks do not establish real meter availability or phone rendering.
