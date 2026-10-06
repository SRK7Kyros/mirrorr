import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  approveRegistrationRequest,
  changePassword,
  createClient,
  createUser,
  deleteClient,
  deleteUser,
  denyRegistrationRequest,
  fetchClients,
  fetchRegistrationRequests,
  fetchUsers,
  formatRelativeTime,
  getErrorMessage,
  logout,
  useAuthState,
} from "@/api"
import { ApiError } from "@/api/client"
import { queryKeys, staleTimes } from "@/api/query-keys"
import {
  Avatar,
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorPanel,
  Field,
  IconButton,
  IconCheck,
  IconCopy,
  IconLogout,
  IconPlus,
  IconTrash,
  IconX,
  Input,
  Panel,
  PanelBody,
  PanelHead,
  SkeletonRows,
  Table,
  Td,
  Tag,
  Th,
  toast,
} from "@/ui/components"
import { Page } from "@/ui/views/shared/page"

/** No factory exists for this admin-only surface — keyed under `auth`. */
const REGISTRATION_REQUESTS_KEY = ["auth", "registration-requests"] as const

/** `created_at` is nullable on both rows; a missing timestamp renders as a dash. */
function whenLabel(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—"
  return formatRelativeTime(value)
}

export function SettingsView() {
  const auth = useAuthState()
  // Role is read off the auth store (not `isAdmin()`) so the sections re-render
  // when the session changes.
  const isAdminPrincipal = auth.auth?.user?.role === "admin"
  return (
    <Page
      title="Settings"
      description="Manage your account. Administrators can also manage users, API clients, and registration requests."
    >
      <AccountSection />
      {isAdminPrincipal ? (
        <>
          <UsersSection />
          <ClientsSection />
          <RegistrationRequestsSection />
        </>
      ) : null}
    </Page>
  )
}

function AccountSection() {
  const auth = useAuthState()
  const navigate = useNavigate()
  const user = auth.auth?.user ?? null
  const client = auth.auth?.client ?? null
  const displayName =
    user !== null && user.display_name !== ""
      ? user.display_name
      : (user?.username ?? client?.name ?? "Signed in")
  const handle = user !== null ? `@${user.username}` : (client?.name ?? "")
  const role = user?.role ?? (client !== null ? "api-client" : "unknown")

  const [oldPassword, setOldPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})

  const change = useMutation({
    mutationFn: (input: { readonly oldPassword: string; readonly newPassword: string }) =>
      changePassword(input.oldPassword, input.newPassword),
    onSuccess: () => {
      toast.success("Password changed", "Your session ended — the app will return to the sign-in screen.")
    },
  })

  const signOut = useMutation({
    mutationFn: () => logout(),
    onSettled: () => {
      void navigate({ to: "/login" })
    },
  })

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (change.isPending) return
    setError(null)
    setFieldErrors({})
    if (newPassword !== confirm) {
      setError("Passwords do not match")
      return
    }
    try {
      await change.mutateAsync({ oldPassword, newPassword })
      setOldPassword("")
      setNewPassword("")
      setConfirm("")
    } catch (caught) {
      if (caught instanceof ApiError && caught.fieldErrors !== undefined) setFieldErrors(caught.fieldErrors)
      setError(getErrorMessage(caught, "Could not change password"))
    }
  }

  return (
    <Panel>
      <PanelHead title="Account" />
      <PanelBody>
        <div className="stack">
          <div className="row">
            <Avatar name={displayName} />
            <div className="user-meta">
              <div className="user-name">{displayName}</div>
              {handle !== "" ? <div className="user-role">{handle}</div> : null}
            </div>
            <Tag accent>{role}</Tag>
          </div>

          <hr className="divider" />

          <form className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
            <h3>Change password</h3>
            {error !== null ? <Banner kind="danger" title={error} /> : null}
            <Field
              label="Current password"
              htmlFor="account-old-password"
              required
              error={fieldErrors.old_password ?? null}
            >
              <Input
                id="account-old-password"
                type="password"
                autoComplete="current-password"
                value={oldPassword}
                onChange={(event) => setOldPassword(event.target.value)}
              />
            </Field>
            <Field
              label="New password"
              htmlFor="account-new-password"
              required
              error={fieldErrors.new_password ?? null}
            >
              <Input
                id="account-new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </Field>
            <Field label="Confirm new password" htmlFor="account-confirm-password" required>
              <Input
                id="account-confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
              />
            </Field>
            <div className="row">
              <Button
                type="submit"
                variant="primary"
                loading={change.isPending}
                disabled={oldPassword === "" || newPassword === "" || confirm === ""}
              >
                Change password
              </Button>
            </div>
          </form>

          <hr className="divider" />

          <div className="row-between">
            <span className="text-muted">End this session on every device.</span>
            <Button
              variant="outline"
              icon={<IconLogout size={16} />}
              loading={signOut.isPending}
              onClick={() => signOut.mutate()}
            >
              Sign out
            </Button>
          </div>
        </div>
      </PanelBody>
    </Panel>
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
                      <div className="row">
                        <Avatar name={label} small />
                        <div className="user-meta">
                          <div className="user-name">{label}</div>
                          <div className="user-role">@{user.username}</div>
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
      <form id="create-user-form" className="stack" onSubmit={(event) => void onSubmit(event)} noValidate>
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
      await navigator.clipboard.writeText(apiKey)
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
        <form id="create-client-form" className="stack" onSubmit={(event) => void event.preventDefault()} noValidate>
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
        <div className="stack">
          <Banner kind="info" title="Copy the key now">
            This key is shown once and cannot be retrieved later.
          </Banner>
          <div className="row-between">
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
                      <div className="user-name">{label}</div>
                      <div className="user-role">@{request.username}</div>
                    </Td>
                    <Td className="text-muted">{whenLabel(request.created_at)}</Td>
                    <Td actions>
                      <div className="row">
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
