import { useEffect, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import type { EnergySnapshot } from '../lib/energy'
import './EnergyHouse.css'

gsap.registerPlugin(useGSAP)

export type EnergyDevice = 'solar' | 'home' | 'car' | 'battery' | 'grid'

interface EnergyHouseProps {
  snapshot: EnergySnapshot | null
  onDeviceSelect: (device: EnergyDevice) => void
  activeDevice?: EnergyDevice | null
  className?: string
}

type PipeId = 'solar' | 'battery' | 'grid' | 'car'
type FlowSource = 'solar' | 'battery' | 'grid'

interface Pipe {
  id: PipeId
  path: string
  kw: number
  direction: 'forward' | 'reverse'
  source: FlowSource
}

// Traced on the already-visible conduits of the supplied, unmodified illustration.
// Coordinates refer to the SVG viewBox below, not the source PNG pixel dimensions.
const PIPE_PATHS: Record<PipeId, string> = {
  solar: 'M1460 311 Q1471 316 1459 321 L1338 363 Q1323 368 1333 379 L1425 461 Q1433 467 1433 480 L1432 571 Q1432 581 1422 584 L1410 587 Q1399 590 1399 601 L1399 628',
  battery: 'M1393 697 L1393 768 Q1393 776 1385 781 L1291 817 Q1281 821 1281 812 L1281 800',
  grid: 'M1401 697 L1401 770 Q1401 778 1409 782 L1425 789 Q1432 793 1435 801 L1525 832 Q1538 837 1550 832 L1805 727',
  car: 'M1155 768 C1156 811 1155 850 1144 872 C1139 883 1131 891 1118 899 C1065 930 994 961 950 965 C920 969 906 956 902 939 C898 922 900 905 888 895 L883 892',
}

const SMALL_FLOW = 0.01

function dominantSource(contributions: { source: FlowSource; kw: number }[]): FlowSource {
  return contributions.reduce((strongest, contribution) => (
    contribution.kw > strongest.kw ? contribution : strongest
  ), { source: 'solar' as FlowSource, kw: -1 }).source
}

function formatPower(kw: number): string {
  return `${kw.toFixed(1)} kW`
}

function flowLabel(snapshot: EnergySnapshot | null, device: EnergyDevice): string {
  if (!snapshot) return '—'
  switch (device) {
    case 'solar':
      return formatPower(snapshot.solarKw)
    case 'home':
      return formatPower(snapshot.homeServedKw)
    case 'car':
      return snapshot.evServedKw > SMALL_FLOW ? formatPower(snapshot.evServedKw) : 'Idle'
    case 'battery': {
      const kw = Math.max(snapshot.batteryChargeKw, snapshot.batteryDischargeKw)
      return `${formatPower(kw)} · ${Math.round(snapshot.batteryPercent)}%`
    }
    case 'grid':
      return formatPower(Math.max(snapshot.gridImportKw, snapshot.gridExportKw))
  }
}

function flowDetail(snapshot: EnergySnapshot | null, device: EnergyDevice): string {
  if (!snapshot) return 'Waiting for demo data'
  switch (device) {
    case 'solar':
      return snapshot.solarState === 'idle' ? 'No generation' : 'Generating'
    case 'home':
      return snapshot.homeState === 'powered' ? 'Powered' : snapshot.homeState === 'limited' ? 'Limited supply' : 'No supply'
    case 'car':
      return snapshot.evState === 'charging' ? 'Charging' : snapshot.evState === 'limited' ? 'Limited charge' : 'Not charging'
    case 'battery':
      return snapshot.batteryState === 'charging' ? 'Charging' : snapshot.batteryState === 'discharging' ? 'Discharging' : snapshot.batteryState === 'reserve' ? 'At reserve' : snapshot.batteryState === 'full' ? 'Full' : 'Standing by'
    case 'grid':
      return snapshot.gridState === 'importing' ? 'Importing' : snapshot.gridState === 'exporting' ? 'Exporting' : snapshot.gridState === 'outage' ? 'Unavailable' : 'Balanced'
  }
}

interface DeviceChipProps {
  device: EnergyDevice
  x: number
  y: number
  width: number
  title: string
  snapshot: EnergySnapshot | null
  selected: boolean
  onSelect: (device: EnergyDevice) => void
}

function DeviceChip({ device, x, y, width, title, snapshot, selected, onSelect }: DeviceChipProps) {
  const value = flowLabel(snapshot, device)
  const detail = flowDetail(snapshot, device)
  return (
    <g
      className={`kea-house-chip kea-house-chip--${device}${selected ? ' is-selected' : ''}`}
      transform={`translate(${x} ${y})`}
      role="button"
      aria-label={`${title}: ${value}. ${detail}. View details`}
      tabIndex={0}
      onClick={() => onSelect(device)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(device)
        }
      }}
    >
      <rect className="kea-house-chip-back" width={width} height="88" rx="19" />
      <rect className="kea-house-chip-accent" x="13" y="16" width="3" height="56" rx="1.5" />
      <text className="kea-house-chip-title" x="29" y="31">{title}</text>
      <text className="kea-house-chip-power" x="29" y="64">{value}</text>
    </g>
  )
}

/** Fixed-camera energy scene built around the transparent house illustration. */
export default function EnergyHouse({ snapshot, onDeviceSelect, activeDevice = null, className = '' }: EnergyHouseProps) {
  const rootRef = useRef<HTMLElement>(null)
  const pipeRefs = useRef<Record<PipeId, SVGPathElement | null>>({ solar: null, battery: null, grid: null, car: null })
  const [reduceMotion, setReduceMotion] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduceMotion(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const homeSource = dominantSource([
    { source: 'solar', kw: snapshot?.flows.solarToHomeKw ?? 0 },
    { source: 'battery', kw: snapshot?.flows.batteryToHomeKw ?? 0 },
    { source: 'grid', kw: snapshot?.flows.gridToHomeKw ?? 0 },
  ])
  const carSource = dominantSource([
    { source: 'solar', kw: snapshot?.flows.solarToEvKw ?? 0 },
    { source: 'battery', kw: snapshot?.flows.batteryToEvKw ?? 0 },
    { source: 'grid', kw: snapshot?.flows.gridToEvKw ?? 0 },
  ])
  const batterySource: FlowSource = (snapshot?.batteryDischargeKw ?? 0) > SMALL_FLOW ? 'battery' : 'solar'
  const gridSource: FlowSource = (snapshot?.gridImportKw ?? 0) > SMALL_FLOW ? 'grid' : 'solar'

  const pipes: Pipe[] = [
    { id: 'solar', path: PIPE_PATHS.solar, kw: snapshot?.solarKw ?? 0, direction: 'forward', source: 'solar' },
    { id: 'battery', path: PIPE_PATHS.battery, kw: Math.max(snapshot?.batteryChargeKw ?? 0, snapshot?.batteryDischargeKw ?? 0), direction: (snapshot?.batteryDischargeKw ?? 0) > SMALL_FLOW ? 'reverse' : 'forward', source: batterySource },
    { id: 'grid', path: PIPE_PATHS.grid, kw: Math.max(snapshot?.gridImportKw ?? 0, snapshot?.gridExportKw ?? 0), direction: (snapshot?.gridImportKw ?? 0) > SMALL_FLOW ? 'reverse' : 'forward', source: gridSource },
    { id: 'car', path: PIPE_PATHS.car, kw: snapshot?.evServedKw ?? 0, direction: 'forward', source: carSource },
  ]

  const flowSignature = pipes.map(({ id, kw, direction, source }) => `${id}:${kw.toFixed(3)}:${direction}:${source}`).join('|')

  useGSAP(() => {
    if (reduceMotion) return
    for (const pipe of pipes) {
      if (pipe.kw <= SMALL_FLOW) continue
      const path = pipeRefs.current[pipe.id]
      if (!path) continue
      const length = path.getTotalLength()
      const streak = Math.min(23, length * 0.12)
      const gap = length / 3 - streak
      gsap.set(path, { strokeDasharray: `${streak} ${gap}`, strokeDashoffset: 0 })
      gsap.fromTo(
        path,
        { strokeDashoffset: pipe.direction === 'forward' ? 0 : -length },
        {
          strokeDashoffset: pipe.direction === 'forward' ? -length : 0,
          duration: Math.max(1.9, 3.2 - Math.min(pipe.kw, 6) * 0.17),
          ease: 'none',
          repeat: -1,
        },
      )
    }
  }, { scope: rootRef, dependencies: [flowSignature, reduceMotion], revertOnUpdate: true })

  const isActive = (id: PipeId) => pipes.find((pipe) => pipe.id === id)!.kw > SMALL_FLOW
  const homePowered = (snapshot?.homeServedKw ?? 0) > SMALL_FLOW
  const carPowered = (snapshot?.evServedKw ?? 0) > SMALL_FLOW

  return (
    <figure ref={rootRef} className={`kea-energy-house ${className}`.trim()} aria-label="Kea Energy home energy flows">
      <svg className="kea-energy-house-scene" viewBox="0 0 2048 1117.091" preserveAspectRatio="xMidYMid meet" aria-label="Solar home with Kea battery, electric car, and grid connection">
        <defs>
          <filter id="kea-flow-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2.1" />
          </filter>
          <radialGradient id="kea-wall-glow-solar"><stop offset="0" stopColor="#63f09a" stopOpacity=".5" /><stop offset="1" stopColor="#63f09a" stopOpacity="0" /></radialGradient>
          <radialGradient id="kea-wall-glow-battery"><stop offset="0" stopColor="#5ab8ff" stopOpacity=".5" /><stop offset="1" stopColor="#5ab8ff" stopOpacity="0" /></radialGradient>
          <radialGradient id="kea-wall-glow-grid"><stop offset="0" stopColor="#ff9f43" stopOpacity=".5" /><stop offset="1" stopColor="#ff9f43" stopOpacity="0" /></radialGradient>
        </defs>

        <image href="/assets/kea-home.png" x="0" y="0" width="2048" height="1117.091" role="img" aria-label="Solar home, Kea battery, electric car, and grid connection" />

        {/* The illustration's conduit is the guide; live colour runs inside it. */}
        <g className="kea-house-pipes" aria-hidden="true">
          {pipes.map((pipe) => isActive(pipe.id) && (
            <g key={pipe.id} className={`kea-house-route kea-house-route--${pipe.id} kea-house-route--source-${pipe.source}`}>
              <path className="kea-house-route-glow" d={pipe.path} filter="url(#kea-flow-glow)" />
              <path
                ref={(node) => { pipeRefs.current[pipe.id] = node }}
                className={`kea-house-route-pulse${reduceMotion ? ' is-still' : ''}`}
                d={pipe.path}
              />
            </g>
          ))}
        </g>

        {/* Supply to the house and charger is concealed within the wall in this image. */}
        {homePowered && <circle className="kea-house-wall-light" cx="1578" cy="613" r="32" fill={`url(#kea-wall-glow-${homeSource})`} aria-hidden="true" />}
        {carPowered && <circle className="kea-house-wall-light" cx="1155" cy="768" r="24" fill={`url(#kea-wall-glow-${carSource})`} aria-hidden="true" />}

        <g className="kea-house-hotspots">
          <DeviceChip device="solar" x={1112} y={82} width={175} title="SOLAR" snapshot={snapshot} selected={activeDevice === 'solar'} onSelect={onDeviceSelect} />
          <DeviceChip device="home" x={1532} y={494} width={170} title="HOME" snapshot={snapshot} selected={activeDevice === 'home'} onSelect={onDeviceSelect} />
          <DeviceChip device="car" x={724} y={988} width={172} title="EV" snapshot={snapshot} selected={activeDevice === 'car'} onSelect={onDeviceSelect} />
          <DeviceChip device="battery" x={1146} y={868} width={222} title="KEA BATTERY" snapshot={snapshot} selected={activeDevice === 'battery'} onSelect={onDeviceSelect} />
          <DeviceChip device="grid" x={1730} y={466} width={178} title="GRID" snapshot={snapshot} selected={activeDevice === 'grid'} onSelect={onDeviceSelect} />
        </g>
      </svg>
      <figcaption className="kea-energy-house-caption" aria-label="Energy flow colours: solar green, battery blue, grid orange">
        <span className="kea-flow-key kea-flow-key--solar"><i />Solar</span>
        <span className="kea-flow-key kea-flow-key--battery"><i />Battery</span>
        <span className="kea-flow-key kea-flow-key--grid"><i />Grid</span>
      </figcaption>
    </figure>
  )
}
