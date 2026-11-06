import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  approveRegistrationRequest,
  denyRegistrationRequest,
  fetchRegistrationRequests,
  getErrorMessage,
} from "@/api"
import type { RegistrationRequest } from "@/api/endpoints/settings"
import { rankBySearch } from "@/api/domain/search"
import { queryKeys, staleTimes } from "@/api/query-keys"
import {
  ConfirmDialog,
  EmptyState,
  PageToolbar,
  Panel,
  PanelBody,
  PanelHead,
  QueryState,
  RowActions,
  SkeletonRows,
  Table,
  Td,
  Th,
  TimeText,
  toast,
} from "@/ui/components"
import { AdminSearch } from "./admin-search"
import { countLabel, REGISTRATION_REQUESTS_KEY } from "./format"

interface Decision {
  readonly request: RegistrationRequest
  readonly approve: boolean
}

/**
 * The queue comes first in the Administration section because it is the only
 * panel with an action someone is waiting on: an unapproved account cannot sign
 * in at all.
 */
export function RegistrationRequestsPanel() {
  const queryClient = useQueryClient()
  const requestsQuery = useQuery({
    queryKey: REGISTRATION_REQUESTS_KEY,
    queryFn: fetchRegistrationRequests,
    staleTime: staleTimes.users,
  })
  const [search, setSearch] = useState("")
  const [decision, setDecision] = useState<Decision | null>(null)

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
      toast.success("Registration rejected")
    },
    onError: (caught) => toast.error("Could not reject request", getErrorMessage(caught, "Try again")),
  })

  const requests = requestsQuery.data ?? []
  const rows = useMemo(
    () =>
      search.trim() === ""
        ? requests
        : rankBySearch(requests, search, (request) => [request.display_name, request.username]),
    [requests, search],
  )

  const empty =
    requests.length === 0 ? (
      <EmptyState
        title="No pending requests"
        text="Nobody is waiting for approval. A new sign-up stays here until an administrator approves or rejects it."
      />
    ) : (
      <EmptyState
        title="Nothing matches this search"
        text="Clear the search box to see every pending request."
      />
    )

  const requestActions = (request: RegistrationRequest) => [
    { label: `Approve ${request.username}`, onSelect: () => setDecision({ request, approve: true }) },
    {
      label: `Reject ${request.username}`,
      danger: true,
      separatorBefore: true,
      onSelect: () => setDecision({ request, approve: false }),
    },
  ]

  return (
    <Panel>
      <PanelHead title="Registration requests" />
      <PanelBody flush className="border-b border-line-subtle p-3">
        <PageToolbar
          search={
            <AdminSearch
              value={search}
              onChange={setSearch}
              label="Search registration requests"
              placeholder="Filter by name or username…"
            />
          }
          count={countLabel(requests.length, "pending request")}
        />
      </PanelBody>
      <PanelBody flush>
        <div className="p-3">
          <QueryState
            query={requestsQuery}
            loading={<SkeletonRows cols={3} />}
            isEmpty={rows.length === 0}
            empty={empty}
            errorMessage="Could not load registration requests"
          >
            <div className="hidden min-[672px]:block">
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
                  {rows.map((request) => {
                    const label =
                      request.display_name !== "" ? request.display_name : request.username
                    return (
                      <tr key={request.id}>
                        <Td>
                          <div className="truncate text-base font-medium text-ink">{label}</div>
                          <div className="text-xs text-ink-dim [font-family:var(--font-mono)]">
                            @{request.username}
                          </div>
                        </Td>
                        <Td className="text-ink-muted">
                          <TimeText value={request.created_at} />
                        </Td>
                        <Td actions>
                          <RowActions
                            label={`Actions for ${request.username}`}
                            actions={requestActions(request)}
                          />
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            </div>
            <ul className="flex flex-col divide-y divide-line-subtle min-[672px]:hidden">
              {rows.map((request) => {
                const label =
                  request.display_name !== "" ? request.display_name : request.username
                return (
                  <li key={request.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-medium text-ink">{label}</div>
                      <div className="truncate text-xs text-ink-dim [font-family:var(--font-mono)]">
                        @{request.username}
                      </div>
                      <div className="mt-1 text-sm text-ink-muted">
                        <TimeText value={request.created_at} />
                      </div>
                    </div>
                    <RowActions
                      label={`Actions for ${request.username}`}
                      actions={requestActions(request)}
                    />
                  </li>
                )
              })}
            </ul>
          </QueryState>
        </div>
      </PanelBody>

      <ConfirmDialog
        open={decision !== null}
        onClose={() => setDecision(null)}
        danger={decision?.approve !== true}
        title={decision?.approve === true ? "Approve registration" : "Reject registration"}
        description={
          decision === null
            ? undefined
            : decision.approve
              ? `“${decision.request.username}” will be able to sign in as a member.`
              : `“${decision.request.username}” will not be able to sign in.`
        }
        confirmLabel={decision?.approve === true ? "Approve" : "Reject"}
        onConfirm={async () => {
          if (decision === null) return
          try {
            if (decision.approve) await approve.mutateAsync(decision.request.id)
            else await deny.mutateAsync(decision.request.id)
          } catch {
            // The mutation's onError surfaces the failure via toast.
          }
        }}
      />
    </Panel>
  )
}
