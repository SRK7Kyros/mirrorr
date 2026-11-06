import { useMemo, useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createUser,
  deleteUser,
  fetchUsers,
  getErrorMessage,
  useAuthState,
} from "@/api"
import { ApiError } from "@/api/client"
import { rankBySearch } from "@/api/domain/search"
import { queryKeys, staleTimes } from "@/api/query-keys"
import type { User } from "@/api/schemas/user"
import {
  Avatar,
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  Field,
  IconPlus,
  Input,
  PageToolbar,
  Panel,
  PanelBody,
  PanelHead,
  QueryState,
  RowActions,
  SkeletonRows,
  StatLine,
  Table,
  Tag,
  Td,
  Th,
  toast,
} from "@/ui/components"
import { AdminSearch } from "./admin-search"
import { countLabel, REGISTRATION_REQUESTS_KEY, roleLabel } from "./format"
import { deleteBlockReason } from "./guards"

export function UsersPanel() {
  const queryClient = useQueryClient()
  const auth = useAuthState()
  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers, staleTime: staleTimes.users })
  const [createOpen, setCreateOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const remove = useMutation({
    mutationFn: (username: string) => deleteUser(username),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      void queryClient.invalidateQueries({ queryKey: queryKeys.groups })
      toast.success("User deleted")
    },
    onError: (caught) => toast.error("Could not delete user", getErrorMessage(caught, "Try again")),
  })

  const users = usersQuery.data ?? []
  const currentUsername = auth.auth?.user?.username ?? null
  const adminCount = users.filter((user) => user.role === "admin").length
  const rows = useMemo(
    () =>
      search.trim() === ""
        ? users
        : rankBySearch(users, search, (user) => [user.display_name, user.username]),
    [users, search],
  )

  const empty =
    users.length === 0 ? (
      <EmptyState
        title="No accounts yet"
        text="Add an account here, or approve a pending registration request."
      />
    ) : (
      <EmptyState
        title="Nothing matches this search"
        text="Clear the search box to see every account."
      />
    )

  const rowActions = (user: User) => {
    const reason = deleteBlockReason(user, users, currentUsername)
    return [
      {
        label: reason === null ? "Delete user" : `Delete user — ${reason}`,
        danger: true,
        disabled: reason !== null,
        onSelect: () => setDeleteTarget(user.username),
      },
    ]
  }

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
      <PanelBody flush className="flex flex-col gap-2 border-b border-line-subtle p-3">
        <PageToolbar
          search={
            <AdminSearch
              value={search}
              onChange={setSearch}
              label="Search users"
              placeholder="Filter by name or username…"
            />
          }
        />
        <StatLine
          label="User counts"
          items={[countLabel(users.length, "account"), countLabel(adminCount, "administrator")]}
        />
      </PanelBody>
      <PanelBody flush>
        <div className="p-3">
          <QueryState
            query={usersQuery}
            loading={<SkeletonRows cols={3} />}
            isEmpty={rows.length === 0}
            empty={empty}
            errorMessage="Could not load users"
          >
            <div className="hidden min-[672px]:block">
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
                  {rows.map((user) => {
                    const label = user.display_name !== "" ? user.display_name : user.username
                    return (
                      <tr key={user.id}>
                        <Td>
                          <div className="flex items-center gap-3">
                            <Avatar name={label} small />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-base font-medium text-ink">{label}</div>
                              <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">
                                @{user.username}
                              </div>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <Tag accent={user.role === "admin"}>{roleLabel(user.role)}</Tag>
                        </Td>
                        <Td actions>
                          <RowActions label={`Actions for ${user.username}`} actions={rowActions(user)} />
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-line-subtle min-[672px]:hidden">
              {rows.map((user) => {
                const label = user.display_name !== "" ? user.display_name : user.username
                return (
                  <li key={user.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={label} small />
                      <div className="min-w-0">
                        <div className="truncate text-base font-medium text-ink">{label}</div>
                        <div className="truncate text-xs text-ink-dim [font-family:var(--font-mono)]">
                          @{user.username}
                        </div>
                        <div className="mt-1">
                          <Tag accent={user.role === "admin"}>{roleLabel(user.role)}</Tag>
                        </div>
                      </div>
                    </div>
                    <RowActions label={`Actions for ${user.username}`} actions={rowActions(user)} />
                  </li>
                )
              })}
            </ul>
          </QueryState>
        </div>
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
