export const controlClass = [
  "w-full min-w-0 bg-sunken border border-line rounded-sm text-ink",
  "tab-stop",
  "placeholder:text-ink-dim",
  "transition-[border-color,background,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]",
  "[&:hover:not(:disabled)]:border-line-strong",
  "focus:border-brand focus:shadow-[0_0_0_3px_var(--accent-dim)] focus:outline-none",
  "disabled:opacity-50 disabled:cursor-not-allowed",
  "[&[aria-invalid=true]]:border-danger",
  "[&[aria-invalid=true]]:focus:shadow-[0_0_0_3px_var(--danger-dim)]",
].join(" ")