interface AuthFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly type?: "text" | "password"
  readonly autoComplete?: string
  readonly error?: string | undefined
}

export function AuthField({
  id,
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  error,
}: AuthFieldProps) {
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-medium text-text-secondary">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        value={value}
        autoComplete={autoComplete}
        aria-invalid={error !== undefined}
        aria-describedby={error === undefined ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 rounded-control border border-border bg-bg-inset px-2 text-body text-text-primary outline-none transition-colors focus:border-border-strong"
      />
      {error === undefined ? null : (
        <p id={errorId} data-testid={errorId} className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
