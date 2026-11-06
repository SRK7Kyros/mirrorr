import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient, deleteClient, fetchClients, getErrorMessage } from "@/api"
import { rankBySearch } from "@/api/domain/search"
import { queryKeys, staleTimes } from "@/api/query-keys"
import { copyText } from "@/ui/lib/clipboard"
import {
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconCopy,
  IconPlus,
  Input,
  PageToolbar,
  Panel,
  PanelBody,
  PanelHead,
  QueryState,
  RowActions,
  SkeletonRows,
  Table,
  Tag,
  Td,
  Th,
  TimeText,
  toast,
} from "@/ui/components"
import { AdminSearch } from "./admin-search"
import { countLabel } from "./format"

export function ApiClientsPanel() {
  const queryClient = useQueryClient()
  const clientsQuery = useQuery({
    queryKey: queryKeys.clients,
    queryFn: fetchClients,
    staleTime: staleTimes.clients,
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)
  const [deleteName, setDeleteName] = useState("")

  const remove = useMutation({
    mutationFn: (id: number) => deleteClient(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
      toast.success("API client deleted")
    },
    onError: (caught) => toast.error("Could not delete client", getErrorMessage(caught, "Try again")),
  })

  const clients = clientsQuery.data ?? []
  const rows = useMemo(
    () => (search.trim() === "" ? clients : rankBySearch(clients, search, (client) => [client.name])),
    [clients, search],
  )

  const empty =
    clients.length === 0 ? (
      <EmptyState
        title="No API clients"
        text="Create a client to issue a programmatic API key. The key is shown once, when the client is created."
      />
    ) : (
      <EmptyState title="Nothing matches this search" text="Clear the search box to see every client." />
    )

  return (
    <Panel>
      <PanelHead
        title="API clients"
        actions={
          <Button size="sm" variant="secondary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            Add client
          </Button>
        }
      />
      <PanelBody flush className="border-b border-line-subtle p-3">
        <PageToolbar
          search={
            <AdminSearch
              value={search}
              onChange={setSearch}
              label="Search API clients"
              placeholder="Filter by name…"
            />
          }
          count={countLabel(clients.length, "client")}
        />
      </PanelBody>
      <PanelBody flush>
        <div className="p-3">
          <QueryState
            query={clientsQuery}
            loading={<SkeletonRows cols={4} />}
            isEmpty={rows.length === 0}
            empty={empty}
            errorMessage="Could not load API clients"
          >
            <div className="hidden min-[672px]:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Status</Th>
                    <Th>Created</Th>
                    <Th className="cell-actions">
                      <span className="sr-only">Actions</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((client) => (
                    <tr key={client.id}>
                      <Td>{client.name}</Td>
                      <Td>{client.is_active === false ? <Tag>Inactive</Tag> : <Tag accent>Active</Tag>}</Td>
                      <Td className="text-ink-muted">
                        <TimeText value={client.created_at} />
                      </Td>
                      <Td actions>
                        <RowActions
                          label={`Actions for ${client.name}`}
                          actions={[
                            {
                              label: "Delete client",
                              danger: true,
                              onSelect: () => {
                                setDeleteTarget(client.id)
                                setDeleteName(client.name)
                              },
                            },
                          ]}
                        />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-line-subtle min-[672px]:hidden">
              {rows.map((client) => (
                <li key={client.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-base font-medium text-ink">{client.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                      {client.is_active === false ? <Tag>Inactive</Tag> : <Tag accent>Active</Tag>}
                      <TimeText value={client.created_at} />
                    </div>
                  </div>
                  <RowActions
                    label={`Actions for ${client.name}`}
                    actions={[
                      {
                        label: "Delete client",
                        danger: true,
                        onSelect: () => {
                          setDeleteTarget(client.id)
                          setDeleteName(client.name)
                        },
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          </QueryState>
        </div>
      </PanelBody>

      <CreateClientDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete API client"
        description={`Any integration using “${deleteName}” will stop working immediately.`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget === null) return
          try {
            await remove.mutateAsync(deleteTarget)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Panel>
  )
}

interface CreateClientDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

function CreateClientDialog({ open, onClose }: CreateClientDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => createClient(name.trim()),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
      setApiKey(result.apiKey)
      setAcknowledged(false)
      setCopyError(null)
    },
    onError: (caught) => setError(getErrorMessage(caught, "Could not create client")),
  })

  const keyShown = apiKey !== null
  /**
   * The key exists only in this dialog and cannot be fetched again. `Dialog`'s
   * `busy` is the one switch that blocks Escape, the scrim and the close button,
   * so the key cannot be lost by a stray click before it has been stored.
   */
  const locked = create.isPending || (keyShown && !acknowledged)

  function handleClose(): void {
    if (locked) return
    setName("")
    setError(null)
    setApiKey(null)
    setAcknowledged(false)
    setCopyError(null)
    onClose()
  }

  async function copyKey(): Promise<void> {
    if (apiKey === null) return
    try {
      await copyText(apiKey)
      setCopyError(null)
      toast.success("API key copied")
    } catch {
      setCopyError("The key could not be copied. Select it and copy it manually.")
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      busy={locked}
      title={keyShown ? "API client created" : "Add API client"}
      footer={
        keyShown ? (
          <Button variant="primary" disabled={!acknowledged} onClick={handleClose}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={handleClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="create-client-form" variant="primary" loading={create.isPending}>
              Create client
            </Button>
          </>
        )
      }
    >
      {!keyShown ? (
        <form
          id="create-client-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!create.isPending) create.mutate()
          }}
          noValidate
        >
          {error !== null ? <Banner kind="danger" title={error} /> : null}
          <Field label="Client name" htmlFor="new-client-name" required>
            <Input
              id="new-client-name"
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <Banner kind="info" title="Copy the key now">
            This key is shown once and cannot be retrieved later.
          </Banner>
          <div className="flex flex-col gap-2">
            <code
              data-testid="api-key"
              className="mono selectable block max-h-40 w-full overflow-auto rounded-sm border border-line bg-surface-1 px-3 py-2 text-sm break-all text-ink"
            >
              {apiKey}
            </code>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" icon={<IconCopy size={14} />} onClick={() => void copyKey()}>
                Copy key
              </Button>
              {copyError !== null ? (
                <span className="text-sm text-danger" role="alert">
                  {copyError}
                </span>
              ) : null}
            </div>
          </div>
          <Checkbox
            label="I have copied this key and understand it will not be shown again"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
        </div>
      )}
    </Dialog>
  )
}
