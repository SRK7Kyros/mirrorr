import { useId, useRef, useState, type DragEvent } from "react"
import { formatBytes } from "@/api/time"
import { cn } from "@/ui/lib/cn"
import { IconUpload, IconX } from "./icons"

export interface FilePickerProps {
  /** Called with the chosen file, from a click or a drop. */
  readonly onFile: (file: File) => void
  /** Clears the staged file; the "Remove" action renders only when provided. */
  readonly onClear?: () => void
  readonly fileName?: string | null
  readonly fileSize?: number | null
  readonly accept?: string
  readonly disabled?: boolean
  /** Accessible name for the file input (default "Choose a file"). */
  readonly label?: string
}

/**
 * Drag-and-drop file picker — a dashed drop zone backed by a visually-hidden
 * native input. The zone is a `<label>`, so a click opens the dialog natively
 * and keyboard activation works via the input it labels.
 */
export function FilePicker({
  onFile,
  onClear,
  fileName,
  fileSize,
  accept,
  disabled = false,
  label = "Choose a file",
}: FilePickerProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const hasFile = fileName !== undefined && fileName !== null

  const drop = (event: DragEvent<HTMLLabelElement>): void => {
    event.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = event.dataTransfer.files.item(0)
    if (file !== null) onFile(file)
  }

  return (
    <div className="flex flex-col gap-1">
      <label
        className={cn(
          "relative flex flex-col items-center justify-center gap-1 px-4 py-5 border border-dashed rounded-md text-center",
          "transition-[border-color,background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
          "hover:border-[color:var(--accent-line)] hover:bg-surface-1 hover:text-ink",
          "focus-visible:outline-none focus-visible:border-[color:var(--accent-line)] focus-visible:shadow-ring",
          dragging
            ? "border-[color:var(--accent)] bg-[var(--accent-dim)] text-ink"
            : "border-line-strong bg-sunken text-ink-muted",
          disabled ? "cursor-not-allowed" : "cursor-pointer",
          disabled && "opacity-50",
        )}
        htmlFor={id}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        }}
        onDrop={drop}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
      >
        <span className={hasFile ? "text-brand" : "text-ink-dim"} aria-hidden="true">
          <IconUpload size={20} />
        </span>
        {hasFile ? (
          <>
            <span className="font-medium text-ink break-all">{fileName}</span>
            {fileSize !== undefined && fileSize !== null ? (
              <span className="text-xs text-ink-dim">{formatBytes(fileSize)}</span>
            ) : null}
            <span className="text-xs text-ink-dim">Click or drop to replace</span>
          </>
        ) : (
          <>
            <span className="font-medium text-ink break-all">Drop a file here</span>
            <span className="text-xs text-ink-dim">or click to browse</span>
          </>
        )}
        <input
          ref={inputRef}
          id={id}
          className="sr-only"
          type="file"
          accept={accept}
          disabled={disabled}
          aria-label={label}
          onChange={(event) => {
            const file = event.target.files?.item(0)
            event.target.value = ""
            if (file !== null && file !== undefined) onFile(file)
          }}
        />
      </label>
      {hasFile && onClear !== undefined ? (
        <button
          type="button"
          className="self-start inline-flex items-center gap-1 text-xs text-ink-dim transition-[color] duration-[var(--dur-fast)] ease-[var(--ease-out)] hover:text-danger"
          onClick={onClear}
          disabled={disabled}
        >
          <IconX size={13} />
          Remove
        </button>
      ) : null}
    </div>
  )
}
