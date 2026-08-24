export type ToggleOption<T extends string> = { value: T; label: string }

export type ToggleButtonsProps<T extends string> = {
  options: ToggleOption<T>[]
  value: T
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}

export default function ToggleButtons<T extends string>({ options, value, onChange, ariaLabel, className = '' }: ToggleButtonsProps<T>) {
  return (
    <div className={`toggle-buttons ${className}`.trim()} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          className={value === option.value ? 'active' : ''}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
