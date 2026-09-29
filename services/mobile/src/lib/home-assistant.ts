import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiJson, jsonRequest } from '@/lib/backend-client';
import { measuredDayKwh, previousCompleteDay } from '@/lib/home-assistant-energy';

export type DeviceKind = 'space_heating' | 'water_heating' | 'cooling' | 'laundry' | 'kitchen' | 'ev_charger' | 'lighting' | 'other' | 'solar_generation' | 'battery_charge' | 'battery_discharge';
export type EnergyEntity = { id: string; label: string; unit: 'Wh' | 'kWh' };
export type EnergyMapping = EnergyEntity & { deviceClass: DeviceKind };
export type PowerKind = 'solar_generation' | 'battery_charge' | 'battery_discharge' | 'grid_import' | 'grid_export' | 'ev_charger' | 'home_load';
export type PowerEntity = { id: string; label: string; unit: 'W' | 'kW' };
export type PowerMapping = PowerEntity & { kind: PowerKind };
export type LivePower = Partial<Record<PowerKind, number>>;
export type HomeAssistantConnection = { url: string; timezone: string; mappings: EnergyMapping[]; powerMappings: PowerMapping[] };

const configKey = (customerId: string) => `kea-ha-config-v1-${customerId}`;
const tokenKey = (customerId: string) => `kea-ha-token-v1-${customerId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

type HaState = { entity_id?: unknown; state?: unknown; attributes?: Record<string, unknown>; last_updated?: unknown; last_changed?: unknown };

function cleanBase(url: string) {
  const parsed = new URL(url.trim());
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('Enter the Home Assistant base URL only, such as http://homeassistant.local:8123.');
  return parsed.origin;
}

async function haJson<T>(url: string, token: string, path: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) throw new Error(`Home Assistant returned ${response.status}. Check its URL and token.`);
    return response.json() as Promise<T>;
  } finally { clearTimeout(timeout); }
}

function energyEntity(row: HaState): EnergyEntity | null {
  const attributes = row.attributes;
  const unit = attributes?.unit_of_measurement;
  if (typeof row.entity_id !== 'string' || !row.entity_id.startsWith('sensor.') || attributes?.device_class !== 'energy' || attributes?.state_class !== 'total_increasing' || (unit !== 'Wh' && unit !== 'kWh')) return null;
  return { id: row.entity_id, label: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : row.entity_id, unit };
}

function powerEntity(row: HaState): PowerEntity | null {
  const attributes = row.attributes;
  const unit = attributes?.unit_of_measurement;
  if (typeof row.entity_id !== 'string' || !row.entity_id.startsWith('sensor.') || attributes?.device_class !== 'power' || (unit !== 'W' && unit !== 'kW')) return null;
  return { id: row.entity_id, label: typeof attributes.friendly_name === 'string' ? attributes.friendly_name : row.entity_id, unit };
}

export async function connectHomeAssistant(customerId: string, baseUrl: string, token: string) {
  if (Platform.OS === 'web') throw new Error('Home Assistant connection needs the iOS or Android app.');
  if (!customerId || !token.trim()) throw new Error('Sign in and enter a Home Assistant token.');
  const url = cleanBase(baseUrl);
  const [states, config] = await Promise.all([
    haJson<HaState[]>(url, token.trim(), '/api/states'),
    haJson<{ time_zone?: string }>(url, token.trim(), '/api/config'),
  ]);
  if (!Array.isArray(states)) throw new Error('Home Assistant returned an invalid device list.');
  const timezone = config.time_zone;
  if (!timezone) throw new Error('Home Assistant did not report its timezone.');
  try { new Intl.DateTimeFormat('en-NZ', { timeZone: timezone }); } catch { throw new Error('Home Assistant reported an invalid timezone.'); }
  const entities = states.flatMap((row) => { const item = energyEntity(row); return item ? [item] : []; });
  const current = await loadHomeAssistant(customerId);
  const powerEntities = states.flatMap((row) => { const item = powerEntity(row); return item ? [item] : []; });
  const saved: HomeAssistantConnection = {
    url,
    timezone,
    mappings: current?.url === url ? current.mappings.filter((mapping) => entities.some((entity) => entity.id === mapping.id)) : [],
    powerMappings: current?.url === url ? current.powerMappings.filter((mapping) => powerEntities.some((entity) => entity.id === mapping.id)) : [],
  };
  await SecureStore.setItemAsync(tokenKey(customerId), token.trim(), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  await AsyncStorage.setItem(configKey(customerId), JSON.stringify(saved));
  return { connection: saved, entities, powerEntities };
}

export async function loadHomeAssistant(customerId: string): Promise<HomeAssistantConnection | null> {
  if (!customerId || Platform.OS === 'web') return null;
  const raw = await AsyncStorage.getItem(configKey(customerId));
  if (!raw) return null;
  const value = JSON.parse(raw) as Partial<HomeAssistantConnection>;
  return typeof value.url === 'string' && typeof value.timezone === 'string' && Array.isArray(value.mappings) ? { ...value as HomeAssistantConnection, powerMappings: Array.isArray(value.powerMappings) ? value.powerMappings : [] } : null;
}

export async function listHomeAssistantEntities(customerId: string): Promise<EnergyEntity[]> {
  const connection = await loadHomeAssistant(customerId);
  const token = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(tokenKey(customerId));
  if (!connection || !token) return [];
  const states = await haJson<HaState[]>(connection.url, token, '/api/states');
  if (!Array.isArray(states)) throw new Error('Home Assistant returned an invalid device list.');
  return states.flatMap((row) => { const entity = energyEntity(row); return entity ? [entity] : []; });
}

export async function listHomeAssistantPowerEntities(customerId: string): Promise<PowerEntity[]> {
  const connection = await loadHomeAssistant(customerId);
  const token = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(tokenKey(customerId));
  if (!connection || !token) return [];
  const states = await haJson<HaState[]>(connection.url, token, '/api/states');
  if (!Array.isArray(states)) throw new Error('Home Assistant returned an invalid sensor list.');
  return states.flatMap((row) => { const entity = powerEntity(row); return entity ? [entity] : []; });
}

export async function saveEnergyMapping(customerId: string, entity: EnergyEntity, deviceClass: DeviceKind) {
  const connection = await loadHomeAssistant(customerId);
  if (!connection) throw new Error('Connect Home Assistant first.');
  const mapping = { ...entity, deviceClass };
  const mappings = [...connection.mappings.filter((row) => row.id !== entity.id), mapping];
  await AsyncStorage.setItem(configKey(customerId), JSON.stringify({ ...connection, mappings }));
  return mappings;
}

export async function savePowerMapping(customerId: string, entity: PowerEntity, kind: PowerKind) {
  const connection = await loadHomeAssistant(customerId);
  if (!connection) throw new Error('Connect Home Assistant first.');
  const powerMappings = [...connection.powerMappings.filter((row) => row.id !== entity.id && row.kind !== kind), { ...entity, kind }];
  await AsyncStorage.setItem(configKey(customerId), JSON.stringify({ ...connection, powerMappings }));
  return powerMappings;
}

export async function loadLiveHomePower(customerId: string): Promise<LivePower> {
  const connection = await loadHomeAssistant(customerId);
  const token = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(tokenKey(customerId));
  if (!connection || !token || !connection.powerMappings.length) return {};
  const states = await haJson<HaState[]>(connection.url, token, '/api/states');
  if (!Array.isArray(states)) return {};
  const byId = new Map(states.map((row) => [row.entity_id, row]));
  const live: LivePower = {};
  const now = Date.now();
  for (const mapping of connection.powerMappings) {
    const row = byId.get(mapping.id);
    const entity = row && powerEntity(row);
    const at = new Date(String(row?.last_updated ?? row?.last_changed)).getTime();
    const watts = Number(row?.state) * (mapping.unit === 'kW' ? 1000 : 1);
    if (!entity || entity.unit !== mapping.unit || !Number.isFinite(at) || at > now + 60_000 || now - at > 5 * 60_000 || !Number.isFinite(watts) || watts < 0 || watts > 100_000) continue;
    live[mapping.kind] = Math.round(watts);
  }
  return live;
}

export async function disconnectHomeAssistant(customerId: string) {
  await AsyncStorage.removeItem(configKey(customerId));
  if (Platform.OS !== 'web') await SecureStore.deleteItemAsync(tokenKey(customerId));
}

export async function syncHomeAssistant(customerId: string) {
  const connection = await loadHomeAssistant(customerId);
  const token = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(tokenKey(customerId));
  if (!connection || !token) throw new Error('Connect Home Assistant again to sync.');
  if (!connection.mappings.length) throw new Error('Choose an energy sensor and its device type first.');
  const { day, start, end } = previousCompleteDay(connection.timezone);
  const observations = await Promise.all(connection.mappings.map(async (entity) => {
    const path = `/api/history/period/${encodeURIComponent(start.toISOString())}?end_time=${encodeURIComponent(end.toISOString())}&filter_entity_id=${encodeURIComponent(entity.id)}`;
    const history = await haJson<HaState[][]>(connection.url, token, path);
    return { device_id: entity.id, provider: 'home_assistant', device_class: entity.deviceClass, label: entity.label, day, energy_kwh: measuredDayKwh(history, entity, start, end), confidence: 'measured', always_on: false };
  }));
  const result = await apiJson<{ saved: number }>(`/api/households/${encodeURIComponent(customerId)}/device-observations`, jsonRequest('POST', { observations, timezone: connection.timezone }));
  return { day, saved: result.saved };
}
