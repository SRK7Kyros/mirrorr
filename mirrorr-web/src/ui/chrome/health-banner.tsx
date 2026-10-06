import { apiClientBannerText, isApiClientPrincipal, notifyRealtimePollSuccess, useAuthState, useRealtimeState } from "@/api"
import { Banner, Button, IconRefresh } from "@/ui/components"

export function HealthBanner() {
  const auth = useAuthState()
  const realtime = useRealtimeState()

  if (isApiClientPrincipal(auth.auth)) return null
  if (!realtime.pollingFallback) return null

  return (
    <div className="app-banner">
      <Banner
        kind="warning"
        title="Live updates paused"
        action={
          <Button
            size="sm"
            variant="secondary"
            icon={<IconRefresh size={15} />}
            onClick={() => notifyRealtimePollSuccess()}
          >
            Reconnect
          </Button>
        }
      >
        The event stream dropped after {realtime.attempts} attempts. Lists now refresh every 15 seconds.
      </Banner>
    </div>
  )
}

export function ApiClientBanner() {
  const auth = useAuthState()
  const client = auth.auth?.client ?? null
  if (client === null) return null
  return (
    <div className="app-banner">
      <Banner kind="info" title="API client session">
        {apiClientBannerText(client.name)}
      </Banner>
    </div>
  )
}
