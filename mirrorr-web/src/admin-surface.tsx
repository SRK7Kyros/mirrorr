/**
 * The administration surface. It lives only in the admin build (`admin.html`):
 * the build served to every other principal does not contain this module, its
 * strings, or any role check that mentions it. nginx picks the build; nothing
 * here decides whether it may run. `admin.tsx` contributes it to the settings
 * page through the generic section slot in `ui/views/settings/sections`.
 */
import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  approveRegistrationRequest,
  createClient,
  createGroup,
  createUser,
  deleteClient,
  deleteGroup,
  deleteUser,
  denyRegistrationRequest,
  fetchAdminResources,
  fetchClients,
  fetchGroups,
  fetchRegistrationRequests,
  fetchResourceAccess,
  fetchUsers,
  formatRelativeTime,
  getErrorMessage,
  setGroupMembers,
  updateGroup,
} from "@/api"
import { ApiError } from "@/api/client"
import { applyPlans, itemAccessFromView, planItem, type AccessTarget } from "@/api/domain/access-plan"
import { rankBySearch } from "@/api/domain/search"
import { PAGE_SIZE, queryKeys, queryRoots, staleTimes } from "@/api/query-keys"
import { RESOURCE_TYPES, type AdminResource, type Group } from "@/api/schemas/privileged"
import type { User } from "@/api/schemas/user"
import {
  ResourceAccessFields,
  resourceTypeLabel,
  userLabel,
} from "@/ui/views/shared/resource-access"
import { copyText } from "@/ui/lib/clipboard"
import {
  Avatar,
  Banner,
  Button,
  Checkbox,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorPanel,
  Field,
  IconButton,
  IconCheck,
  IconCopy,
  IconEdit,
  IconPlus,
  IconTrash,
  IconX,
  Input,
  Panel,
  PanelBody,
  PanelHead,
  Select,
  SkeletonRows,
  Table,
  Td,
  Tag,
  Th,
  toast,
} from "@/ui/components"

/** No factory exists for this admin-only surface — keyed under `auth`. */
const REGISTRATION_REQUESTS_KEY = ["auth", "registration-requests"] as const

/** Group CRUD is admin-only and has no factory either; the bulk slot reads it too. */


function whenLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  return formatRelativeTime(value)
}

/** "3 viewers · 1 group" — the access column's summary of user and group grants. */
function accessSummary(resource: AdminResource): string {
  const viewers = `${resource.viewer_count} ${resource.viewer_count === 1 ? "viewer" : "viewers"}`
  const groups = resource.grant_groups.length
  if (groups === 0) return viewers
  return `${viewers} · ${groups} ${groups === 1 ? "group" : "groups"}`
}

export function AdministrationSection() {
  return (
    <>
      <UsersSection />
      <ClientsSection />
      <RegistrationRequestsSection />
      <GroupsSection />
      <ResourceAccessSection />
    </>
  )
}

function UsersSection() {
  const queryClient = useQueryClient()
  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (username: string) => deleteUser(username),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success("User deleted")
    },
    onError: (caught) => toast.error("Could not delete user", getErrorMessage(caught, "Try again")),
  })

  const users = usersQuery.data ?? []

  return (
    <Panel>
      <PanelHead
        title="Users"
        actions={
          <Button size="sm" variant="secondary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            Add user
          </Button>
        }
      />
      <PanelBody flush>
        {usersQuery.isLoading ? (
          <div className="panel-body">
            <SkeletonRows cols={3} />
          </div>
        ) : usersQuery.isError ? (
          <div className="panel-body">
            <ErrorPanel
              message={getErrorMessage(usersQuery.error, "Could not load users")}
              onRetry={() => void usersQuery.refetch()}
            />
          </div>
        ) : users.length === 0 ? (
          <EmptyState title="No users" text="No accounts have been created yet." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Role</Th>
                <Th className="cell-actions">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const label = user.display_name !== "" ? user.display_name : user.username
                return (
                  <tr key={user.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={label} small />
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-medium text-ink truncate">{label}</div>
                          <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">@{user.username}</div>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Tag accent={user.role === "admin"}>{user.role}</Tag>
                    </Td>
                    <Td actions>
                      <IconButton
                        label={`Delete ${user.username}`}
                        icon={<IconTrash size={16} />}
                        variant="danger-ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(user.username)}
                      />
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </PanelBody>

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete user"
        description={deleteTarget !== null ? `“${deleteTarget}” will lose access immediately.` : undefined}
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

interface CreateUserDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

function CreateUserDialog({ open, onClose }: CreateUserDialogProps) {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  function reset(): void {
    setUsername("")
    setDisplayName("")
    setPassword("")
    setConfirm("")
    setError(null)
    setFieldErrors({})
  }

  const create = useMutation({
    mutationFn: () => createUser(username.trim(), password, displayName.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      void queryClient.invalidateQueries({ queryKey: REGISTRATION_REQUESTS_KEY })
      toast.success("User created", `${username.trim()} can now sign in.`)
      reset()
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not create user"))
    },
  })

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (create.isPending) return
    setError(null)
    setFieldErrors({})
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }
    create.mutate()
  }

  function handleClose(): void {
    if (create.isPending) return
    reset()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      busy={create.isPending}
      title="Add user"
      description="The account is created already approved."
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-user-form" variant="primary" loading={create.isPending}>
            Create user
          </Button>
        </>
      }
    >
      <form id="create-user-form" className="flex flex-col gap-4" onSubmit={(event) => void onSubmit(event)} noValidate>
        {error !== null ? <Banner kind="danger" title={error} /> : null}
        <Field label="Username" htmlFor="new-user-username" required error={fieldErrors.username ?? null}>
          <Input
            id="new-user-username"
            autoComplete="off"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </Field>
        <Field label="Display name" htmlFor="new-user-display-name" hint="Shown in the sidebar and lists.">
          <Input
            id="new-user-display-name"
            autoComplete="off"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="new-user-password" required error={fieldErrors.password ?? null}>
          <Input
            id="new-user-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Field label="Confirm password" htmlFor="new-user-confirm" required>
          <Input
            id="new-user-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}

function ClientsSection() {
  const queryClient = useQueryClient()
  const clientsQuery = useQuery({
    queryKey: queryKeys.clients,
    queryFn: fetchClients,
    staleTime: staleTimes.clients,
  })
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)

  const remove = useMutation({
    mutationFn: (id: number) => deleteClient(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
      toast.success("API client deleted")
    },
    onError: (caught) => toast.error("Could not delete client", getErrorMessage(caught, "Try again")),
  })

  const clients = clientsQuery.data ?? []

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
      <PanelBody flush>
        {clientsQuery.isLoading ? (
          <div className="panel-body">
            <SkeletonRows cols={4} />
          </div>
        ) : clientsQuery.isError ? (
          <div className="panel-body">
            <ErrorPanel
              message={getErrorMessage(clientsQuery.error, "Could not load API clients")}
              onRetry={() => void clientsQuery.refetch()}
            />
          </div>
        ) : clients.length === 0 ? (
          <EmptyState title="No API clients" text="Create a client to issue a programmatic API key." />
        ) : (
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
              {clients.map((client) => (
                <tr key={client.id}>
                  <Td>{client.name}</Td>
                  <Td>{client.is_active === false ? <Tag>Inactive</Tag> : <Tag accent>Active</Tag>}</Td>
                  <Td className="text-muted">{whenLabel(client.created_at)}</Td>
                  <Td actions>
                    <IconButton
                      label={`Delete ${client.name}`}
                      icon={<IconTrash size={16} />}
                      variant="danger-ghost"
                      size="sm"
                      onClick={() => setDeleteTarget(client.id)}
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PanelBody>

      <CreateClientDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete API client"
        description="Any integration using this client's key will stop working immediately."
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

  const create = useMutation({
    mutationFn: () => createClient(name.trim()),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.clients })
      setApiKey(result.apiKey)
    },
    onError: (caught) => setError(getErrorMessage(caught, "Could not create client")),
  })

  function handleClose(): void {
    if (create.isPending) return
    setName("")
    setError(null)
    setApiKey(null)
    onClose()
  }

  async function copyKey(): Promise<void> {
    if (apiKey === null) return
    try {
      await copyText(apiKey)
      toast.success("API key copied")
    } catch {
      toast.error("Copy failed", "Select the key and copy it manually.")
    }
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      busy={create.isPending}
      title={apiKey === null ? "Add API client" : "API client created"}
      footer={
        apiKey === null ? (
          <>
            <Button variant="ghost" onClick={handleClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" form="create-client-form" variant="primary" loading={create.isPending}>
              Create client
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={handleClose}>
            Done
          </Button>
        )
      }
    >
      {apiKey === null ? (
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
          <div className="flex items-center justify-between gap-3">
            <span className="mono text-truncate">{apiKey}</span>
            <Button size="sm" variant="outline" icon={<IconCopy size={14} />} onClick={() => void copyKey()}>
              Copy
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  )
}

function RegistrationRequestsSection() {
  const queryClient = useQueryClient()
  const requestsQuery = useQuery({
    queryKey: REGISTRATION_REQUESTS_KEY,
    queryFn: fetchRegistrationRequests,
    staleTime: staleTimes.users,
  })
  const [denyTarget, setDenyTarget] = useState<number | null>(null)

  const approve = useMutation({
    mutationFn: (id: number) => approveRegistrationRequest(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REGISTRATION_REQUESTS_KEY })
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      toast.success("Registration approved")
    },
    onError: (caught) => toast.error("Could not approve request", getErrorMessage(caught, "Try again")),
  })

  const deny = useMutation({
    mutationFn: (id: number) => denyRegistrationRequest(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REGISTRATION_REQUESTS_KEY })
      toast.success("Registration denied")
    },
    onError: (caught) => toast.error("Could not deny request", getErrorMessage(caught, "Try again")),
  })

  const requests = requestsQuery.data ?? []

  return (
    <Panel>
      <PanelHead title="Registration requests" />
      <PanelBody flush>
        {requestsQuery.isLoading ? (
          <div className="panel-body">
            <SkeletonRows cols={3} />
          </div>
        ) : requestsQuery.isError ? (
          <div className="panel-body">
            <ErrorPanel
              message={getErrorMessage(requestsQuery.error, "Could not load registration requests")}
              onRetry={() => void requestsQuery.refetch()}
            />
          </div>
        ) : requests.length === 0 ? (
          <EmptyState title="No pending requests" text="New sign-ups awaiting approval appear here." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Requester</Th>
                <Th>Requested</Th>
                <Th className="cell-actions">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => {
                const label = request.display_name !== "" ? request.display_name : request.username
                return (
                  <tr key={request.id}>
                    <Td>
                      <div className="text-base font-medium text-ink truncate">{label}</div>
                      <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">@{request.username}</div>
                    </Td>
                    <Td className="text-muted">{whenLabel(request.created_at)}</Td>
                    <Td actions>
                      <div className="flex items-center gap-3">
                        <Button
                          size="sm"
                          variant="outline"
                          icon={<IconCheck size={15} />}
                          loading={approve.isPending && approve.variables === request.id}
                          onClick={() => approve.mutate(request.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          icon={<IconX size={15} />}
                          onClick={() => setDenyTarget(request.id)}
                        >
                          Deny
                        </Button>
                      </div>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>
        )}
      </PanelBody>

      <ConfirmDialog
        open={denyTarget !== null}
        onClose={() => setDenyTarget(null)}
        title="Deny registration"
        description="The requester will not be able to sign in."
        confirmLabel="Deny"
        onConfirm={async () => {
          if (denyTarget === null) return
          try {
            await deny.mutateAsync(denyTarget)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Panel>
  )
}

/**
 * Admin resource browser (plan: admin-ownership-and-access). One offset page of
 * every item — owner-bearing rows plus engines/resolvers as read-only system
 * rows. There is no server-side free-text search, so a term ranks the loaded
 * page client-side through the same `rankBySearch` the lists use.
 */
function ResourceAccessSection() {
  const [typeFilter, setTypeFilter] = useState("")
  const [ownerFilter, setOwnerFilter] = useState("")
  const [search, setSearch] = useState("")
  const [offset, setOffset] = useState(0)
  const [target, setTarget] = useState<AdminResource | null>(null)

  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })

  const query = useMemo(
    () => ({
      resource_type: typeFilter === "" ? undefined : typeFilter,
      owner: ownerFilter === "" ? undefined : ownerFilter,
      limit: PAGE_SIZE,
      offset,
    }),
    [typeFilter, ownerFilter, offset],
  )

  const resourcesQuery = useQuery({
    queryKey: queryKeys.adminResources(query),
    queryFn: () => fetchAdminResources(query),
    staleTime: staleTimes.adminResources,
  })

  const users = usersQuery.data ?? []
  const page = resourcesQuery.data
  const rows = useMemo(() => {
    const items = page?.items ?? []
    if (search.trim() === "") return items
    return rankBySearch(items, search, (item) => [item.label, item.owner])
  }, [page, search])

  const total = page?.total ?? 0

  return (
    <Panel>
      <PanelHead title="Resource access" />
      <PanelBody flush>
        <div className="panel-body flex items-center gap-2 flex-wrap">
          <Select
            aria-label="Filter by resource type"
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value)
              setOffset(0)
            }}
          >
            <option value="">All types</option>
            {RESOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {resourceTypeLabel(type)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="Filter by owner"
            value={ownerFilter}
            onChange={(event) => {
              setOwnerFilter(event.target.value)
              setOffset(0)
            }}
          >
            <option value="">All owners</option>
            {users.map((user) => (
              <option key={user.username} value={user.username}>
                {userLabel(user)}
              </option>
            ))}
          </Select>
          <div className="relative flex-1 min-w-[200px] max-w-[340px]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Filter this page…"
              aria-label="Filter resources"
            />
          </div>
        </div>

        {resourcesQuery.isLoading ? (
          <div className="panel-body">
            <SkeletonRows cols={4} />
          </div>
        ) : resourcesQuery.isError ? (
          <div className="panel-body">
            <ErrorPanel
              message={getErrorMessage(resourcesQuery.error, "Could not load resources")}
              onRetry={() => void resourcesQuery.refetch()}
            />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="No resources" text="No items match the current filter." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Resource</Th>
                <Th>Type</Th>
                <Th>Owner</Th>
                <Th>Access</Th>
                <Th className="cell-actions">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((resource) => (
                <tr key={`${resource.resource_type}-${resource.id}`}>
                  <Td>{resource.label}</Td>
                  <Td className="text-muted">{resourceTypeLabel(resource.resource_type)}</Td>
                  <Td>
                    {resource.system ? (
                      <Tag>System</Tag>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {resource.owner_missing ? (
                          <span className="text-danger">{resource.owner} (missing)</span>
                        ) : (
                          <span>{resource.owner}</span>
                        )}
                        {resource.owner_groups.length > 0 ? (
                          <span className="text-xs text-ink-dim">
                            {`Owner groups: ${resource.owner_groups.join(", ")}`}
                          </span>
                        ) : null}
                      </div>
                    )}
                  </Td>
                  <Td className="text-muted">{accessSummary(resource)}</Td>
                  <Td actions>
                    {resource.system ? null : (
                      <IconButton
                        label={`Manage access for ${resource.label}`}
                        icon={<IconEdit size={16} />}
                        size="sm"
                        onClick={() => setTarget(resource)}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {total > PAGE_SIZE ? (
          <div className="panel-body flex items-center justify-between gap-3">
            <span className="text-muted">
              {`Showing ${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} of ${total}`}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={offset + PAGE_SIZE >= total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </PanelBody>

      {target !== null ? (
        <ResourceAccessDialog resource={target} users={users} onClose={() => setTarget(null)} />
      ) : null}
    </Panel>
  )
}

interface ResourceAccessDialogProps {
  readonly resource: AdminResource
  readonly users: readonly User[]
  readonly onClose: () => void
}

function ResourceAccessDialog({ resource, users, onClose }: ResourceAccessDialogProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)

  const groupsQuery = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups, staleTime: staleTimes.users })
  const accessQuery = useQuery({
    queryKey: queryKeys.adminResourceAccess(resource.resource_type, resource.id),
    queryFn: () => fetchResourceAccess(resource.resource_type, resource.id),
    staleTime: staleTimes.adminResources,
  })
  const access = accessQuery.data

  async function apply(target: AccessTarget): Promise<void> {
    if (access === undefined) return
    setBusy(true)
    const outcome = await applyPlans([
      planItem(
        {
          resourceType: resource.resource_type,
          id: resource.id,
          label: resource.label,
          access: itemAccessFromView(access),
        },
        target,
        users.map((user) => user.username),
      ),
    ])
    setBusy(false)
    void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
    void queryClient.invalidateQueries({
      queryKey: queryKeys.adminResourceAccess(resource.resource_type, resource.id),
    })
    if (outcome.failed.length > 0) toast.error("Could not update access", outcome.failed[0].message)
    else toast.success("Access updated", resource.label)
  }

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      size="xl"
      title={`Access · ${resource.label}`}
      description={`${resourceTypeLabel(resource.resource_type)} · #${resource.id}`}
      footer={
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Close
        </Button>
      }
    >
      {accessQuery.isLoading ? (
        <SkeletonRows cols={2} />
      ) : accessQuery.isError ? (
        <ErrorPanel
          message={getErrorMessage(accessQuery.error, "Could not load access")}
          onRetry={() => void accessQuery.refetch()}
        />
      ) : access === undefined ? (
        <SkeletonRows cols={2} />
      ) : (
        <ResourceAccessFields
          resourceType={resource.resource_type}
          access={itemAccessFromView(access)}
          users={users}
          groups={groupsQuery.data?.items ?? []}
          busy={busy}
          onApply={(target) => void apply(target)}
        />
      )}
    </Dialog>
  )
}

/**
 * Groups (plan: granular-permissions-and-access-panel, Wave 6). Admin-only CRUD
 * over the group list. The sealed `everyone` row (`system: true`) is read-only —
 * the server rejects its rename, delete and member edits — so it shows no
 * affordances and says why.
 */
function GroupsSection() {
  const queryClient = useQueryClient()
  const groupsQuery = useQuery({ queryKey: queryKeys.groups, queryFn: fetchGroups, staleTime: staleTimes.users })
  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })
  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Group | null>(null)
  const [membersTarget, setMembersTarget] = useState<Group | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Group | null>(null)

  const remove = useMutation({
    mutationFn: (id: number) => deleteGroup(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
      toast.success("Group deleted")
    },
    onError: (caught) => toast.error("Could not delete group", getErrorMessage(caught, "Try again")),
  })

  const users = usersQuery.data ?? []
  const groups = groupsQuery.data?.items ?? []

  return (
    <Panel>
      <PanelHead
        title="Groups"
        actions={
          <Button size="sm" variant="secondary" icon={<IconPlus size={16} />} onClick={() => setCreateOpen(true)}>
            Add group
          </Button>
        }
      />
      <PanelBody flush>
        {groupsQuery.isLoading ? (
          <div className="panel-body">
            <SkeletonRows cols={3} />
          </div>
        ) : groupsQuery.isError ? (
          <div className="panel-body">
            <ErrorPanel
              message={getErrorMessage(groupsQuery.error, "Could not load groups")}
              onRetry={() => void groupsQuery.refetch()}
            />
          </div>
        ) : groups.length === 0 ? (
          <EmptyState title="No groups" text="Create a group to grant the same access to several accounts." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Group</Th>
                <Th>Members</Th>
                <Th className="cell-actions">
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-medium text-ink truncate">
                        {group.display_name !== "" ? group.display_name : group.name}
                      </span>
                      {group.system ? <Tag>System</Tag> : null}
                    </div>
                    <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">@{group.name}</div>
                    {group.system ? (
                      <div className="text-xs text-muted">
                        Every account, including future ones — membership is implicit.
                      </div>
                    ) : null}
                  </Td>
                  <Td className="text-muted">{group.system ? "Everyone" : group.member_count}</Td>
                  <Td actions>
                    {group.system ? null : (
                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => setMembersTarget(group)}>
                          Members
                        </Button>
                        <IconButton
                          label={`Edit ${group.name}`}
                          icon={<IconEdit size={16} />}
                          size="sm"
                          onClick={() => setEditTarget(group)}
                        />
                        <IconButton
                          label={`Delete ${group.name}`}
                          icon={<IconTrash size={16} />}
                          variant="danger-ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(group)}
                        />
                      </div>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </PanelBody>

      <CreateGroupDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      {editTarget !== null ? (
        <EditGroupDialog group={editTarget} onClose={() => setEditTarget(null)} />
      ) : null}
      {membersTarget !== null ? (
        <GroupMembersDialog group={membersTarget} users={users} onClose={() => setMembersTarget(null)} />
      ) : null}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete group"
        description={
          deleteTarget !== null
            ? `“${deleteTarget.name}” loses its grants and ownership rows. Members keep their own access.`
            : undefined
        }
        confirmLabel="Delete"
        onConfirm={async () => {
          if (deleteTarget === null) return
          try {
            await remove.mutateAsync(deleteTarget.id)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Panel>
  )
}

interface CreateGroupDialogProps {
  readonly open: boolean
  readonly onClose: () => void
}

function CreateGroupDialog({ open, onClose }: CreateGroupDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  function reset(): void {
    setName("")
    setDisplayName("")
    setError(null)
    setFieldErrors({})
  }

  const create = useMutation({
    mutationFn: () => createGroup(name.trim(), displayName.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      toast.success("Group created", name.trim())
      reset()
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not create group"))
    },
  })

  function handleClose(): void {
    if (create.isPending) return
    reset()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      busy={create.isPending}
      title="Add group"
      description="A group grants the same access to every member."
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="create-group-form" variant="primary" loading={create.isPending}>
            Create group
          </Button>
        </>
      }
    >
      <form
        id="create-group-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (create.isPending) return
          setError(null)
          setFieldErrors({})
          create.mutate()
        }}
        noValidate
      >
        {error !== null ? <Banner kind="danger" title={error} /> : null}
        <Field
          label="Name"
          htmlFor="new-group-name"
          required
          hint="Lowercase identifier, e.g. editors."
          error={fieldErrors.name ?? null}
        >
          <Input
            id="new-group-name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Display name" htmlFor="new-group-display" hint="Shown wherever the group appears.">
          <Input
            id="new-group-display"
            autoComplete="off"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}

interface EditGroupDialogProps {
  readonly group: Group
  readonly onClose: () => void
}

function EditGroupDialog({ group, onClose }: EditGroupDialogProps) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(group.name)
  const [displayName, setDisplayName] = useState(group.display_name)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  const save = useMutation({
    mutationFn: () => updateGroup(group.id, { name: name.trim(), display_name: displayName.trim() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      void queryClient.invalidateQueries({ queryKey: queryRoots.adminResources })
      toast.success("Group updated", name.trim())
      onClose()
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not update group"))
    },
  })

  return (
    <Dialog
      open
      onClose={onClose}
      busy={save.isPending}
      title={`Edit ${group.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="edit-group-form" variant="primary" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form
        id="edit-group-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (save.isPending) return
          setError(null)
          setFieldErrors({})
          save.mutate()
        }}
        noValidate
      >
        {error !== null ? <Banner kind="danger" title={error} /> : null}
        <Field label="Name" htmlFor="edit-group-name" required error={fieldErrors.name ?? null}>
          <Input
            id="edit-group-name"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <Field label="Display name" htmlFor="edit-group-display">
          <Input
            id="edit-group-display"
            autoComplete="off"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </Field>
      </form>
    </Dialog>
  )
}

interface GroupMembersDialogProps {
  readonly group: Group
  readonly users: readonly User[]
  readonly onClose: () => void
}

function GroupMembersDialog({ group, users, onClose }: GroupMembersDialogProps) {
  const queryClient = useQueryClient()
  const [members, setMembers] = useState<readonly string[]>(group.members)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => setGroupMembers(group.id, members),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      toast.success("Members updated", `${updated.member_count} in ${updated.name}`)
      onClose()
    },
    onError: (caught) => setError(getErrorMessage(caught, "Could not update members")),
  })

  const allSelected = users.length > 0 && users.every((user) => members.includes(user.username))

  return (
    <Dialog
      open
      onClose={onClose}
      busy={save.isPending}
      size="lg"
      title={`Members · ${group.name}`}
      description={`${members.length} of ${users.length} accounts selected.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save members
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error !== null ? <Banner kind="danger" title={error} /> : null}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={save.isPending || allSelected}
            onClick={() => setMembers(users.map((user) => user.username))}
          >
            Select all
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={save.isPending || members.length === 0}
            onClick={() => setMembers([])}
          >
            Clear
          </Button>
        </div>
        <div className="flex flex-col gap-1 max-h-[42vh] overflow-y-auto">
          {users.map((user) => (
            <Checkbox
              key={user.username}
              label={userLabel(user)}
              checked={members.includes(user.username)}
              disabled={save.isPending}
              onChange={(event) =>
                setMembers((current) =>
                  event.target.checked
                    ? [...current, user.username]
                    : current.filter((username) => username !== user.username),
                )
              }
            />
          ))}
        </div>
      </div>
    </Dialog>
  )
}
