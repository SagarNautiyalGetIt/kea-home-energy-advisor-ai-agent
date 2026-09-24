/** A static demonstration dispatch. Every power value is kW, never meter telemetry. */
export interface EnergyInput {
  solarPotential: number
  batteryPercent: number
  reservePercent: number
  evEnabled: boolean
  gridConnected: boolean
  solarCapacityKw?: number
  homeDemandKw?: number
  evDemandKw?: number
  batteryCapacityKwh?: number
  batteryMaxChargeKw?: number
  batteryMaxDischargeKw?: number
  /** Battery energy limits are checked over this interval; no history is simulated. */
  dispatchMinutes?: number
}

export interface EnergyFlows {
  solarToHomeKw: number
  solarToEvKw: number
  solarToBatteryKw: number
  solarToGridKw: number
  batteryToHomeKw: number
  batteryToEvKw: number
  gridToHomeKw: number
  gridToEvKw: number
}

export interface EnergySnapshot {
  solarAvailableKw: number
  /** Solar power actually dispatched, excluding curtailed production. */
  solarKw: number
  curtailedKw: number
  homeDemandKw: number
  homeServedKw: number
  evDemandKw: number
  evServedKw: number
  batteryChargeKw: number
  batteryDischargeKw: number
  gridImportKw: number
  gridExportKw: number
  unservedKw: number
  homeUnservedKw: number
  evUnservedKw: number
  batteryPercent: number
  reservePercent: number
  batteryState: 'charging' | 'discharging' | 'full' | 'reserve' | 'idle' | 'unavailable'
  gridState: 'importing' | 'exporting' | 'balanced' | 'outage'
  solarState: 'generating' | 'curtailed' | 'idle'
  evState: 'off' | 'idle' | 'charging' | 'limited' | 'unpowered'
  homeState: 'powered' | 'limited' | 'unpowered'
  selfPowered: boolean
  flows: EnergyFlows
}

const EPSILON = 1e-9

function finite(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be a finite number`)
  return value
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function nonNegative(value: number, name: string): number {
  finite(value, name)
  if (value < 0) throw new RangeError(`${name} must not be negative`)
  return value
}

/**
 * Solar supplies the house, then the EV, then charges the battery, then exports.
 * During a deficit the battery supplies the house and EV before the grid imports.
 * The reserve is a hard floor even in an outage. Unavailable supply is reported as
 * unserved demand; surplus with no battery headroom or grid is curtailed.
 *
 * Percentages and solar potential are clamped to their physical ranges. Power,
 * capacity, and interval settings must be finite and non-negative (interval > 0).
 * No branch charges/discharges the battery or imports/exports simultaneously.
 */
export function calculateEnergy(input: EnergyInput): EnergySnapshot {
  const solarPotential = clamp(finite(input.solarPotential, 'solarPotential'), 0, 1)
  const batteryPercent = clamp(finite(input.batteryPercent, 'batteryPercent'), 0, 100)
  const reservePercent = clamp(finite(input.reservePercent, 'reservePercent'), 0, 100)
  const solarCapacityKw = nonNegative(input.solarCapacityKw ?? 6.5, 'solarCapacityKw')
  const homeDemandKw = nonNegative(input.homeDemandKw ?? 1.2, 'homeDemandKw')
  const requestedEvKw = nonNegative(input.evDemandKw ?? 3.2, 'evDemandKw')
  const evDemandKw = input.evEnabled ? requestedEvKw : 0
  const batteryCapacityKwh = nonNegative(input.batteryCapacityKwh ?? 13.5, 'batteryCapacityKwh')
  const maxChargeKw = nonNegative(input.batteryMaxChargeKw ?? 5, 'batteryMaxChargeKw')
  const maxDischargeKw = nonNegative(input.batteryMaxDischargeKw ?? 5, 'batteryMaxDischargeKw')
  const dispatchMinutes = nonNegative(input.dispatchMinutes ?? 5, 'dispatchMinutes')
  if (dispatchMinutes === 0) throw new RangeError('dispatchMinutes must be greater than zero')
  const hours = dispatchMinutes / 60

  const solarAvailableKw = solarPotential * solarCapacityKw
  const solarToHomeKw = Math.min(solarAvailableKw, homeDemandKw)
  const solarToEvKw = Math.min(solarAvailableKw - solarToHomeKw, evDemandKw)
  const solarSurplusKw = Math.max(0, solarAvailableKw - solarToHomeKw - solarToEvKw)
  const homeDeficitKw = Math.max(0, homeDemandKw - solarToHomeKw)
  const evDeficitKw = Math.max(0, evDemandKw - solarToEvKw)

  const usableBatteryKwh = Math.max(0, batteryPercent - reservePercent) / 100 * batteryCapacityKwh
  const batteryHeadroomKwh = (100 - batteryPercent) / 100 * batteryCapacityKwh
  const dischargeLimitKw = Math.min(maxDischargeKw, usableBatteryKwh / hours)
  const chargeLimitKw = Math.min(maxChargeKw, batteryHeadroomKwh / hours)
  const batteryToHomeKw = Math.min(homeDeficitKw, dischargeLimitKw)
  const batteryToEvKw = Math.min(evDeficitKw, Math.max(0, dischargeLimitKw - batteryToHomeKw))
  const solarToBatteryKw = Math.min(solarSurplusKw, chargeLimitKw)
  const remainingSolarKw = Math.max(0, solarSurplusKw - solarToBatteryKw)
  const solarToGridKw = input.gridConnected ? remainingSolarKw : 0
  const curtailedKw = input.gridConnected ? 0 : remainingSolarKw

  const homeRemainingKw = Math.max(0, homeDeficitKw - batteryToHomeKw)
  const evRemainingKw = Math.max(0, evDeficitKw - batteryToEvKw)
  const gridToHomeKw = input.gridConnected ? homeRemainingKw : 0
  const gridToEvKw = input.gridConnected ? evRemainingKw : 0
  const homeUnservedKw = input.gridConnected ? 0 : homeRemainingKw
  const evUnservedKw = input.gridConnected ? 0 : evRemainingKw
  const homeServedKw = homeDemandKw - homeUnservedKw
  const evServedKw = evDemandKw - evUnservedKw
  const batteryChargeKw = solarToBatteryKw
  const batteryDischargeKw = batteryToHomeKw + batteryToEvKw
  const gridImportKw = gridToHomeKw + gridToEvKw
  const gridExportKw = solarToGridKw
  const unservedKw = homeUnservedKw + evUnservedKw

  const batteryState: EnergySnapshot['batteryState'] = batteryCapacityKwh === 0
    ? 'unavailable'
    : batteryChargeKw > EPSILON ? 'charging'
      : batteryDischargeKw > EPSILON ? 'discharging'
        : batteryPercent >= 100 ? 'full'
          : batteryPercent <= reservePercent ? 'reserve' : 'idle'
  const gridState: EnergySnapshot['gridState'] = !input.gridConnected
    ? 'outage'
    : gridImportKw > EPSILON ? 'importing'
      : gridExportKw > EPSILON ? 'exporting' : 'balanced'
  const evState: EnergySnapshot['evState'] = !input.evEnabled
    ? 'off'
    : evDemandKw <= EPSILON ? 'idle'
      : evServedKw <= EPSILON ? 'unpowered'
        : evUnservedKw > EPSILON ? 'limited' : 'charging'
  const homeState: EnergySnapshot['homeState'] = homeUnservedKw <= EPSILON
    ? 'powered' : homeServedKw > EPSILON ? 'limited' : 'unpowered'

  return {
    solarAvailableKw,
    solarKw: solarAvailableKw - curtailedKw,
    curtailedKw,
    homeDemandKw,
    homeServedKw,
    evDemandKw,
    evServedKw,
    batteryChargeKw,
    batteryDischargeKw,
    gridImportKw,
    gridExportKw,
    unservedKw,
    homeUnservedKw,
    evUnservedKw,
    batteryPercent,
    reservePercent,
    batteryState,
    gridState,
    solarState: curtailedKw > EPSILON ? 'curtailed' : solarAvailableKw > EPSILON ? 'generating' : 'idle',
    evState,
    homeState,
    selfPowered: gridImportKw <= EPSILON && unservedKw <= EPSILON,
    flows: {
      solarToHomeKw,
      solarToEvKw,
      solarToBatteryKw,
      solarToGridKw,
      batteryToHomeKw,
      batteryToEvKw,
      gridToHomeKw,
      gridToEvKw,
    },
  }
}
