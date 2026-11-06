import { useId, useState } from "react"
import { cn } from "@/ui/lib/cn"
import { Input, type InputProps } from "./Input"
import { IconEye, IconEyeOff } from "./icons"

/**
 * A password field with a reveal toggle.
 *
 * The toggle is a real 44 px target *inside* the field rather than a link
 * beside it, and it reports `aria-pressed` so a screen reader hears "Show
 * password, toggle button, pressed" instead of an unlabelled glyph. Revealing
 * is a local concern — it must never re-render the form or lose its value.
 */
export function PasswordInput({ className, id, ...rest }: InputProps) {
  const [revealed, setRevealed] = useState(false)
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className="relative">
      <Input
        {...rest}
        id={inputId}
        type={revealed ? "text" : "password"}
        className={cn("pr-12", className)}
      />
      <button
        type="button"
        className="tab-stop absolute inset-y-0 right-0 grid w-11 place-content-center rounded-sm text-ink-dim hover:text-ink focus-visible:text-ink"
        aria-label={revealed ? "Hide password" : "Show password"}
        aria-pressed={revealed}
        aria-controls={inputId}
        onClick={() => setRevealed((current) => !current)}
      >
        {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </button>
    </div>
  )
}
