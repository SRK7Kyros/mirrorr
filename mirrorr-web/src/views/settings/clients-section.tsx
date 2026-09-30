import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { HealthBanner } from "@/components/chrome/HealthBanner"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Dialog } from "@/components/ui/Dialog"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Fab } from "@/components/ui/Fab"
import { IconPlus } from "@/components/ui/icons"
import { Input } from "@/components/ui/Input"
import { SkeletonList } from "@/components/ui/Skeleton"
import { useToast } from "@/components/ui/Toast"
import { queryKeys, staleTimes } from "@/lib/query-keys"
import { formatDateTime, formatRelativeTime } from "@/lib/time"
import { useAuthState } from "@/hooks/use-auth-state"
import { apiErrorMessage } from "@/views/shared/api"
import { CopyButton, RouteLink } from "@/views/shared/parts"
import { createClient, deleteClient, fetchClients, type ClientRow } from "./settings-api"

/**
 * V13 API clients — neutral explainer banner first, table (name · created
 * relative+absolute · active badge · Revoke danger-text), New key dialog →
 * one-time reveal modal (mono well + Copy, "Shown once — store it now",
 * primary "I've saved it"), revoke via typed ConfirmDialog.
 */

const EXPLAINER =
  "Programmatic access keys — treat like passwords. Keys act as a non-human principal; resources they create belong to no user and fire no notifications."
const EMPTY_HEADLINE = "No API clients yet — create one for programmatic access"
const UNEXPECTED_RESPONSE = "Unexpected server response"
const REVEAL_TITLE = "New API key"

function AdminOnly() {
  return (
    <EmptyState
      headline="Admin only"
      body="API clients require an admin account."
      action={
        <RouteLink to="/settings" className="btn btn--primary">
          Account
        </RouteLink>
      }
    />
  )
}

interface RevealState {
  readonly name: string
  readonly apiKey: string
}

export function ClientsSection() {
  const { auth } = useAuthState()
  const admin = auth?.user?.role === "admin"
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const clientsQuery = useQuery({
    queryKey: queryKeys.clients,
    queryFn: fetchClients,
    staleTime: staleTimes.clients,
    enabled: admin,
  })

  const [newOpen, setNewOpen] = useState(false)
  const [keyName, setKeyName] = useState("")
  const [createBusy, setCreateBusy] = useState(false)
  const [reveal, setReveal] = useState<RevealState | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ClientRow | null>(null)
  const [revokeBusy, setRevokeBusy] = useState(false)

  const clients = clientsQuery.data ?? []

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
  }

  async function handleCreate(): Promise<void> {
    const name = keyName.trim()
    if (name === "") return
    setCreateBusy(true)
    try {
      const { client, apiKey } = await createClient(name)
      invalidate()
      setNewOpen(false)
      setKeyName("")
      setReveal({ name: client.name, apiKey })
    } catch (error) {
      // Payload V13: create errors → toast.
      toast({
        kind: "error",
        title: "Create failed",
        body: apiErrorMessage(error, UNEXPECTED_RESPONSE),
      })
    } finally {
      setCreateBusy(false)
    }
  }

  async function handleRevoke(): Promise<void> {
    if (revokeTarget === null) return
    setRevokeBusy(true)
    try {
      await deleteClient(revokeTarget.id)
      invalidate()
      setRevokeTarget(null)
    } catch (error) {
      toast({
        kind: "error",
        title: "Revoke failed",
        body: apiErrorMessage(error, UNEXPECTED_RESPONSE),
      })
      setRevokeTarget(null)
    } finally {
      setRevokeBusy(false)
    }
  }

  if (!admin) return <AdminOnly />

  return (
    <>
      <HealthBanner tone="api-client" message={EXPLAINER} />
      <div className="view-header">
        <h2 className="view-title">API clients</h2>
        <div className="view-header__actions">
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            New key
          </Button>
        </div>
      </div>

      {clientsQuery.isLoading ? <SkeletonList rows={5} /> : null}
      {clientsQuery.isError ? (
        <ErrorPanel
          title="Request failed"
          body={
            clientsQuery.error instanceof Error
              ? clientsQuery.error.message
              : UNEXPECTED_RESPONSE
          }
          actions={
            <Button variant="ghost" onClick={() => void clientsQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {!clientsQuery.isLoading && !clientsQuery.isError && clients.length === 0 ? (
        <EmptyState
          headline={EMPTY_HEADLINE}
          body=""
          action={
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              New key
            </Button>
          }
        />
      ) : null}

      {clients.length > 0 ? (
        <table className="entity-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Created</th>
              <th scope="col">Active</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((client) => {
              const active = client.is_active !== false
              return (
                <tr className="entity-row" key={client.id}>
                  <td data-col="name" className="cell-strong">
                    {client.name}
                  </td>
                  <td data-col="started">
                    {client.created_at != null ? (
                      <time
                        dateTime={client.created_at}
                        title={formatDateTime(client.created_at)}
                      >
                        {formatRelativeTime(client.created_at)}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-col="status">
                    <Badge variant={active ? "capability-true" : "capability"}>
                      {active ? "active" : "revoked"}
                    </Badge>
                  </td>
                  <td data-col="actions">
                    <Button variant="danger-text" onClick={() => setRevokeTarget(client)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}

      <Fab
        aria-label="New key"
        icon={<IconPlus size={24} />}
        onClick={() => setNewOpen(true)}
      />

      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New key"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={createBusy}
              disabled={keyName.trim() === ""}
              onClick={() => void handleCreate()}
            >
              Create
            </Button>
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreate()
          }}
          noValidate
        >
          <Input
            label="Key name"
            autoComplete="off"
            spellCheck={false}
            value={keyName}
            onChange={(event) => setKeyName(event.target.value)}
            required
            disabled={createBusy}
          />
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </Dialog>

      <Dialog
        open={reveal !== null}
        onClose={() => setReveal(null)}
        title={REVEAL_TITLE}
        footer={
          <Button variant="primary" onClick={() => setReveal(null)}>
            I&apos;ve saved it
          </Button>
        }
      >
        <div className="stack">
          <div className="cluster">
            <pre className="well t-mono settings-key">{reveal?.apiKey ?? ""}</pre>
            <CopyButton text={reveal?.apiKey ?? ""} />
          </div>
          <p className="settings-danger-note">Shown once — store it now</p>
        </div>
      </Dialog>

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevoke}
        title={`Revoke '${revokeTarget?.name ?? ""}'?`}
        body="This cannot be undone."
        confirmLabel="Revoke"
        tone="destructive"
        loading={revokeBusy}
        typedConfirm={{ phrase: revokeTarget?.name ?? "" }}
      />
    </>
  )
}
