/**
 * V13 — Settings: API clients (`/settings/clients`, admin).
 *
 * Contract: `docs/web-frontend-spec.md` L386-L393, `docs/general-client-specification.md`
 * §10.2, §13.7. The plaintext key exists only in the reveal modal and is never
 * stored client-side; revoke is confirmed by typing the client name.
 */
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Copy, Plus, Trash2 } from "lucide-react"
import { SettingsShell } from "@/components/settings/SettingsShell"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Dialog } from "@/components/ui/Dialog"
import { EmptyState, EMPTY_STATES } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { SkeletonRows } from "@/components/ui/SkeletonRows"
import { Table, type TableColumn } from "@/components/ui/Table"
import { usePollingPolicy } from "@/hooks/use-polling-policy"
import { copyText } from "@/lib/clipboard"
import { userMessageForError } from "@/lib/errors"
import { formatDateTime } from "@/lib/format"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import type { ApiClient } from "@/lib/schemas/auth"
import { createApiClient, deleteApiClient, fetchClients } from "@/lib/settings-api"
import { showToast } from "@/lib/toast"

export const API_CLIENTS_BANNER =
  "Programmatic access keys — treat like passwords. Keys act as a non-human principal; resources they create belong to no user and fire no notifications."
export const API_KEY_REVEAL_WARNING = "Shown once — store it now"
export const API_KEY_REVEAL_CONFIRM = "I've saved it"
const API_KEY_COPIED_MESSAGE = "API key copied"

interface RevealedKey {
  readonly client: ApiClient
  readonly apiKey: string
}

export function SettingsClientsView() {
  const queryClient = useQueryClient()
  const polling = usePollingPolicy("admin")
  const clientsQuery = useQuery({
    queryKey: queryKeys.clients(),
    queryFn: fetchClients,
    staleTime: QUERY_STALE_TIMES_MS.clients,
    refetchInterval: polling.refetchInterval,
    refetchOnWindowFocus: polling.refetchOnWindowFocus,
  })
  const clients = clientsQuery.data ?? []

  const [createOpen, setCreateOpen] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [name, setName] = useState("")
  const [revealed, setRevealed] = useState<RevealedKey | null>(null)
  const [pendingRevoke, setPendingRevoke] = useState<ApiClient | null>(null)
  const [revokePending, setRevokePending] = useState(false)

  function openCreate() {
    setName("")
    setCreateOpen(true)
  }

  async function submitCreate() {
    const trimmedName = name.trim()
    if (trimmedName.length === 0) return

    setCreatePending(true)
    try {
      const created = await createApiClient(trimmedName)
      queryClient.setQueryData<ApiClient[]>(queryKeys.clients(), (current) =>
        current === undefined ? [created.client] : [...current, created.client],
      )
      setCreateOpen(false)
      setRevealed(created)
    } catch (error) {
      showToast(userMessageForError(error), "error")
    } finally {
      setCreatePending(false)
    }
  }

  async function copyRevealedKey() {
    const apiKey = revealed?.apiKey
    if (apiKey === undefined) return

    const copied = await copyText(apiKey)
    showToast(copied ? API_KEY_COPIED_MESSAGE : "Could not copy the key", copied ? "info" : "error")
  }

  async function confirmRevoke() {
    const target = pendingRevoke
    if (target === null) return

    setRevokePending(true)
    try {
      await deleteApiClient(target.id)
      await queryClient.invalidateQueries({ queryKey: queryKeys.clients() })
      showToast(`Revoked ${target.name}`, "info")
      setPendingRevoke(null)
    } catch (error) {
      showToast(userMessageForError(error), "error")
    } finally {
      setRevokePending(false)
    }
  }

  if (clientsQuery.isPending) {
    return <SkeletonRows count={3} label="Loading API clients" />
  }

  if (clientsQuery.isError) {
    return (
      <ErrorPanel
        message={userMessageForError(clientsQuery.error)}
        onRetry={() => {
          void clientsQuery.refetch()
        }}
      />
    )
  }

  const columns: ReadonlyArray<TableColumn<ApiClient>> = [
    {
      key: "name",
      header: "Name",
      render: (client) => <span className="text-text-primary">{client.name}</span>,
    },
    {
      key: "created_at",
      header: "Created",
      render: (client) => (
        <span className="text-text-secondary">
          {client.created_at == null ? "—" : formatDateTime(client.created_at)}
        </span>
      ),
    },
    {
      key: "is_active",
      header: "Active",
      render: (client) => (
        <span data-testid="client-active" className="text-text-secondary">
          {client.is_active === false ? "Inactive" : "Active"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (client) => (
        <span className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            iconSize="row"
            onClick={() => setPendingRevoke(client)}
          >
            Revoke
          </Button>
        </span>
      ),
    },
  ]

  return (
    <SettingsShell testId="settings-clients-view" active="clients">
      <div className="flex items-start justify-between gap-4">
        <p
          data-testid="api-clients-banner"
          className="max-w-prose rounded-surface border border-info/30 bg-info/12 px-3 py-2 text-body text-info"
        >
          {API_CLIENTS_BANNER}
        </p>
        <Button variant="primary" icon={Plus} onClick={openCreate}>
          New key
        </Button>
      </div>

      {clients.length === 0 ? (
        <EmptyState title={EMPTY_STATES.apiClients} />
      ) : (
        <Table label="API clients" columns={columns} rows={clients} getRowKey={(client) => client.id} />
      )}

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New API key"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={createPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={createPending}
              onClick={() => {
                void submitCreate()
              }}
            >
              Create key
            </Button>
          </>
        }
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void submitCreate()
          }}
          noValidate
        >
          <Input
            label="Name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <p className="text-small text-text-muted">A label for your own reference, e.g. "ci-deploy".</p>
        </form>
      </Dialog>

      <Dialog
        open={revealed !== null}
        onClose={() => setRevealed(null)}
        title="API key created"
        footer={
          <Button variant="primary" onClick={() => setRevealed(null)}>
            {API_KEY_REVEAL_CONFIRM}
          </Button>
        }
      >
        <div data-testid="api-key-reveal" className="flex flex-col gap-3">
          <p className="flex items-center gap-2 rounded-control border border-danger/30 bg-danger/12 px-3 py-2 text-body text-danger-chip-text">
            <AlertTriangle aria-hidden="true" strokeWidth={2} className="size-[var(--icon-row)] shrink-0" />
            {API_KEY_REVEAL_WARNING}
          </p>
          <div className="flex items-center gap-2 rounded-control border border-border bg-bg-inset p-2">
            <code
              data-testid="api-key-value"
              className="min-w-0 flex-1 overflow-x-auto font-mono text-body text-text-primary select-all"
            >
              {revealed?.apiKey ?? ""}
            </code>
            <Button
              icon={Copy}
              aria-label="Copy key"
              title="Copy key"
              onClick={() => {
                void copyRevealedKey()
              }}
            />
          </div>
          <p className="text-small text-text-muted">
            This key is not stored in your browser and cannot be shown again.
          </p>
        </div>
      </Dialog>

      <ConfirmDialog
        open={pendingRevoke !== null}
        title="Revoke API key"
        body={
          <p>
            Revoke <span className="text-text-primary">{pendingRevoke?.name ?? ""}</span>. Any client
            using this key loses access immediately.
          </p>
        }
        confirmLabel="Revoke key"
        typedConfirmation={pendingRevoke?.name}
        pending={revokePending}
        onConfirm={() => {
          void confirmRevoke()
        }}
        onCancel={() => setPendingRevoke(null)}
      />
    </SettingsShell>
  )
}
