import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
import { ApiError } from "@/lib/api"
import { queryKeys, staleTimes } from "@/lib/query-keys"
import { useAuthState } from "@/hooks/use-auth-state"
import { RouteLink } from "@/views/shared/parts"
import { apiErrorMessage } from "@/views/shared/api"
import {
  approveRegistrationRequest,
  createUser,
  deleteUser,
  denyRegistrationRequest,
  fetchRegistrationRequests,
  fetchUsers,
} from "./settings-api"

const REGISTRATION_REQUESTS_KEY = ["admin-registration-requests"] as const
const API_UNREACHABLE = "API unreachable"
const UNEXPECTED_RESPONSE = "Unexpected server response"
const MIN_PASSWORD_LENGTH = 8
const MIN_PASSWORD_MESSAGE = "Must be at least 8 characters"
const LAST_ADMIN_NOTE = "Cannot delete the last admin"

function AdminOnly() {
  return (
    <EmptyState
      headline="Admin only"
      body="User management requires an admin account."
      action={
        <RouteLink to="/settings" className="btn btn--primary">
          Account
        </RouteLink>
      }
    />
  )
}

interface FieldErrors {
  [key: string]: string
}

export function UsersSection() {
  const { auth } = useAuthState()
  const admin = auth?.user?.role === "admin"
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const usersQuery = useQuery({
    queryKey: queryKeys.users,
    queryFn: fetchUsers,
    staleTime: staleTimes.users,
  })
  const requestsQuery = useQuery({
    queryKey: REGISTRATION_REQUESTS_KEY,
    queryFn: fetchRegistrationRequests,
    staleTime: staleTimes.users,
    enabled: admin,
  })

  const [newOpen, setNewOpen] = useState(false)
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [denyTarget, setDenyTarget] = useState<{ id: number; username: string } | null>(null)
  const [denyBusy, setDenyBusy] = useState(false)
  const [approveBusyId, setApproveBusyId] = useState<number | null>(null)

  const users = usersQuery.data ?? []
  const requests = requestsQuery.data ?? []
  const adminCount = users.filter((user) => user.role === "admin").length

  function invalidate(): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.users })
    void queryClient.invalidateQueries({ queryKey: REGISTRATION_REQUESTS_KEY })
  }

  async function handleCreate(): Promise<void> {
    setFieldErrors({})
    setFormError(null)
    const name = username.trim()
    const display = displayName.trim()
    if (name === "" || password === "") {
      setFormError("Username and password required")
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFieldErrors({ password: MIN_PASSWORD_MESSAGE })
      return
    }
    setSubmitting(true)
    try {
      await createUser(name, password, display)
      invalidate()
      setNewOpen(false)
      setUsername("")
      setDisplayName("")
      setPassword("")
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          setFieldErrors({ username: error.message })
        } else if (error.status === 400) {
          setFieldErrors({ password: error.message })
        } else if (error.status === 429) {
          toast({ kind: "error", title: error.message })
        } else if (error.status === 0) {
          setFormError(API_UNREACHABLE)
        } else {
          setFormError(error.message)
        }
      } else {
        setFormError(UNEXPECTED_RESPONSE)
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (deleteTarget === null) return
    setDeleteBusy(true)
    try {
      await deleteUser(deleteTarget)
      invalidate()
      setDeleteTarget(null)
    } catch (error) {
      // Payload: 400 (last-admin race) and other failures → toast.
      toast({ kind: "error", title: "Delete failed", body: apiErrorMessage(error, UNEXPECTED_RESPONSE) })
      setDeleteTarget(null)
    } finally {
      setDeleteBusy(false)
    }
  }

  async function handleApprove(id: number): Promise<void> {
    setApproveBusyId(id)
    try {
      await approveRegistrationRequest(id)
      invalidate()
    } catch (error) {
      toast({ kind: "error", title: "Approve failed", body: apiErrorMessage(error, UNEXPECTED_RESPONSE) })
    } finally {
      setApproveBusyId(null)
    }
  }

  async function handleDeny(): Promise<void> {
    if (denyTarget === null) return
    setDenyBusy(true)
    try {
      await denyRegistrationRequest(denyTarget.id)
      invalidate()
      setDenyTarget(null)
    } catch (error) {
      toast({ kind: "error", title: "Deny failed", body: apiErrorMessage(error, UNEXPECTED_RESPONSE) })
      setDenyTarget(null)
    } finally {
      setDenyBusy(false)
    }
  }

  if (!admin) return <AdminOnly />

  return (
    <>
      <div className="view-header">
        <h2 className="view-title">Users</h2>
        <div className="view-header__actions">
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            New user
          </Button>
        </div>
      </div>

      {usersQuery.isLoading ? <SkeletonList rows={5} /> : null}
      {usersQuery.isError ? (
        <ErrorPanel
          title="Request failed"
          body={
            usersQuery.error instanceof Error
              ? usersQuery.error.message
              : UNEXPECTED_RESPONSE
          }
          actions={
            <Button variant="ghost" onClick={() => void usersQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : null}
      {!usersQuery.isLoading && !usersQuery.isError && users.length === 0 ? (
        <EmptyState
          headline="No users"
          body=""
          action={
            <Button variant="primary" onClick={() => setNewOpen(true)}>
              New user
            </Button>
          }
        />
      ) : null}

      {users.length > 0 ? (
        <table className="entity-table">
          <thead>
            <tr>
              <th scope="col">Username</th>
              <th scope="col">Display name</th>
              <th scope="col">Role</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const locked = user.role === "admin" && adminCount <= 1
              return (
                <tr className="entity-row" key={user.id}>
                  <td data-col="name" className="cell-strong t-mono-inline">
                    <span
                      style={{
                        display: "inline-block",
                        maxWidth: "16ch",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {user.username}
                    </span>
                  </td>
                  <td data-col="engine">{user.display_name}</td>
                  <td data-col="status">
                    <Badge variant={user.role === "admin" ? "role-admin" : "role-user"}>
                      {user.role}
                    </Badge>
                  </td>
                  <td data-col="actions">
                    <span className="cluster">
                      <Button
                        variant="danger-text"
                        disabled={locked}
                        title={locked ? LAST_ADMIN_NOTE : undefined}
                        onClick={() => setDeleteTarget(user.username)}
                      >
                        Delete
                      </Button>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : null}

      {requests.length > 0 ? (
        <section className="card">
          <p className="card__legend">Registration requests</p>
          {requests.map((request) => (
            <div className="settings-request-row" key={request.id}>
              <span>
                <span className="t-mono-inline">{request.username}</span>
                {request.display_name !== "" ? (
                  <span className="view-subtitle"> {request.display_name}</span>
                ) : null}
              </span>
              <span className="cluster">
                <Button
                  variant="ghost"
                  loading={approveBusyId === request.id}
                  disabled={approveBusyId !== null}
                  onClick={() => void handleApprove(request.id)}
                >
                  Approve
                </Button>
                <Button
                  variant="danger-text"
                  disabled={approveBusyId !== null}
                  onClick={() =>
                    setDenyTarget({ id: request.id, username: request.username })
                  }
                >
                  Deny
                </Button>
              </span>
            </div>
          ))}
        </section>
      ) : null}

      <Fab
        aria-label="New user"
        icon={<IconPlus size={24} />}
        onClick={() => setNewOpen(true)}
      />

      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New user"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              disabled={username.trim() === "" || password === ""}
              onClick={() => void handleCreate()}
            >
              Create
            </Button>
          </>
        }
      >
        <form
          className="stack"
          onSubmit={(event) => {
            event.preventDefault()
            void handleCreate()
          }}
          noValidate
        >
          <Input
            label="Username"
            autoComplete="off"
            spellCheck={false}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            error={fieldErrors.username}
            required
            disabled={submitting}
          />
          <Input
            label="Display name"
            autoComplete="off"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            error={fieldErrors.display_name}
            disabled={submitting}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            helper="At least 8 characters"
            required
            disabled={submitting}
          />
          {formError !== null ? (
            <p className="field__helper field__helper--error" role="alert">
              {formError}
            </p>
          ) : null}
          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      </Dialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={`Delete user '${deleteTarget ?? ""}'?`}
        body="This cannot be undone."
        confirmLabel="Delete"
        tone="destructive"
        loading={deleteBusy}
        typedConfirm={{ phrase: deleteTarget ?? "" }}
      />

      <ConfirmDialog
        open={denyTarget !== null}
        onClose={() => setDenyTarget(null)}
        onConfirm={handleDeny}
        title={`Deny registration request from '${denyTarget?.username ?? ""}'?`}
        body="The request is removed and the username frees up."
        confirmLabel="Deny"
        tone="destructive"
        loading={denyBusy}
      />
    </>
  )
}
