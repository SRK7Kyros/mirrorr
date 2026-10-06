import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ApiError,
  createAutorun,
  getErrorMessage,
  updateAutorun,
  useEngines,
  useProfiles,
  useResolvers,
  type AutorunBody,
} from "@/api"
import { queryKeys, queryRoots } from "@/api/query-keys"
import { isLive } from "@/api/domain/filter-grammar"
import type { Autorun } from "@/api/schemas"
import { datetimeLocalToNaiveUtc, naiveUtcToDatetimeLocal, parseNaiveUtc } from "@/api/time"
import {
  Banner,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Select,
  Switch,
  toast,
} from "@/ui/components"

/** Slug grammar enforced live in the wizard (spec §5.5). */
const SLUG_RE = /^[a-zA-Z0-9_-]+$/

/** Friendly name → URL-safe slug preview (spec §5.5 auto-slug). */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
}

interface FieldIssues {
  readonly slug?: string
  readonly time?: string
  readonly general?: string
}

/** 400 duplicate → slug field; 422 tz → time field; else general (spec §5.5). */
function mapAutorunError(error: unknown): FieldIssues {
  if (error instanceof ApiError) {
    const fieldErrors = error.fieldErrors
    if (fieldErrors !== undefined) {
      const keys = Object.keys(fieldErrors)
      if (keys.includes("snake_case_name")) {
        return { slug: "A resource with that name already exists." }
      }
      if (keys.includes("start_time") || keys.includes("end_time")) {
        return { time: "Use the local-time picker — times are stored as UTC." }
      }
    }
    if (error.status === 400 && /already exists|duplicate/i.test(error.message)) {
      return { slug: "A resource with that name already exists." }
    }
    if (error.status === 422 && /(timezone|tz|offset|suffix|utc)/i.test(error.message)) {
      return { time: "Use the local-time picker — times are stored as UTC." }
    }
    return { general: error.message }
  }
  return { general: getErrorMessage(error, "Could not save the scheduled recording") }
}

/**
 * Create / edit wizard — one-shot schedule: name + auto-slug, local-time
 * start/end pickers (stored UTC), profile or direct config, recording toggle
 * (default on). Live runs lock the config fields and warn on a past start.
 */
export function AutorunFormDialog({
  open,
  onClose,
  autorun,
}: {
  readonly open: boolean
  readonly onClose: () => void
  readonly autorun?: Autorun
}) {
  const queryClient = useQueryClient()
  const profiles = useProfiles()
  const engines = useEngines()
  const resolvers = useResolvers()
  const editing = autorun !== undefined

  const [friendly, setFriendly] = useState("")
  const [slug, setSlug] = useState("")
  const [slugTouched, setSlugTouched] = useState(false)
  const [startLocal, setStartLocal] = useState("")
  const [endLocal, setEndLocal] = useState("")
  const [mode, setMode] = useState<"profile" | "custom">("profile")
  const [profileId, setProfileId] = useState("")
  const [engineId, setEngineId] = useState("")
  const [resolverId, setResolverId] = useState("")
  const [recording, setRecording] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)
  const [timeError, setTimeError] = useState<string | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const openedRef = useRef<string | null>(null)

  useEffect(() => {
    if (!open) {
      openedRef.current = null
      return
    }
    const key = autorun === undefined ? "new" : String(autorun.id)
    if (openedRef.current === key) return
    openedRef.current = key
    setError(null)
    setSlugError(null)
    setTimeError(null)
    setConfirmEnd(false)
    if (autorun === undefined) {
      setFriendly("")
      setSlug("")
      setSlugTouched(false)
      setStartLocal("")
      setEndLocal("")
      setMode(profiles.length > 0 ? "profile" : "custom")
      setProfileId("")
      setEngineId("")
      setResolverId("")
      setRecording(true)
      return
    }
    setFriendly(autorun.user_friendly_name)
    setSlug(autorun.snake_case_name)
    setSlugTouched(true)
    setStartLocal(naiveUtcToDatetimeLocal(autorun.start_time))
    setEndLocal(naiveUtcToDatetimeLocal(autorun.end_time))
    const existingProfile = autorun.profile_id
    setMode(existingProfile !== null && existingProfile !== undefined ? "profile" : "custom")
    setProfileId(existingProfile !== null && existingProfile !== undefined ? String(existingProfile) : "")
    setEngineId(String(autorun.engine_id))
    setResolverId(String(autorun.resolver_id))
    setRecording(autorun.recording !== false)
  }, [open, autorun, profiles.length])

  const live = editing && isLive(autorun.status)
  const startInPast = startLocal !== "" && new Date(startLocal).getTime() < Date.now()
  const endBeforeStart =
    startLocal !== "" && endLocal !== "" && new Date(endLocal).getTime() <= new Date(startLocal).getTime()
  const endEarlierWhileLive =
    live &&
    autorun !== undefined &&
    endLocal !== "" &&
    new Date(endLocal).getTime() < parseNaiveUtc(autorun.end_time).getTime()
  const canSubmit = mode === "profile" ? profileId !== "" : engineId !== "" && resolverId !== ""

  const save = useMutation({
    mutationFn: (body: AutorunBody) =>
      autorun === undefined ? createAutorun(body) : updateAutorun(autorun.id, body),
    onSuccess: (saved) => {
      toast.success(
        autorun === undefined ? "Scheduled recording created" : "Scheduled recording updated",
        saved.user_friendly_name,
      )
      void queryClient.invalidateQueries({ queryKey: queryRoots.autoruns })
      void queryClient.invalidateQueries({ queryKey: queryKeys.autorun(saved.id) })
      onClose()
    },
    onError: (caught) => {
      const issues = mapAutorunError(caught)
      setSlugError(issues.slug ?? null)
      setTimeError(issues.time ?? null)
      setError(issues.general ?? null)
    },
  })

  const persist = () => {
    setError(null)
    setSlugError(null)
    setTimeError(null)
    save.mutate({
      user_friendly_name: friendly.trim(),
      snake_case_name: slug,
      start_time: datetimeLocalToNaiveUtc(startLocal),
      end_time: datetimeLocalToNaiveUtc(endLocal),
      recording,
      ...(mode === "profile"
        ? { profile_id: Number(profileId) }
        : { engine_id: Number(engineId), resolver_id: Number(resolverId) }),
    })
  }

  const submit = () => {
    setError(null)
    setSlugError(null)
    setTimeError(null)
    if (!SLUG_RE.test(slug)) {
      setSlugError("Use letters, numbers, hyphens and underscores only.")
      return
    }
    if (startLocal === "" || endLocal === "") {
      setTimeError("Pick a start and end time.")
      return
    }
    if (endBeforeStart) {
      setTimeError("End must be after start.")
      return
    }
    if (!canSubmit) {
      setError("Pick a profile, or an engine and resolver.")
      return
    }
    if (endEarlierWhileLive) {
      setConfirmEnd(true)
      return
    }
    persist()
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title={editing ? "Edit scheduled recording" : "New scheduled recording"}
        description="A scheduled recording runs once at its start time and then retires."
        size="lg"
        busy={save.isPending}
        footer={
          <>
            <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
              Cancel
            </Button>
            <Button variant="primary" loading={save.isPending} disabled={!canSubmit} onClick={submit}>
              {editing ? "Save changes" : "Create scheduled recording"}
            </Button>
          </>
        }
      >
        <div className="stack">
          {error !== null ? <Banner kind="danger" title={error} /> : null}
          {startInPast && autorun?.status === "scheduled" ? (
            <Banner kind="warning" title="Start time is in the past — the server will fire it immediately." />
          ) : null}

          <Field label="Name" htmlFor="autorun-friendly" required>
            <Input
              id="autorun-friendly"
              value={friendly}
              autoComplete="off"
              placeholder="e.g. Nightly news"
              onChange={(event) => {
                const value = event.target.value
                setFriendly(value)
                if (!slugTouched) setSlug(slugify(value))
              }}
            />
          </Field>

          <Field
            label="Slug"
            htmlFor="autorun-slug"
            required
            error={slugError}
            hint={`Used in URLs. Preview: ${slug === "" ? "—" : slug}`}
          >
            <Input
              id="autorun-slug"
              value={slug}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={slugError !== null}
              onChange={(event) => {
                setSlugTouched(true)
                setSlug(event.target.value)
              }}
            />
          </Field>

          <div className="grid-2">
            <Field label="Start" htmlFor="autorun-start" required hint="Your local time — stored as UTC">
              <Input
                id="autorun-start"
                type="datetime-local"
                value={startLocal}
                onChange={(event) => setStartLocal(event.target.value)}
              />
            </Field>
            <Field
              label="End"
              htmlFor="autorun-end"
              required
              error={timeError}
              hint="Your local time — stored as UTC"
            >
              <Input
                id="autorun-end"
                type="datetime-local"
                value={endLocal}
                onChange={(event) => setEndLocal(event.target.value)}
              />
            </Field>
          </div>

          <Field
            label="Config source"
            htmlFor="autorun-mode"
            hint={live ? "Changes affect a future run, not the current one." : undefined}
          >
            <Select
              id="autorun-mode"
              value={mode}
              disabled={live}
              onChange={(event) => setMode(event.target.value === "custom" ? "custom" : "profile")}
            >
              <option value="profile" disabled={profiles.length === 0}>
                Use a profile
              </option>
              <option value="custom">Pick engine + resolver</option>
            </Select>
          </Field>

          {mode === "profile" ? (
            <Field label="Profile" htmlFor="autorun-profile" required>
              <Select
                id="autorun-profile"
                value={profileId}
                disabled={live}
                onChange={(event) => setProfileId(event.target.value)}
              >
                <option value="">Select a profile…</option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={String(profile.id)}>
                    {profile.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : (
            <div className="grid-2">
              <Field label="Engine" htmlFor="autorun-engine" required>
                <Select
                  id="autorun-engine"
                  value={engineId}
                  disabled={live}
                  onChange={(event) => setEngineId(event.target.value)}
                >
                  <option value="">Select an engine…</option>
                  {engines.map((engine) => (
                    <option key={engine.id} value={String(engine.id)}>
                      {engine.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Resolver" htmlFor="autorun-resolver" required>
                <Select
                  id="autorun-resolver"
                  value={resolverId}
                  disabled={live}
                  onChange={(event) => setResolverId(event.target.value)}
                >
                  <option value="">Select a resolver…</option>
                  {resolvers.map((resolver) => (
                    <option key={resolver.id} value={String(resolver.id)}>
                      {resolver.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <Switch
            label="Record this scheduled run"
            checked={recording}
            onChange={(event) => setRecording(event.target.checked)}
          />
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        title="Move the end time earlier?"
        description="Moving the end time earlier may stop the running recording."
        confirmLabel="Move end time"
        onConfirm={() => {
          setConfirmEnd(false)
          persist()
        }}
      />
    </>
  )
}
