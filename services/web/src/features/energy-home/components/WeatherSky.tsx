import { useRef, type CSSProperties } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import {
  cameraBearingFromHouse,
  getSkyPosition,
  projectCelestialPosition,
  starVisibility,
  type CelestialProjection,
  type SkyPosition,
} from '../lib/astronomy'
import type { ScenarioId } from '../lib/scenarios'
import type { Location, WeatherSnapshot } from '../lib/weather'
import './WeatherSky.css'

gsap.registerPlugin(useGSAP)

export interface WeatherSkyProps {
  weather: WeatherSnapshot | null
  time: Date
  location: Location
  houseFrontBearing: number
  scenario: ScenarioId
  orientationSet: boolean
}

interface SkyState {
  sky: SkyPosition | null
  cloudCover: number
  rain: boolean
  snow: boolean
  fog: boolean
  night: boolean
  twilight: boolean
  stars: number
}

const STAR_COUNT = 74
const SHOOTING_STAR_COUNT = 3
const RAIN_COUNT = 126
const SNOW_COUNT = 38
const CLOUD_COUNT = 6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** A deterministic spread keeps the same sky from jumping on each weather refresh. */
const spread = (index: number, multiplier: number, modulus: number) => ((index * multiplier) % modulus) / modulus

function safeSky(time: Date, location: Location): SkyPosition | null {
  try { return getSkyPosition(time, location) }
  catch { return null }
}

function getState(weather: WeatherSnapshot | null, time: Date, location: Location, scenario: ScenarioId): SkyState {
  const sky = safeSky(time, location)
  const fallbackCloud = scenario === 'rain' ? 94 : scenario === 'cloudy' ? 84 : scenario === 'night' ? 28 : 5
  const cloudCover = clamp(weather?.cloudCoverPercent ?? fallbackCloud, 0, 100)
  const snow = Boolean(weather && (weather.snowfallCm > 0 || weather.condition === 'snow'))
  // Open-Meteo's precipitation total includes snow water equivalent.
  const rain = !snow && (Boolean(
    weather && (weather.rainMm > 0 || weather.precipitationMm > 0 ||
      ['rain', 'drizzle', 'storm'].includes(weather.condition)),
  ) || (!weather && scenario === 'rain'))
  const fog = weather?.condition === 'fog'
  const night = sky ? !sky.isDay && !sky.isTwilight : !(weather?.isDay ?? true)
  const twilight = sky?.isTwilight ?? false
  const stars = sky ? starVisibility(sky.sun.altitude, cloudCover) : 0
  return { sky, cloudCover, rain, snow, fog, night, twilight, stars }
}

function skyStyle(projection: CelestialProjection): CSSProperties {
  return {
    left: `${clamp(50 + projection.x * 43, 6, 94)}%`,
    top: `${clamp(25 - projection.y * 25, 8, 36)}%`,
  }
}

/** Circular limb and elliptical terminator approximate the illuminated lunar fraction. */
function illuminatedMoonPath(fraction: number, waxing: boolean): string {
  const lit = clamp(fraction, 0, 1)
  if (lit >= 0.995) return 'M 24 2 A 22 22 0 1 1 23.999 2 Z'
  if (lit <= 0.005) return ''
  const terminatorRadius = Math.max(0.01, Math.abs(1 - 2 * lit) * 22)
  const outerSweep = waxing ? 1 : 0
  const innerSweep = waxing ? (lit < 0.5 ? 0 : 1) : (lit < 0.5 ? 1 : 0)
  return `M 24 2 A 22 22 0 0 ${outerSweep} 24 46 A ${terminatorRadius} 22 0 0 ${innerSweep} 24 2 Z`
}

export default function WeatherSky({ weather, time, location, houseFrontBearing, scenario, orientationSet }: WeatherSkyProps) {
  const root = useRef<HTMLDivElement>(null)
  const state = getState(weather, time, location, scenario)
  const cameraBearing = cameraBearingFromHouse(houseFrontBearing)
  const sunProjection = state.sky && orientationSet
    ? projectCelestialPosition(state.sky.sun, cameraBearing) : null
  const moonProjection = state.sky && orientationSet
    ? projectCelestialPosition(state.sky.moon, cameraBearing) : null
  const sunVisible = Boolean(sunProjection?.aboveHorizon && sunProjection.inFrontOfCamera)
  const moonVisible = Boolean(
    moonProjection?.aboveHorizon && moonProjection.inFrontOfCamera && state.sky && !state.sky.isDay,
  )
  const cloudVisibility = clamp((state.cloudCover - 8) / 95, 0, 0.92)
  const sunBrightness = clamp(1 - state.cloudCover / 170, 0.38, 1)
  const storm = weather?.condition === 'storm'

  useGSAP(() => {
    if (!root.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const wind = clamp(weather?.windSpeedKmh ?? 9, 2, 60)
    gsap.utils.toArray<HTMLElement>('.weather-sky__cloud', root.current).forEach((cloud, index) => {
      const reverse = cloud.classList.contains('weather-sky__cloud--reverse')
      gsap.to(cloud, {
        xPercent: reverse ? -48 : 48,
        y: index % 2 ? 8 : -7,
        duration: clamp(29 - wind / 3 + index * 1.7, 12, 34),
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      })
    })
    gsap.to('.weather-sky__sun-rays', {
      rotation: 360,
      duration: 48,
      ease: 'none',
      repeat: -1,
    })
    gsap.to('.weather-sky__sun-core', {
      scale: 1.09,
      duration: 2.7,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    })
    gsap.to('.weather-sky__moon-body', {
      y: -7,
      rotation: 1.5,
      duration: 4.8,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
    })
    if (state.rain) {
      gsap.fromTo('.weather-sky__rain-drop',
        { y: -160, x: -34, opacity: 0 },
        {
          y: () => (root.current?.clientHeight ?? 520) + 180,
          x: 48,
          opacity: (_, element) => element.classList.contains('weather-sky__rain-drop--near') ? 0.94 : 0.68,
          duration: (_, element) => element.classList.contains('weather-sky__rain-drop--near') ? 0.62 : 0.92,
          ease: 'none',
          repeat: -1,
          stagger: { each: 0.018, from: 'random' },
        },
      )
      gsap.to('.weather-precipitation__rain-sheet', {
        xPercent: 10,
        opacity: 0.7,
        duration: 2.4,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      })
    }
    if (state.snow) {
      gsap.fromTo('.weather-sky__snowflake',
        { y: -18, opacity: 0 },
        { y: 75, x: 16, opacity: 0.6, duration: 4.4, ease: 'none', repeat: -1, stagger: { each: 0.16, from: 'random' } },
      )
    }
    if (state.stars > 0.08) {
      gsap.to('.weather-sky__star', {
        opacity: (_, element) => element.classList.contains('weather-sky__star--bright') ? 0.95 : 0.42,
        duration: 2.2,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
        stagger: { each: 0.07, from: 'random' },
      })
      gsap.utils.toArray<HTMLElement>('.weather-sky__shooting-star', root.current).forEach((star, index) => {
        const travel = 150 + index * 32
        const timeline = gsap.timeline({
          repeat: -1,
          repeatDelay: gsap.utils.random(5.5, 10.5),
          delay: gsap.utils.random(1.1, 3.2) + index * 2.8,
        })
        timeline
          .set(star, { x: 0, y: 0, opacity: 0 })
          .to(star, { opacity: 1, duration: 0.08 })
          .to(star, { x: travel, y: travel * 0.48, opacity: 0, duration: 0.82, ease: 'power1.in' }, '<')
      })
    }
  }, { scope: root, dependencies: [state.rain, state.snow, state.stars > 0.08, sunVisible, moonVisible, weather?.windSpeedKmh], revertOnUpdate: true })

  const classes = [
    'weather-sky',
    state.night ? 'weather-sky--night' : state.twilight ? 'weather-sky--twilight' : 'weather-sky--day',
    state.cloudCover >= 65 && !state.rain ? 'weather-sky--overcast' : '',
    state.rain ? 'weather-sky--rain' : '',
    state.fog ? 'weather-sky--fog' : '',
    storm ? 'weather-sky--storm' : '',
  ].filter(Boolean).join(' ')

  return <div ref={root} className="weather-environment" aria-hidden="true">
    <div className={classes} data-scenario={scenario}>
      <div className="weather-sky__haze" />
      {state.stars > 0.08 && <div className="weather-sky__stars" style={{ opacity: state.stars }}>
        {Array.from({ length: STAR_COUNT }, (_, index) => {
          const style: CSSProperties = {
            left: `${2 + spread(index + 11, 37, 97) * 96}%`,
            top: `${3 + spread(index + 17, 61, 89) * 61}%`,
            width: index % 11 === 0 ? 3 : 1.5,
            height: index % 11 === 0 ? 3 : 1.5,
          }
          return <span key={index} className={`weather-sky__star${index % 11 === 0 ? ' weather-sky__star--bright' : ''}`} style={style} />
        })}
        {Array.from({ length: SHOOTING_STAR_COUNT }, (_, index) => <span
          key={`shooting-${index}`}
          className="weather-sky__shooting-star"
          style={{ left: `${8 + index * 25}%`, top: `${8 + (index % 2) * 14}%` }}
        />)}
      </div>}
      {sunVisible && sunProjection && state.sky && <div
        className="weather-sky__sun" style={{ ...skyStyle(sunProjection), opacity: sunBrightness }}
        title={`Sun ${Math.round(state.sky.sun.azimuth)}° from north, ${Math.round(state.sky.sun.altitude)}° above the horizon`}
      ><span className="weather-sky__sun-rays" /><span className="weather-sky__sun-core" /></div>}
      {moonVisible && moonProjection && state.sky && <div
        className="weather-sky__moon" style={skyStyle(moonProjection)}
        title={`Moon ${Math.round(state.sky.moon.illuminatedFraction * 100)}% illuminated`}
      ><div className="weather-sky__moon-body"><svg viewBox="0 0 48 48" focusable="false" aria-hidden="true">
        <circle cx="24" cy="24" r="22" fill="#8494a7" fillOpacity=".26" />
        <path d={illuminatedMoonPath(state.sky.moon.illuminatedFraction, state.sky.moon.waxing)} fill="#f7f5e9"
          transform={location.latitude < 0 ? 'rotate(180 24 24)' : undefined} />
      </svg></div></div>}
      {cloudVisibility > 0.02 && <div className="weather-sky__clouds" style={{ opacity: cloudVisibility }}>
        {Array.from({ length: CLOUD_COUNT }, (_, index) => <div
          key={index}
          className={`weather-sky__cloud${index % 2 ? ' weather-sky__cloud--reverse' : ''}`}
          style={{ left: `${-29 + index * 22}%`, top: `${-2 + (index % 3) * 15}%`, scale: String(0.72 + index * 0.13) }}
        />)}
      </div>}
    </div>
    <div className={`weather-precipitation${state.rain ? ' weather-precipitation--rain' : ''}${state.snow ? ' weather-precipitation--snow' : ''}${state.fog ? ' weather-precipitation--fog' : ''}${storm ? ' weather-precipitation--storm' : ''}`}>
      {state.fog && <div className="weather-sky__fog" />}
      {state.rain && <div className="weather-sky__rain">
        <div className="weather-precipitation__rain-sheet" />
        {Array.from({ length: RAIN_COUNT }, (_, index) => <span key={index} className={`weather-sky__rain-drop${index % 5 === 0 ? ' weather-sky__rain-drop--near' : ''}`} style={{
          left: `${spread(index + 1, 41, 127) * 108 - 4}%`,
          top: `${spread(index + 13, 31, 113) * 88 - 18}%`,
          height: `${12 + (index % 5) * 5}px`,
        }} />)}
      </div>}
      {state.snow && <div className="weather-sky__snow">
        {Array.from({ length: SNOW_COUNT }, (_, index) => <span key={index} className="weather-sky__snowflake" style={{
          left: `${spread(index + 7, 43, 91) * 100}%`,
          top: `${spread(index + 23, 29, 83) * 100}%`,
        }} />)}
      </div>}
      {storm && <div className="weather-precipitation__storm-wash" />}
    </div>
  </div>
}
