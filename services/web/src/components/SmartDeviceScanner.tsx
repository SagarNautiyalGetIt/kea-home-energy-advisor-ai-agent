import { Loader2, Radar, Wifi, WifiOff } from 'lucide-react'
import { useState } from 'react'
import { discoverSmartDevices, type SmartDeviceScan } from '../lib/client'

/**
 * Find the smart devices already on this network.
 *
 * ## Why this screen exists before the OAuth connectors do
 *
 * Connecting a platform account is the right long-term integration and a poor first step:
 * a household sees nothing of value until after they have signed into something. Devices
 * on a home network already announce themselves over mDNS to anybody on that network — it
 * is how a phone finds a Chromecast — so this answers the question customers ask first,
 * *do you even know what I've got*, with no account and no credential.
 *
 * ## It finds names, not energy
 *
 * An mDNS announcement carries a service type and a hostname. There is no power figure in
 * it and no way to derive one, so nothing on this screen may show a kWh or a dollar amount
 * against a device. A list of device names is exactly the raw material from which a
 * plausible "your heat pump used about 40 kWh" could be assembled, which is why the copy
 * says what the scan cannot do as prominently as what it can.
 *
 * ## Empty is not "you have none"
 *
 * The scan only sees the network the API is running on. A customer on mobile data has every
 * device in the world at home and none of them visible here, and telling them they have no
 * smart devices would be confidently wrong — so the empty state explains the limitation
 * instead.
 */

const PLATFORM_NAMES: Record<string, string> = {
  google_home: 'Google Home',
  homekit: 'Apple Home',
  matter: 'Matter / Home Assistant',
  smartthings: 'SmartThings',
}

export default function SmartDeviceScanner({ onToast }: { onToast?: (message: string) => void }) {
  const [scan, setScan] = useState<SmartDeviceScan | null>(null)
  const [scanning, setScanning] = useState(false)

  const run = async () => {
    setScanning(true)
    try {
      const result = await discoverSmartDevices()
      setScan(result)
      onToast?.(
        result.devices_found
          ? `Found ${result.devices_found} device${result.devices_found === 1 ? '' : 's'}`
          : 'No devices answered on this network',
      )
    } catch {
      setScan({
        scanned: false,
        error: 'the scan could not be started',
        method: 'failed',
        scan_was_shallow: true,
        devices_found: 0,
        devices: [],
        by_platform: {},
        platforms_worth_connecting: [],
      })
    } finally {
      setScanning(false)
    }
  }

  return (
    <section className="card device-scan">
      <h2><Radar aria-hidden="true"/>Smart devices on your network</h2>
      <p className="device-scan-lede">
        We can look for smart devices that are already announcing themselves on your home
        network — no account, no sign-in. This tells us <strong>what you have</strong>; it
        does not read how much power any of it uses. Connecting one of the platforms below
        is what makes that possible.
      </p>

      <button type="button" className="primary" onClick={run} disabled={scanning}>
        {scanning ? <><Loader2 className="spin" aria-hidden="true"/> Scanning…</> : <><Wifi aria-hidden="true"/> Scan my network</>}
      </button>

      {scan && scan.error && (
        <p className="device-scan-empty">
          <WifiOff aria-hidden="true"/> The scan couldn’t run here — {scan.error}. This is
          normal when the app is running somewhere other than your own home network.
        </p>
      )}

      {scan && !scan.error && scan.devices_found === 0 && (
        <p className="device-scan-empty">
          <WifiOff aria-hidden="true"/> Nothing answered. That doesn’t necessarily mean you
          have no smart devices — this only sees the network this app is running on, so if
          you’re away from home, on mobile data, or your devices are on a guest network,
          they won’t show up here. Connecting a platform account works from anywhere.
        </p>
      )}

      {scan && scan.devices_found > 0 && (
        <>
          <ul className="device-list">
            {scan.devices.map((device) => (
              <li key={`${device.name}-${device.kind}`}>
                <div className="device-row">
                  <strong>{device.name}</strong>
                  <span className="device-kind">{device.kind}</span>
                  {device.could_connect_via && (
                    <span className="device-platform">
                      via {PLATFORM_NAMES[device.could_connect_via] ?? device.could_connect_via}
                    </span>
                  )}
                </div>
                <small>{device.note}</small>
              </li>
            ))}
          </ul>

          {scan.platforms_worth_connecting.length > 0 && (
            <p className="device-scan-next">
              Connect{' '}
              {scan.platforms_worth_connecting
                .map((platform) => PLATFORM_NAMES[platform] ?? platform)
                .join(' or ')}{' '}
              and we can tell you what those devices actually used — and name them in your
              bill explanation, which we can’t do from the meter alone.
            </p>
          )}

          {scan.scan_was_shallow && (
            <p className="device-scan-footnote">
              This was a quick scan, so a device that was asleep may not have answered.
            </p>
          )}
        </>
      )}

      <p className="device-scan-footnote">
        Nothing found here is stored. Apple Home can’t be connected from a browser at all —
        Apple publishes no cloud service for it, so the phone app reads it locally and only
        ever sends daily totals.
      </p>
    </section>
  )
}
