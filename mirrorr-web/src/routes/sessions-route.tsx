import { createRoute } from "@tanstack/react-router"
import { MoreHorizontal, Play } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { Select } from "@/components/ui/Select"
import { StatusChip } from "@/components/ui/StatusChip"
import { Table, type TableColumn } from "@/components/ui/Table"
import { SESSION_STATUSES, STATUS_KEYS } from "@/lib/status-map"
import { authLayoutRoute } from "@/routes/auth-layout-route"

/**
 * Temporary Sessions home (default landing, spec L37). The real V3 view lands
 * in Wave 2; until then this placeholder mounts the real shipped primitives —
 * StatusChip, Button, Input/Select and Table — so the token e2e specs assert
 * through the components rather than a probe. The status fixture renders every
 * STATUS_MAP entry (nine chips) and is the screenshot fixture for the
 * all-statuses acceptance check.
 */

interface PreviewRow {
  readonly id: number
  readonly status: string
}

const PREVIEW_ROWS: readonly PreviewRow[] = [
  { id: 128, status: "recording" },
  { id: 127, status: "remuxing" },
  { id: 126, status: "completed" },
]

function previewColumns(): readonly TableColumn<PreviewRow>[] {
  return [
    {
      key: "id",
      header: "Session",
      render: (row) => <span className="font-mono text-small text-text-secondary">#{row.id}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusChip status={row.status} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (row) => (
        <Button
          variant="ghost"
          size="sm"
          icon={MoreHorizontal}
          iconSize="row"
          aria-label={`More actions for session #${row.id}`}
          title="More actions"
        />
      ),
    },
  ]
}

export const sessionsRoute = createRoute({
  getParentRoute: () => authLayoutRoute,
  path: "/sessions",
  component: SessionsPlaceholder,
})

function SessionsPlaceholder() {
  return (
    <main
      data-testid="sessions-placeholder"
      className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 bg-bg-base p-6"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold tracking-tight text-text-primary">Sessions</h1>
        <p className="text-body text-text-secondary">This view arrives in a later step.</p>
      </header>

      <section
        data-testid="status-fixture"
        aria-label="Status fixture"
        className="flex flex-wrap items-center gap-2"
      >
        {STATUS_KEYS.map((status) => (
          <StatusChip key={status} status={status} />
        ))}
      </section>

      <section aria-label="Control fixture" className="grid items-end gap-3 sm:grid-cols-[auto_1fr_1fr]">
        <Button icon={Play} aria-label="Start recording" title="Start recording" />
        <Input label="Search" placeholder="Search sessions" />
        <Select label="Status" defaultValue="active">
          {SESSION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </Select>
      </section>

      <Table
        label="Session fixture"
        columns={previewColumns()}
        rows={PREVIEW_ROWS}
        getRowKey={(row) => row.id}
      />
    </main>
  )
}
