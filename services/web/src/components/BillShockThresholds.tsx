import { BellRing, Mail, MessageSquare, Phone, TriangleAlert, WifiOff } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import {
  CHANNEL_LABEL,
  TIER_OPTIONS,
  getAlertPreferences,
  ladderError,
  saveAlertPreferences,
  thresholdInDollars,
  withThreshold,
  type AlertPreferences,
  type Tier,
} from '../lib/alerts'

/**
 * Where the customer sets how far over their bill has to be tracking before we
 * interrupt them, and on which channel.
 *
 * The design decision worth knowing: **each tier shows its threshold in dollars as well
 * as a percentage.** 71.4% of surveyed customers asked for the bill-shock warning in
 * dollars, and a settings screen expressed only in percent asks them to do the
 * conversion themselves — on the one screen where getting it wrong means never hearing
 * from us. The dollar figure disappears rather than being estimated when there is no
 * expectation to apply it to; a fabricated figure on a settings screen is the same
 * offence as one in an answer.
 *
 * The confidence floors are deliberately absent. See lib/alerts.ts.
 */

const TIER_ICON: Record<Tier, typeof Mail> = { 1: Mail, 2: MessageSquare, 3: Phone }

const TIER_NOTE: Record<Tier, string> = {
  1: 'Always in writing, so you have a record.',
  2: 'Interrupts your day — set this higher than the email.',
  3: 'Sparky calls you. Off unless you turn it on.',
}

const HOURS = Array.from({ length: 24 }, (_, hour) => ({
  value: hour,
  label: new Intl.DateTimeFormat('en-NZ', { hour: 'numeric' }).format(new Date(2020, 0, 1, hour)),
}))

/**
 * The section's heading. The master switch lives here, beside the title, because it turns
 * the whole section on and off: with it off, no alert is sent on any channel, whatever
 * the levels and quiet hours below say (the API's alert policy checks it first).
 */
export function BillShockHeading({ control }: { control?: ReactNode }) {
  return (
    <div className="settings-section-title bill-shock-title">
      <BellRing />
      <div>
        <h2>Bill-shock alerts</h2>
        <p>
          You choose how far over your bill has to be tracking before we get in touch, and
          how. Turning this off stops the messages; the warning still shows in the app.
        </p>
      </div>
      {control}
    </div>
  )
}

type Props = {
  customerId: string
  /** What this cycle would normally come to, from the bill-shock response. Null until it
   *  loads, or when the household has no baseline — in which case no dollar figure is
   *  shown rather than a guessed one. */
  expectedCostNzd?: number | null
  onToast: (message: string) => void
}

export default function BillShockThresholds({ customerId, expectedCostNzd = null, onToast }: Props) {
  const [prefs, setPrefs] = useState<AlertPreferences | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  // What the server last confirmed. The offline switch saves on top of this, not on top of
  // `prefs`, so an unsaved threshold edit is neither saved nor lost when it is flipped.
  const [saved, setSaved] = useState<AlertPreferences | null>(null)

  useEffect(() => {
    let live = true
    getAlertPreferences(customerId)
      .then((loaded) => {
        if (!live) return
        setPrefs(loaded)
        setSaved(loaded)
      })
      .catch((error: Error) => live && setLoadError(error.message))
    return () => {
      live = false
    }
  }, [customerId])

  const update = (next: AlertPreferences) => {
    setPrefs(next)
    setDirty(true)
  }

  const save = async () => {
    if (!prefs) return
    setSaving(true)
    try {
      const result = await saveAlertPreferences(customerId, prefs)
      setPrefs(result)
      setSaved(result)
      setDirty(false)
      onToast('Alert settings saved')
    } catch (error) {
      // Never report success on a failed save. A customer who believes they will be told
      // at 25% and will not is the worst version of this feature.
      onToast(`Could not save: ${(error as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  // "Interest in offline Sparky" sits below the Save button, apart from the alert
  // settings it has nothing to do with, so it saves the moment it is flipped, like the
  // other switches on this page.
  const saveOffline = async (on: boolean) => {
    if (!saved) return
    setPrefs((current) => current && { ...current, offline_model_opt_in: on })
    try {
      setSaved(await saveAlertPreferences(customerId, { ...saved, offline_model_opt_in: on }))
      onToast(on ? 'Offline Sparky interest saved' : 'Offline Sparky interest removed')
    } catch (error) {
      setPrefs((current) => current && { ...current, offline_model_opt_in: !on })
      onToast(`Could not save: ${(error as Error).message}`)
    }
  }

  const masterSwitch = (
    <input
      type="checkbox"
      role="switch"
      aria-label="Bill-shock alerts"
      aria-checked={prefs?.enabled ?? false}
      checked={prefs?.enabled ?? false}
      disabled={!prefs}
      onChange={(event) => prefs && update({ ...prefs, enabled: event.target.checked })}
    />
  )

  if (loadError) {
    return (
      <>
        <BillShockHeading />
        <p className="settings-inline-error" role="alert">
          <TriangleAlert aria-hidden="true" /> Could not load your alert settings: {loadError}
        </p>
      </>
    )
  }
  if (!prefs) {
    return (
      <>
        <BillShockHeading control={masterSwitch} />
        <p className="settings-loading">Loading your alert settings…</p>
      </>
    )
  }

  const ladder = ladderError(prefs)

  return (
    <>
    <BillShockHeading control={masterSwitch} />
    <div className="threshold-editor">
      {/* Everything the master switch governs, greyed out together when it is off:
          Alert messages (the channels and their levels), Never alert me under, and
          Quiet hours. */}
      <fieldset className="threshold-ladder" disabled={!prefs.enabled} aria-label="Bill-shock alert settings">
        <div className="setting-row threshold-group-head">
          <span>
            <strong>Alert messages</strong>
            <small>How we tell you, and how far over is far enough.</small>
          </span>
        </div>

        {/* The three channels are wrapped and indented rather than left as siblings of
            the master switch. They only exist as ways of delivering a bill-shock alert,
            and a flat list read as three unrelated settings that happened to sit under
            a heading — several people asked what the email toggle at the top had to do
            with the call toggle at the bottom. */}
        <div className="threshold-channels">
        {([1, 2, 3] as Tier[]).map((tier) => {
          const pct = tier === 1 ? prefs.tier1_pct : tier === 2 ? prefs.tier2_pct : prefs.tier3_pct
          const channelOn =
            tier === 1 ? prefs.email_enabled : tier === 2 ? prefs.sms_enabled : prefs.voice_enabled
          const dollars = thresholdInDollars(pct, expectedCostNzd)
          const Icon = TIER_ICON[tier]

          return (
            <div className={`threshold-row${channelOn ? '' : ' channel-off'}`} key={tier}>
              <div className="threshold-head">
                <span className="threshold-channel">
                  <Icon aria-hidden="true" />
                  <strong>{CHANNEL_LABEL[tier]}</strong>
                </span>
                {/* A switch, not a tick. A tick reads as "this is selected"; these turn a
                    way of contacting somebody on and off, which is a state, not a choice
                    from a set. The master control above was already a switch and the
                    three under it were not, which made them look like a different kind
                    of setting. */}
                <span className="channel-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-checked={channelOn}
                    aria-label={`${CHANNEL_LABEL[tier]} alerts`}
                    checked={channelOn}
                    onChange={(event) =>
                      update({
                        ...prefs,
                        ...(tier === 1
                          ? { email_enabled: event.target.checked }
                          : tier === 2
                            ? { sms_enabled: event.target.checked }
                            : { voice_enabled: event.target.checked }),
                      })
                    }
                  />
                </span>
              </div>

              {/* A saved value can sit off this scale — the ladder used to be a 5-200%
                  slider, and the stored defaults were 15 and 75. It is shown as its own
                  option rather than snapped to the nearest step, because silently moving
                  somebody's alert threshold on page load is a change they never made to a
                  setting whose whole job is to fire when they expect it to. */}
              <div
                className="threshold-choices"
                role="radiogroup"
                aria-label={`${CHANNEL_LABEL[tier]} threshold, percent above normal`}
              >
                {(TIER_OPTIONS[tier].includes(pct)
                  ? TIER_OPTIONS[tier]
                  : [...TIER_OPTIONS[tier], pct].sort((a, b) => a - b)
                ).map((option) => (
                  <label
                    key={option}
                    className={`threshold-choice${option === pct ? ' selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name={`threshold-tier-${tier}`}
                      value={option}
                      checked={option === pct}
                      aria-label={
                        thresholdInDollars(option, expectedCostNzd) === null
                          ? `${option} percent above normal`
                          : `${option} percent above normal, about $${thresholdInDollars(option, expectedCostNzd)}`
                      }
                      onChange={() => update(withThreshold(prefs, tier, option))}
                    />
                    <span>{option}%</span>
                  </label>
                ))}
              </div>

              <p className="threshold-value">
                <strong>{pct}% above normal</strong>
                {dollars !== null && <span> — about ${dollars} for this cycle</span>}
              </p>
              <small className="threshold-note">{TIER_NOTE[tier]}</small>
            </div>
          )
        })}
        </div>

        {ladder && (
          <p className="settings-inline-error" role="alert">
            <TriangleAlert aria-hidden="true" /> {ladder}
          </p>
        )}

        <label className="setting-row">
          <span>
            <strong>Never alert me under</strong>
            <small>
              A percentage on its own fires constantly on small bills. This is the dollar
              floor underneath every level above.
            </small>
          </span>
          <span className="threshold-money-input">
            $
            <input
              type="number"
              min={0}
              max={500}
              step={5}
              value={prefs.min_overshoot_nzd}
              aria-label="Minimum overshoot in dollars"
              onChange={(event) =>
                update({ ...prefs, min_overshoot_nzd: Number(event.target.value) })
              }
            />
          </span>
        </label>

        <div className="setting-row">
          <span>
            <strong>Quiet hours</strong>
            <small>
              Texts and calls wait until the morning. Emails still arrive — they do not
              make a sound.
            </small>
          </span>
          <span className="threshold-quiet" aria-label="Quiet hours schedule">
            <label>
              <small>From</small>
              <select
              value={prefs.quiet_hours_start ?? 21}
              aria-label="Quiet hours start"
              onChange={(event) =>
                update({ ...prefs, quiet_hours_start: Number(event.target.value) })
              }
              >{HOURS.map((hour) => <option key={hour.value} value={hour.value}>{hour.label}</option>)}</select>
            </label>
            <span className="quiet-hours-arrow" aria-hidden="true">to</span>
            <label>
              <small>Until</small>
              <select
              value={prefs.quiet_hours_end ?? 8}
              aria-label="Quiet hours end"
              onChange={(event) =>
                update({ ...prefs, quiet_hours_end: Number(event.target.value) })
              }
              >{HOURS.map((hour) => <option key={hour.value} value={hour.value}>{hour.label}</option>)}</select>
            </label>
          </span>
        </div>
      </fieldset>

      <div className="threshold-actions">
        <button
          type="button"
          className="primary-action"
          disabled={!dirty || saving || Boolean(ladder)}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save alert settings'}
        </button>
      </div>

      <label className="setting-row setting-standalone offline-answers">
        <WifiOff aria-hidden="true" />
        <span>
          <strong>Interest in offline Sparky</strong>
          <small>
            Save your preference for a future offline release. This build does not
            download a model or answer without a connection.
          </small>
        </span>
        <input
          type="checkbox"
          checked={prefs.offline_model_opt_in}
          onChange={(event) => void saveOffline(event.target.checked)}
        />
      </label>
    </div>
    </>
  )
}
