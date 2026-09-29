import { apiJson } from '@/lib/backend-client';

export type HomeDeviceReading = {
  deviceId: string;
  label: string;
  deviceClass: string;
  energyKwh: number;
};

export type HomeSceneData = {
  customerId: string;
  region: string | null;
  day: string | null;
  dateSource: 'mart' | 'demo';
  deviceDay: string | null;
  meterImportKwh: number | null;
  meterExportKwh: number | null;
  devices: HomeDeviceReading[];
  livePowerAvailable: false;
};

type RawHome = {
  customer_id?: unknown;
  region?: unknown;
  day?: unknown;
  date_source?: unknown;
  device_day?: unknown;
  meter_import_kwh?: unknown;
  meter_export_kwh?: unknown;
  device_observations?: unknown;
  live_power_available?: unknown;
};

function nullableNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export async function loadHomeScene(customerId: string, signal?: AbortSignal): Promise<HomeSceneData> {
  const body = await apiJson<RawHome>(`/api/households/${encodeURIComponent(customerId)}/home-energy`, { signal });
  if (body.customer_id !== customerId || body.live_power_available !== false) throw new Error('Home energy response is invalid.');
  const observations = Array.isArray(body.device_observations) ? body.device_observations : [];
  const devices = observations.flatMap((value): HomeDeviceReading[] => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const energyKwh = nullableNumber(row.energy_kwh);
    if (row.confidence !== 'measured' || energyKwh === null || typeof row.device_id !== 'string' || typeof row.label !== 'string' || typeof row.device_class !== 'string') return [];
    return [{ deviceId: row.device_id, label: row.label, deviceClass: row.device_class, energyKwh }];
  });
  return {
    customerId,
    region: typeof body.region === 'string' && body.region.trim() ? body.region : null,
    day: typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null,
    dateSource: body.date_source === 'mart' ? 'mart' : 'demo',
    deviceDay: typeof body.device_day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.device_day) ? body.device_day : null,
    meterImportKwh: nullableNumber(body.meter_import_kwh),
    meterExportKwh: nullableNumber(body.meter_export_kwh),
    devices,
    livePowerAvailable: false,
  };
}
