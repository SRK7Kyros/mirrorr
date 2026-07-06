/**
 * Reusable error banner for forms.
 * Used in login.tsx and register.tsx to avoid duplication.
 */

export function Banner({ message, variant = "error" }: { message: string; variant?: "error" | "success" }) {
  const styles = variant === "success"
    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
    : "border-destructive/30 bg-destructive/5 text-destructive"
  return (
    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm ${styles}`}>
      {message}
    </div>
  )
}
// Keep old names as aliases for backward compatibility
export const ErrorBanner = (props: { message: string }) => <Banner {...props} variant="error" />
export const SuccessBanner = (props: { message: string }) => <Banner {...props} variant="success" />
