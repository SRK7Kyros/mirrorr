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
    <div className="file-picker">
      <label
        className={cn(
          "file-drop",
          dragging && "file-drop-active",
          disabled && "file-drop-disabled",
          hasFile && "file-drop-has-file",
        )}
        htmlFor={id}
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        onDragOver={(event) => {
          event.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
        onKeyDown={(event) => {
          if (disabled) return
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
      >
        <span className="file-drop-icon" aria-hidden="true">
          <IconUpload size={20} />
        </span>
        {hasFile ? (
          <>
            <span className="file-drop-name">{fileName}</span>
            {fileSize !== undefined && fileSize !== null ? (
              <span className="file-drop-meta">{formatBytes(fileSize)}</span>
            ) : null}
            <span className="file-drop-cta">Click or drop to replace</span>
          </>
        ) : (
          <>
            <span className="file-drop-name">Drop a file here</span>
            <span className="file-drop-cta">or click to browse</span>
          </>
        )}
        <input
          ref={inputRef}
          id={id}
          className="file-input"
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
        <button type="button" className="file-picker-clear" onClick={onClear} disabled={disabled}>
          <IconX size={13} />
          Remove
        </button>
      ) : null}
    </div>
  )
}
