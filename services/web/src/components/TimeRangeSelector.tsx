import ToggleButtons from './ToggleButtons'

export type TimeRange = 'Daily' | 'Weekly' | 'Monthly'

export type TimeRangeSelectorProps = {
  value: TimeRange
  onChange: (value: TimeRange) => void
  options?: TimeRange[]
}

export default function TimeRangeSelector({ value, onChange, options = ['Daily', 'Weekly', 'Monthly'] }: TimeRangeSelectorProps) {
  return (
    <ToggleButtons
      className="time-range-selector"
      ariaLabel="Usage time range"
      options={options.map((option) => ({ value: option, label: option }))}
      value={value}
      onChange={onChange}
    />
  )
}
