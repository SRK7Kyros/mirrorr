import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@/components/ui/Badge"
import { Button } from "@/components/ui/Button"
import { ConfirmDialog } from "@/components/ui/ConfirmDialog"
import { Dialog } from "@/components/ui/Dialog"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { Input } from "@/components/ui/Input"
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/Table"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import type { User } from "@/lib/schemas"
import { createUser, deleteUser, fetchUsers } from "./settings-api"
import { getErrorMessage, isLastAdmin } from "./settings-util"
import "@/styles/views-admin.css"

const LAST_ADMIN_COPY = "Cannot delete the last admin."

/**
 * §5.11 Settings — Users (admin). `GET /auth/users`, `DELETE /auth/users/{u}`.
 * Delete is disabled (with inline reason) when the list holds a single admin;
 * the server 400 is the backstop. No primary action — delete only.
 */
export function UsersSection() {
  const toast = useToast()
  const queryClient = useQueryClient()
  const usersQuery = useQuery({ queryKey: queryKeys.users, queryFn: fetchUsers })
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const users = usersQuery.data ?? []
  const lastAdmin = isLastAdmin(users)

  const deleteMutation = useMutation({
    mutationFn: (username: string) => deleteUser(username),
    onSuccess: () => {
      toast.toast({ kind: "success", title: "User deleted" })
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      setDeleteTarget(null)
    },
    onError: (error: unknown) => {
      toast.toast({ kind: "error", title: getErrorMessage(error, "Could not delete the user") })
    },
  })

  return (
    <div className="settings-panel panel opaque">
      <div className="adm-panel__head">
        <div className="adm-stack">
          <h2 className="t-h3">Users</h2>
          <p className="t-body adm-muted adm-measure">Accounts that can sign in to this console.</p>
        </div>
        <Button variant="secondary" onClick={() => setCreateOpen(true)}>
          Create user
        </Button>
      </div>

      {usersQuery.isError ? (
        <ErrorPanel
          title="Cannot load users"
          actions={
            <Button variant="secondary" onClick={() => void usersQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <Table label="Users">
          <TableHead>
            <TableRow>
              <TableCell>Username</TableCell>
              <TableCell>Display name</TableCell>
              <TableCell>Role</TableCell>
              <TableCell>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody
            loading={usersQuery.isLoading}
            columns={4}
            empty={<p className="t-body adm-muted">No users.</p>}
          >
            {users.map((user: User) => {
              const isSoleAdmin = user.role === "admin" && lastAdmin
              return (
                <TableRow key={user.id}>
                  <TableCell mono>{user.username}</TableCell>
                  <TableCell>{user.display_name}</TableCell>
                  <TableCell>
                    <Badge variant={user.role === "admin" ? "role-admin" : "role-user"}>{user.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {isSoleAdmin ? (
                      <span className="t-body adm-muted">{LAST_ADMIN_COPY}</span>
                    ) : (
                      <Button variant="danger-text" onClick={() => setDeleteTarget(user.username)}>
                        Delete
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      <CreateUserDialog open={createOpen} onClose={() => setCreateOpen(false)} />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) deleteMutation.mutate(deleteTarget)
        }}
        title="Delete this user?"
        body={`"${deleteTarget ?? ""}" loses access to this console immediately.`}
        confirmLabel="Delete user"
        tone="destructive"
        loading={deleteMutation.isPending}
      />
    </div>
  )
}

function CreateUserDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const queryClient = useQueryClient()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const close = (): void => {
    setUsername("")
    setPassword("")
    setDisplayName("")
    setFieldErrors({})
    setFormError(null)
    onClose()
  }

  const submit = async (): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    setFieldErrors({})
    setFormError(null)
    try {
      await createUser(username, password, displayName)
      toast.toast({ kind: "success", title: "User created" })
      void queryClient.invalidateQueries({ queryKey: queryKeys.users })
      close()
    } catch (error) {
      if (error instanceof ApiError && error.status === 422 && error.fieldErrors !== undefined) {
        const { _form, ...rest } = error.fieldErrors
        setFieldErrors(rest)
        if (_form !== undefined) setFormError(_form)
      } else {
        setFormError(getErrorMessage(error, "Could not create the user"))
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    // Remount on open so stale dialog state never survives (§8 defect fix).
    <Dialog
      key={open ? "create-user-open" : "create-user-closed"}
      open={open}
      onClose={close}
      title="Create user"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={submitting}
            disabled={username === "" || password === ""}
            onClick={() => void submit()}
          >
            Create user
          </Button>
        </>
      }
    >
      {formError !== null ? <ErrorPanel title={formError} /> : null}
      <Input
        label="Username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        error={fieldErrors.username}
        disabled={submitting}
        required
      />
      <Input
        label="Password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
        disabled={submitting}
        required
      />
      <Input
        label="Display name"
        helper="Shown in the users list."
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        error={fieldErrors.display_name}
        disabled={submitting}
      />
    </Dialog>
  )
}
