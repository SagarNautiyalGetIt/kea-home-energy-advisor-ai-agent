import { ArrowDown, ArrowUp, CalendarDays, ChevronDown } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import './DatePicker.css'

type DatePickerProps = { label: string; value: string; onChange: (value: string) => void; className?: string }

// Dates are 'YYYY-MM-DD' strings, as the input and the API pass them, worked on as calendar
// days in local time so that no time zone can move one across midnight.
const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const fromIso = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year!, month! - 1, day!)
}
const addDays = (iso: string, days: number) => {
  const date = fromIso(iso)
  date.setDate(date.getDate() + days)
  return toIso(date)
}
/** The same day of another month, or that month's last day if it is shorter. */
const addMonths = (iso: string, months: number) => {
  const date = fromIso(iso)
  const day = date.getDate()
  date.setDate(1)
  date.setMonth(date.getMonth() + months)
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()))
  return toIso(date)
}

// Sunday first, as the browser's own calendar laid the week out here.
const WEEKDAYS = [['S', 'Sunday'], ['M', 'Monday'], ['T', 'Tuesday'], ['W', 'Wednesday'], ['T', 'Thursday'], ['F', 'Friday'], ['S', 'Saturday']]
const longDate = new Intl.DateTimeFormat('en-NZ', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const monthTitle = new Intl.DateTimeFormat('en-NZ', { month: 'long', year: 'numeric' })
const monthShort = new Intl.DateTimeFormat('en-NZ', { month: 'short' })

/**
 * A date field whose calendar is the site's own. The field is still the browser's
 * `<input type="date">`, labelled as before, so a date can be typed in and the e2e suite fills
 * it as it always has; only the calendar that drops from it is replaced, because the
 * browser draws its own (a grey sheet in Chrome's dark mode) where no stylesheet can reach.
 *
 * The replacement does what that one did: the month and year as a button that opens a
 * month chooser, up and down for the previous and next month, Clear and Today. It is a
 * non-modal dialog under the field. Opening it puts the keyboard on the chosen day; the
 * arrows move a day or a week, Home and End to the ends of the week, Page Up and Page Down a
 * month (with Shift, a year), Enter picks, and Escape closes it back onto the calendar button.
 * Alt+Down in the field opens it too. A click outside, or tabbing out, closes it.
 */
export default function DatePicker({ label, value, onChange, className = '' }: DatePickerProps) {
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  // Set when the keyboard should follow the focused day: on opening and on arrow keys, but
  // not when the month buttons are clicked, which keep focus themselves.
  const focusGrid = useRef(false)
  const [open, setOpen] = useState(false)
  const [choosingMonth, setChoosingMonth] = useState(false)
  // The day the keyboard is on; the month shown is the month it falls in.
  const [focusDay, setFocusDay] = useState(value)
  const today = toIso(new Date())

  const show = () => {
    focusGrid.current = true
    setFocusDay(value || today)
    setChoosingMonth(false)
    setOpen(true)
  }
  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) toggleRef.current?.focus()
  }
  const pick = (day: string) => {
    onChange(day)
    close(true)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open || choosingMonth || !focusGrid.current) return
    focusGrid.current = false
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusDay}"]`)?.focus()
  }, [open, choosingMonth, focusDay])

  const onGridKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const weekday = fromIso(focusDay).getDay()
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      Home: () => addDays(focusDay, -weekday),
      End: () => addDays(focusDay, 6 - weekday),
      PageUp: () => addMonths(focusDay, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDay, event.shiftKey ? 12 : 1),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    focusGrid.current = true
    setFocusDay(move())
  }

  const shown = fromIso(focusDay || today)
  const first = new Date(shown.getFullYear(), shown.getMonth(), 1)
  // Six weeks from the Sunday on or before the 1st, so the calendar never changes height.
  const start = toIso(new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay()))
  const weeks = Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, day) => addDays(start, week * 7 + day)))
  const chosen = value ? fromIso(value) : null
  const now = new Date()

  return (
    <div
      ref={rootRef}
      className={`date-picker ${className}`.trim()}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.stopPropagation()
          close(true)
        }
      }}
      onBlur={(event) => {
        // A click on the calendar's own padding blurs to nothing; only a real move out closes it.
        if (open && event.relatedTarget && !rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false)
      }}
    >
      <label htmlFor={`${id}-input`} className="date-picker-label">{label}</label>
      <input
        id={`${id}-input`}
        type="date"
        className="date-picker-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.altKey && event.key === 'ArrowDown') {
            event.preventDefault()
            show()
          }
        }}
      />
      <button
        ref={toggleRef}
        type="button"
        className="date-picker-toggle"
        aria-label={`Choose ${label.toLowerCase()} from a calendar`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close(false) : show())}
      >
        <CalendarDays aria-hidden="true"/>
      </button>
      {open && (
        <div className="date-picker-popover" role="dialog" aria-label={`Choose ${label.toLowerCase()}`}>
          <div className="date-picker-head">
            <button
              type="button"
              id={`${id}-month`}
              className="date-picker-title"
              aria-expanded={choosingMonth}
              onClick={() => setChoosingMonth(!choosingMonth)}
            >
              {choosingMonth ? first.getFullYear() : monthTitle.format(first)}
              <ChevronDown aria-hidden="true"/>
            </button>
            <div className="date-picker-nav">
              <button type="button" aria-label={choosingMonth ? 'Previous year' : 'Previous month'}
                onClick={() => setFocusDay(addMonths(focusDay || today, choosingMonth ? -12 : -1))}><ArrowUp aria-hidden="true"/></button>
              <button type="button" aria-label={choosingMonth ? 'Next year' : 'Next month'}
                onClick={() => setFocusDay(addMonths(focusDay || today, choosingMonth ? 12 : 1))}><ArrowDown aria-hidden="true"/></button>
            </div>
          </div>
          {choosingMonth ? (
            <div className="date-picker-months">
              {Array.from({ length: 12 }, (_, month) => {
                const at = new Date(first.getFullYear(), month, 1)
                const classes = ['date-picker-month',
                  at.getFullYear() === now.getFullYear() && month === now.getMonth() && 'is-today',
                  chosen && at.getFullYear() === chosen.getFullYear() && month === chosen.getMonth() && 'is-selected'].filter(Boolean).join(' ')
                return (
                  <button key={month} type="button" className={classes} aria-label={monthTitle.format(at)}
                    onClick={() => {
                      // Shows that month; like the browser's month list, it doesn't change the date.
                      focusGrid.current = true
                      setFocusDay(addMonths(focusDay || today, (at.getFullYear() - first.getFullYear()) * 12 + month - first.getMonth()))
                      setChoosingMonth(false)
                    }}>
                    {monthShort.format(at)}
                  </button>
                )
              })}
            </div>
          ) : (
            <div ref={gridRef} className="date-picker-grid" role="grid" aria-labelledby={`${id}-month`} onKeyDown={onGridKey}>
              <div className="date-picker-weekdays" role="row">
                {WEEKDAYS.map(([letter, name]) => <span key={name} role="columnheader" aria-label={name}>{letter}</span>)}
              </div>
              {weeks.map((week) => (
                <div key={week[0]} className="date-picker-week" role="row">
                  {week.map((day) => {
                    const classes = ['date-picker-day', fromIso(day).getMonth() !== first.getMonth() && 'is-outside',
                      day === today && 'is-today', day === value && 'is-selected'].filter(Boolean).join(' ')
                    return (
                      <span key={day} role="gridcell" aria-selected={day === value}>
                        <button
                          type="button"
                          className={classes}
                          data-day={day}
                          tabIndex={day === (focusDay || today) ? 0 : -1}
                          aria-label={longDate.format(fromIso(day))}
                          aria-current={day === today ? 'date' : undefined}
                          onClick={() => pick(day)}
                        >
                          {fromIso(day).getDate()}
                        </button>
                      </span>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
          <div className="date-picker-foot">
            <button type="button" className="date-picker-action" onClick={() => pick('')}>Clear</button>
            <button type="button" className="date-picker-action" onClick={() => pick(today)}>Today</button>
          </div>
        </div>
      )}
    </div>
  )
}
