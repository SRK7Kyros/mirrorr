import { useState, useRef, KeyboardEvent } from "react"
import { X, Plus } from "lucide-react"
import { cn } from "@/lib/utils"

interface TagInputProps {
  value: (string | number)[]
  onChange: (tags: (string | number)[]) => void
  placeholder?: string
  className?: string
  /** If set, validates numeric input */
  type?: "string" | "number" | "integer"
}

export function TagInput({ value = [], onChange, placeholder = "Add tag...", className, type = "string" }: TagInputProps) {
  const [input, setInput] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const addTag = () => {
    const trimmed = input.trim()
    if (!trimmed) return

    if (type === "number" || type === "integer") {
      const num = type === "integer" ? parseInt(trimmed, 10) : parseFloat(trimmed)
      if (isNaN(num)) return
      if (value.includes(num)) return
      onChange([...value, num])
    } else {
      if (value.includes(trimmed)) return
      onChange([...value, trimmed])
    }
    setInput("")
  }

  const removeTag = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addTag()
    } else if (e.key === "Backspace" && input === "" && value.length > 0) {
      removeTag(value.length - 1)
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 min-h-[32px] rounded-md border bg-transparent px-2 py-1 focus-within:ring-1 focus-within:ring-ring", className)}>
      {value.map((tag, i) => (
        <span key={`${tag}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-mono">
          {tag}
          <button type="button" onClick={() => removeTag(i)} className="rounded-full hover:bg-foreground/10 p-0.5">
            <X className="size-2.5" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[60px] bg-transparent text-xs outline-none placeholder:text-muted-foreground"
      />
    </div>
  )
}
