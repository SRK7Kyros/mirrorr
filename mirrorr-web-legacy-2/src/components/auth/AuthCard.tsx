import type { ReactNode } from "react"

interface AuthCardProps {
  readonly title: string
  readonly children: ReactNode
}

export function AuthCard({ title, children }: AuthCardProps) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg-base p-6">
      <div className="flex w-full max-w-[360px] flex-col gap-4 rounded-surface border border-border bg-bg-raised p-6">
        <h1 className="text-heading font-semibold tracking-tight text-text-primary">{title}</h1>
        {children}
      </div>
    </main>
  )
}
