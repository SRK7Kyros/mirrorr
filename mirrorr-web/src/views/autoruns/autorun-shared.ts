import { useCallback } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import { queryRoots } from "@/lib/query-keys"
import type { Autorun } from "@/lib/schemas"
import {
  createSession,
  deleteAutorun,
  downloadJson,
  fetchAutorunExport,
  saveAutorunAsProfile,
} from "@/views/shared/api"
import { removeFromInfiniteLists } from "@/views/shared/hooks"
import { useLooseNavigate } from "@/views/shared/parts"
import type { ConfigFieldsValue } from "@/views/shared/config-fields"

export function configSnapshot(autorun: Autorun): Record<string, unknown> {
  return {
    engine_id: autorun.engine_id,
    resolver_id: autorun.resolver_id,
    resolver_config: { ...(autorun.resolver_config ?? {}) },
    retry_mode: autorun.retry_mode ?? null,
    retry_config: { ...(autorun.retry_config ?? {}) },
  }
}

export function configSnapshotFrom(config: ConfigFieldsValue): Record<string, unknown> {
  return {
    engine_id: config.engineId,
    resolver_id: config.resolverId,
    resolver_config: { ...config.resolverConfig },
    retry_mode: config.retryMode,
    retry_config: { ...config.retryConfig },
  }
}

/**
 * V5/V6 autorun commands. Run now composes `POST /sessions/` from the
 * autorun's config (contract: client-composed create). Export downloads the
 * single-item bundle; on blob failure the toast offers a copy fallback.
 */
export function useAutorunCommands() {
  const client = useQueryClient()
  const { toast } = useToast()
  const navigate = useLooseNavigate()

  const runNow = useCallback(
    async (autorun: Autorun) => {
      try {
        const session = await createSession({
          engine_id: autorun.engine_id,
          resolver_id: autorun.resolver_id,
          ...(autorun.resolver_config === undefined ? {} : { resolver_config: autorun.resolver_config }),
          ...(autorun.retry_mode === undefined ? {} : { retry_mode: autorun.retry_mode }),
          ...(autorun.retry_config === undefined ? {} : { retry_config: autorun.retry_config }),
          recording: autorun.recording === true,
        })
        toast({ kind: "success", title: "Session started" })
        void navigate({ to: "/sessions/$sessionId", params: { sessionId: String(session.id) } })
      } catch (error) {
        toast({
          kind: "error",
          title: "Could not start session",
          body: error instanceof ApiError ? error.message : undefined,
        })
      }
    },
    [navigate, toast],
  )

  const remove = useCallback(
    async (autorun: Autorun) => {
      try {
        await deleteAutorun(autorun.id)
        removeFromInfiniteLists(client, queryRoots.autoruns, autorun.id)
        void client.invalidateQueries({ queryKey: queryRoots.autoruns })
      } catch (error) {
        toast({
          kind: "error",
          title: "Delete failed",
          body: error instanceof ApiError ? error.message : undefined,
        })
      }
    },
    [client, toast],
  )

  const saveAsProfile = useCallback(
    async (autorun: Autorun, name: string): Promise<boolean> => {
      try {
        await saveAutorunAsProfile(autorun.id, name)
        void client.invalidateQueries({ queryKey: queryRoots.profiles })
        toast({ kind: "success", title: `Profile '${name}' saved` })
        return true
      } catch (error) {
        toast({
          kind: "error",
          title: "Save as profile failed",
          body: error instanceof ApiError ? error.message : undefined,
        })
        return false
      }
    },
    [client, toast],
  )

  const exportOne = useCallback(
    async (autorun: Autorun) => {
      try {
        const bundle = await fetchAutorunExport(autorun.id)
        const ok = downloadJson(`${autorun.snake_case_name || `autorun-${autorun.id}`}.json`, bundle)
        if (!ok) throw new Error("download failed")
      } catch {
        toast({
          kind: "error",
          title: "Export ready — copy the JSON",
          action: {
            label: "Copy",
            onClick: () => {
              void fetchAutorunExport(autorun.id).then((bundle) => {
                void navigator.clipboard.writeText(JSON.stringify(bundle, null, 2))
              })
            },
          },
        })
      }
    },
    [toast],
  )

  return { runNow, remove, saveAsProfile, exportOne }
}
