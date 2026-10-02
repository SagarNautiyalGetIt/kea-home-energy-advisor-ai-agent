# Missing Usage time bands

The signed-in demo API supplies daily household totals, not measured peak,
off-peak or night readings. The mobile app now explains this beside each missing
band. Missing values remain unavailable; a measured zero still displays zero.

The household-authorized `GET /api/households/{customer_id}/usage-series`
contract supplies `daily_peak_kwh`, `daily_off_peak_kwh`, `daily_night_kwh`,
`daily_quality` and `band_data_source`. A band is shown only when every supplied
reading in the selected date range is measured and non-null. Estimated or missing
band readings are not replaced with percentages of the daily total.

For the data team: provide dated, household-mapped meter imports and populate
the daily usage mart's measured tariff bands. The existing `off_peak_kwh` mart
column represents night; the API maps it to night and derives off-peak from
import minus peak minus night. Confirm this schema meaning before ingestion.
Actual tariff time windows must come from the customer's effective dated plan;
this endpoint does not supply windows, so mobile cannot label them reliably.

Hourly Day Usage is separate: it needs dated import intervals from the hourly
endpoint, including NZ timezone/DST coverage. Daily totals cannot reconstruct
the 23, 24 or 25 hourly readings. Local preview fixtures remain explicitly demo.
