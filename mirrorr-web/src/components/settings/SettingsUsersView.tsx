/**
 * V12 — Settings: Users (`/settings/users`, admin).
 *
 * Contract: `docs/web-frontend-spec.md` L375-L384, `docs/general-client-specification.md`
 * §10.1, §13.7. Create goes through the admin-gated register endpoint (the only
 * user-creation path the API has); delete is pre-empted client-side when one
 * admin remains and confirmed by typing the username.
 */
import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { RoleBadge } from "@/components/settings/RoleBadge"
import { SettingsShell } from "@/components/settings/SettingsShell"
import { Button } from "@/components/ui/Button"
import { useIsCompactShell } from "@/components/chrome/CompactShell"
import { CompactCardList } from "@/components/ui/CompactCardList"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Dialog } from "@/components/ui/Dialog"
import { EmptyState, EMPTY_STATES } from "@/components/ui/EmptyState"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { SkeletonRows } from "@/components/ui/SkeletonRows"
import { Table, type TableColumn } from "@/components/ui/Table"
import { usePollingPolicy } from "@/hooks/use-polling-policy"
import { ApiError, userMessageForError } from "@/lib/errors"
import { QUERY_STALE_TIMES_MS, queryKeys } from "@/lib/query-keys"
import type { AuthUser } from "@/lib/schemas/auth"
import { createUser, deleteUser, fetchUsers } from "@/lib/settings-api"
import { showToast } from "@/lib/toast"

export const LAST_ADMIN_TOOLTIP = "Cannot delete the last admin"

interface CreateFieldErrors {
  readonly username?: string
  readonly password?: string
  readonly display_name?: string
}

export function SettingsUsersView() {
  const queryClient = useQueryClient()
  const polling = usePollingPolicy("admin")
  const usersQuery = useQuery({
    queryKey: queryKeys.users(),
    queryFn: fetchUsers,
    staleTime: QUERY_STALE_TIMES_MS.users,
    refetchInterval: polling.refetchInterval,
    refetchOnWindowFocus: polling.refetchOnWindowFocus,
  })
  const users = usersQuery.data ?? []
  const adminCount = users.filter((user) => user.role === "admin").length

  const [pendingDelete, setPendingDelete] = useState<AuthUser | null>(null)
  const [deletePending, setDeletePending] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [createErrors, setCreateErrors] = useState<CreateFieldErrors>({})
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")

  function openCreate() {
    setUsername("")
    setDisplayName("")
    setPassword("")
    setCreateErrors({})
    setCreateOpen(true)
  }

  async function confirmDelete() {
    const target = pendingDelete
    if (target === null) return

    setDeletePending(true)
    try {
      await deleteUser(target.username)
      await queryClient.invalidateQueries({ queryKey: queryKeys.users() })
      showToast(`Deleted ${target.username}`, "info")
      setPendingDelete(null)
    } catch (error) {
      showToast(userMessageForError(error), "error")
    } finally {
      setDeletePending(false)
    }
  }

  async function submitCreate() {
    const trimmedUsername = username.trim()
    if (trimmedUsername.length === 0 || password.length === 0) {
      setCreateErrors({
        username: trimmedUsername.length === 0 ? "Username is required" : undefined,
        password: password.length === 0 ? "Password is required" : undefined,
      })
      return
    }

    setCreatePending(true)
    try {
      const result = await createUser({
        username: trimmedUsername,
        password,
        displayName,
      })
      if (result.kind === "pending") {
        showToast("Registration request submitted for approval", "info")
      } else {
        queryClient.setQueryData<AuthUser[]>(queryKeys.users(), (current) =>
          current === undefined ? [result.user] : [...current, result.user],
        )
        showToast(`Created ${result.user.username}`, "info")
      }
      setCreateOpen(false)
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        setCreateErrors(error.fieldErrors ?? {})
        return
      }
      if (error instanceof ApiError && error.status === 409) {
        setCreateErrors({ username: error.detail })
        return
      }
      showToast(userMessageForError(error), "error")
    } finally {
      setCreatePending(false)
    }
  }

  if (usersQuery.isPending) {
    return <SkeletonRows count={3} label="Loading users" />
  }

  if (usersQuery.isError) {
    return (
      <ErrorPanel
        message={userMessageForError(usersQuery.error)}
        onRetry={() => {
          void usersQuery.refetch()
        }}
      />
    )
  }

  const compact = useIsCompactShell()

  const columns: ReadonlyArray<TableColumn<AuthUser>> = [
    {
      key: "username",
      header: "Username",
      render: (user) => <span className="text-text-primary">{user.username}</span>,
    },
    {
      key: "display_name",
      header: "Display name",
      render: (user) => <span className="text-text-secondary">{user.display_name ?? "—"}</span>,
    },
    {
      key: "role",
      header: "Role",
      render: (user) => <RoleBadge role={user.role} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      render: (user) => {
        const lastAdmin = user.role === "admin" && adminCount <= 1
        return (
          <span className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              iconSize="row"
              disabled={lastAdmin}
              title={lastAdmin ? LAST_ADMIN_TOOLTIP : undefined}
              onClick={() => setPendingDelete(user)}
            >
              Delete
            </Button>
          </span>
        )
      },
    },
  ]

  function columnFor(key: string) {
    return columns.find((column) => column.key === key)
  }

  function isLastAdmin(user: AuthUser): boolean {
    return user.role === "admin" && adminCount <= 1
  }

  /** Spec L548 V12 card anatomy; spec L531 the disabled-reason tooltip becomes visible 12px muted text. */
  function renderUserCard(user: AuthUser) {
    const cell = (key: string) => columnFor(key)?.render(user) ?? null

    return (
      <>
        <span className="flex items-center gap-2">
          {cell("username")}
          <span className="ml-auto flex items-center gap-2">{cell("role")}</span>
        </span>
        <span className="text-small text-text-secondary">{cell("display_name")}</span>
        {isLastAdmin(user) ? (
          <span data-testid="last-admin-reason" className="text-micro text-text-muted">
            {LAST_ADMIN_TOOLTIP}
          </span>
        ) : null}
      </>
    )
  }

  function userCardActions(user: AuthUser) {
    return [
      {
        id: "delete",
        label: "Delete",
        tone: "danger" as const,
        disabled: isLastAdmin(user),
        onSelect: () => setPendingDelete(user),
      },
    ]
  }

  return (
    <SettingsShell testId="settings-users-view" active="users">
      <div className="flex items-center justify-between">
        <p className="text-body text-text-secondary">
          Admins create accounts here; the public register form is bootstrap-only.
        </p>
        <Button variant="primary" icon={Plus} onClick={openCreate}>
          New user
        </Button>
      </div>

      {users.length === 0 ? (
        <EmptyState title={EMPTY_STATES.users} />
      ) : compact ? (
        <CompactCardList
          label="Users"
          rows={users}
          getRowKey={(user) => user.id}
          renderCard={renderUserCard}
          actionsFor={userCardActions}
          sheetTitle={(user) => `User ${user.username} actions`}
        />
      ) : (
        <Table label="Users" columns={columns} rows={users} getRowKey={(user) => user.id} />
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete user"
        body={
          <p>
            Permanently delete{" "}
            <span className="text-text-primary">{pendingDelete?.username ?? ""}</span> and its
            sessions, data and notifications. This cannot be undone.
          </p>
        }
        confirmLabel="Delete user"
        typedConfirmation={pendingDelete?.username}
        pending={deletePending}
        onConfirm={() => {
          void confirmDelete()
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <Dialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New user"
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
              Create user
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
            label="Username"
            autoComplete="off"
            enterKeyHint="next"
            value={username}
            error={createErrors.username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <Input
            label="Display name"
            autoComplete="off"
            enterKeyHint="next"
            value={displayName}
            error={createErrors.display_name}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="done"
            value={password}
            error={createErrors.password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </form>
      </Dialog>
    </SettingsShell>
  )
}
