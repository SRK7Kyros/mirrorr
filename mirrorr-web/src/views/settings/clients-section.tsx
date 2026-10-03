import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Dialog } from "@/components/ui/Dialog"
import { EmptyState } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/Table"
import { useToast } from "@/components/ui/Toast"
import { queryKeys } from "@/lib/query-keys"
import { formatDateTime } from "@/lib/time"
import { createClient, deleteClient, fetchClients, type ClientRow } from "./settings-api"
import { getErrorMessage } from "./settings-util"
import "@/styles/views-admin.css"

const KEY_BANNER = "Programmatic access key — treat like a password."
const KEY_ONCE = "This key is shown once. Copy it now — it cannot be retrieved again."

/** §5.11 Settings — API clients (admin). Create returns a plaintext key ONCE. */
export function ClientsSection() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const clientsQuery = useQuery({ queryKey: queryKeys.clients, queryFn: fetchClients })
  const [createOpen, setCreateOpen] = useState(false)
  const [revealed, setRevealed] = useState<{ name: string; key: string } | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<ClientRow | null>(null)

  const clients = clientsQuery.data ?? []

  const revokeMutation = useMutation({
    mutationFn: (id: number) => deleteClient(id),
    onSuccess: () => {
      toast.toast({ kind: "success", title: "Key revoked" })
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
      setRevokeTarget(null)
    },
    onError: (error: unknown) => {
      toast.toast({ kind: "error", title: getErrorMessage(error, "Could not revoke the key") })
    },
  })

  return (
    <div className="settings-panel panel opaque">
      <div className="adm-panel__head">
        <div className="adm-stack">
          <h2 className="t-h3">API clients</h2>
          <p className="t-body adm-muted adm-measure">
            Non-human principals with owner-scoped access; they poll every 10s.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          Create key
        </Button>
      </div>

      <div className="adm-banner" role="note">
        <span className="adm-banner__title">{KEY_BANNER}</span>
      </div>

      {clientsQuery.isError ? (
        <ErrorPanel
          title="Cannot load API clients"
          actions={
            <Button variant="secondary" onClick={() => void clientsQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <Table label="API clients">
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody
            loading={clientsQuery.isLoading}
            columns={4}
            empty={
              <EmptyState
                eyebrow="API clients"
                headline="No API clients."
                body="An API key acts as a non-human principal with owner-scoped access."
              />
            }
          >
            {clients.map((client) => (
              <TableRow key={client.id}>
                <TableCell>{client.name}</TableCell>
                <TableCell>
                  <Badge variant={client.is_active === false ? "tag" : "capability-true"}>
                    {client.is_active === false ? "revoked" : "active"}
                  </Badge>
                </TableCell>
                <TableCell mono>{client.created_at != null ? formatDateTime(client.created_at) : "—"}</TableCell>
                <TableCell>
                  <Button variant="danger-text" onClick={() => setRevokeTarget(client)}>
                    Revoke
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <CreateClientDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(name, key) => setRevealed({ name, key })}
      />

      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => {
          if (revokeTarget !== null) revokeMutation.mutate(revokeTarget.id)
        }}
        title="Revoke this key?"
        body="Anything using it loses access."
        confirmLabel="Revoke key"
        tone="destructive"
        loading={revokeMutation.isPending}
      />

      {revealed !== null ? (
        <KeyRevealDialog
          key={revealed.key}
          name={revealed.name}
          value={revealed.key}
          onClose={() => setRevealed(null)}
        />
      ) : null}
    </div>
  )
}

function CreateClientDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (name: string, key: string) => void
}) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const close = (): void => {
    setName("")
    setError(null)
    onClose()
  }

  const submit = async (): Promise<void> => {
    if (submitting || name === "") return
    setSubmitting(true)
    setError(null)
    try {
      const { apiKey } = await createClient(name)
      toast.toast({ kind: "success", title: "Key created" })
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
      onCreated(name, apiKey)
      close()
    } catch (caught) {
      setError(getErrorMessage(caught, "Could not create the key"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      key={open ? "create-client-open" : "create-client-closed"}
      open={open}
      onClose={close}
      title="Create API key"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" loading={submitting} disabled={name === ""} onClick={() => void submit()}>
            Create key
          </Button>
        </>
      }
    >
      {error !== null ? <ErrorPanel title={error} /> : null}
      <p className="t-body adm-measure">
        An API key acts as a non-human principal with owner-scoped access.
      </p>
      <Input label="Name" value={name} onChange={(event) => setName(event.target.value)} disabled={submitting} required />
    </Dialog>
  )
}

function KeyRevealDialog({ name, value, onClose }: { name: string; value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = (): void => {
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Key for ${name}`}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="adm-banner" role="note">
        <span className="adm-banner__title">{KEY_ONCE}</span>
      </div>
      <div className="key-field">
        <span className="t-label-caps adm-muted">shown once</span>
        <code className="key-field__value t-mono">{value}</code>
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied" : "Copy key"}
        </Button>
      </div>
    </Dialog>
  )
}
