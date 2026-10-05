/** Synthetic fixtures for the Power Clash preview. Nothing here is customer or meter data. */
export const demoDistricts = [
  { id: 'grey-lynn', name: 'Grey Lynn', latitude: -36.858, longitude: 174.733 },
  { id: 'ponsonby', name: 'Ponsonby', latitude: -36.848, longitude: 174.746 },
  { id: 'mount-eden', name: 'Mount Eden', latitude: -36.878, longitude: 174.765 },
] as const;

export type DemoDistrictId = (typeof demoDistricts)[number]['id'];
export type MetricKey = 'conservation' | 'ev' | 'offPeak' | 'solar';
export type DemoMetrics = {
  conservedKwh: number;
  reductionPercent: number;
  evAvoidedKg: number;
  offPeakSavingsNzd: number;
  solarAvoidedKg: number;
};
type DemoPlayer = { id: string; label: string; metrics: DemoMetrics };

/** Preview-only weights and caps. A real programme requires a reviewed fairness and emissions method. */
export const demoScoring = {
  conservation: { weight: 35, cap: 25 }, // percent reduction vs own weather-adjusted baseline
  ev: { weight: 20, cap: 50 }, // illustrative kg CO2e avoided
  offPeak: { weight: 25, cap: 40 }, // illustrative NZD saved against an eligible tariff
  solar: { weight: 20, cap: 50 }, // illustrative kg CO2e avoided
} as const;

export const metricDetails: Record<MetricKey, { label: string; method: string }> = {
  conservation: { label: 'Energy conserved', method: 'Demo points use percentage reduction against your own baseline. Measured kWh is shown for context; production baselines need weather and meter review.' },
  ev: { label: 'EV charging', method: 'Illustrative avoided emissions from eligible EV charging. Real points need charger attribution, a defensible travel comparator, and a reviewed grid factor.' },
  offPeak: { label: 'Off-peak savings', method: 'Illustrative NZD saved by shifting eligible energy use. Real savings require your actual tariff and complete interval readings.' },
  solar: { label: 'Solar generation', method: 'Illustrative avoided emissions from verified solar generation. Real points need generation and export evidence and a reviewed emissions method.' },
};

const samples: Record<DemoDistrictId, readonly DemoPlayer[]> = {
  'grey-lynn': [
    { id: 'kea-07', label: 'Kea 07', metrics: { conservedKwh: 93, reductionPercent: 23, evAvoidedKg: 43, offPeakSavingsNzd: 35, solarAvoidedKg: 39 } },
    { id: 'kea-12', label: 'Kea 12', metrics: { conservedKwh: 86, reductionPercent: 21, evAvoidedKg: 30, offPeakSavingsNzd: 33, solarAvoidedKg: 46 } },
    { id: 'kea-21', label: 'Kea 21', metrics: { conservedKwh: 71, reductionPercent: 18, evAvoidedKg: 35, offPeakSavingsNzd: 27, solarAvoidedKg: 30 } },
    { id: 'you', label: 'You · demo', metrics: { conservedKwh: 58, reductionPercent: 16, evAvoidedKg: 22, offPeakSavingsNzd: 24, solarAvoidedKg: 18 } },
    { id: 'kea-34', label: 'Kea 34', metrics: { conservedKwh: 40, reductionPercent: 12, evAvoidedKg: 10, offPeakSavingsNzd: 18, solarAvoidedKg: 13 } },
  ],
  ponsonby: [
    { id: 'kea-03', label: 'Kea 03', metrics: { conservedKwh: 89, reductionPercent: 22, evAvoidedKg: 39, offPeakSavingsNzd: 34, solarAvoidedKg: 45 } },
    { id: 'you', label: 'You · demo', metrics: { conservedKwh: 75, reductionPercent: 20, evAvoidedKg: 34, offPeakSavingsNzd: 29, solarAvoidedKg: 32 } },
    { id: 'kea-19', label: 'Kea 19', metrics: { conservedKwh: 70, reductionPercent: 18, evAvoidedKg: 26, offPeakSavingsNzd: 30, solarAvoidedKg: 31 } },
    { id: 'kea-28', label: 'Kea 28', metrics: { conservedKwh: 56, reductionPercent: 14, evAvoidedKg: 22, offPeakSavingsNzd: 20, solarAvoidedKg: 24 } },
  ],
  'mount-eden': [
    { id: 'kea-05', label: 'Kea 05', metrics: { conservedKwh: 91, reductionPercent: 24, evAvoidedKg: 38, offPeakSavingsNzd: 36, solarAvoidedKg: 42 } },
    { id: 'kea-16', label: 'Kea 16', metrics: { conservedKwh: 81, reductionPercent: 20, evAvoidedKg: 36, offPeakSavingsNzd: 32, solarAvoidedKg: 35 } },
    { id: 'you', label: 'You · demo', metrics: { conservedKwh: 68, reductionPercent: 18, evAvoidedKg: 28, offPeakSavingsNzd: 27, solarAvoidedKg: 28 } },
    { id: 'kea-27', label: 'Kea 27', metrics: { conservedKwh: 53, reductionPercent: 15, evAvoidedKg: 15, offPeakSavingsNzd: 21, solarAvoidedKg: 18 } },
  ],
};

function cappedPoints(value: number, cap: number, weight: number): number {
  return Math.max(0, Math.min(value / cap, 1)) * weight;
}

export function demoScoreParts(metrics: DemoMetrics): Record<MetricKey, number> {
  return {
    conservation: cappedPoints(metrics.reductionPercent, demoScoring.conservation.cap, demoScoring.conservation.weight),
    ev: cappedPoints(metrics.evAvoidedKg, demoScoring.ev.cap, demoScoring.ev.weight),
    offPeak: cappedPoints(metrics.offPeakSavingsNzd, demoScoring.offPeak.cap, demoScoring.offPeak.weight),
    solar: cappedPoints(metrics.solarAvoidedKg, demoScoring.solar.cap, demoScoring.solar.weight),
  };
}

export function demoScore(metrics: DemoMetrics): number {
  return Object.values(demoScoreParts(metrics)).reduce((sum, part) => sum + part, 0);
}

export function demoLeaderboard(districtId: DemoDistrictId) {
  return samples[districtId]
    .map((player) => ({ ...player, score: demoScore(player.metrics) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map((player, index) => ({ ...player, rank: index + 1 }));
}

export type LocationSuggestion = { id: DemoDistrictId; distanceKm: number } | null;

/** A nearby *preview* suggestion only. No coordinate is stored or sent to an API. */
export function nearbyDemoDistrict(latitude: number, longitude: number): LocationSuggestion {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -37.05 || latitude > -36.65 || longitude < 174.5 || longitude > 175.0) return null;

  const nearest = demoDistricts
    .map((district) => {
      const northKm = (latitude - district.latitude) * 111.2;
      const eastKm = (longitude - district.longitude) * 111.2 * Math.cos(latitude * Math.PI / 180);
      return { id: district.id, distanceKm: Math.hypot(northKm, eastKm) };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  return nearest && nearest.distanceKm <= 12 ? nearest : null;
}

export type LocationOutcome = 'nearby' | 'outside' | 'denied' | 'unavailable';

export function locationOutcomeCopy(outcome: LocationOutcome): string {
  switch (outcome) {
    case 'nearby': return 'Nearby demo suburb suggested. Choose any suburb to explore.';
    case 'outside': return 'This preview has three Auckland examples. Choose one below.';
    case 'denied': return 'Location is off. Choose any demo suburb below.';
    case 'unavailable': return 'Location could not be checked. Choose a demo suburb below.';
  }
}
