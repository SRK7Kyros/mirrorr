import { useState } from "react"
import { formatCountdown, formatDateTime, formatDuration, formatWindow } from "@/api/time"
import type { NameMaps } from "@/api"
import {
  Button,
  CardGrid,
  Checkbox,
  EmptyState,
  EntityCard,
  ErrorPanel,
  Field,
  FilterSegmented,
  Input,
  MediaFill,
  PageToolbar,
  RowActions,
  StatLine,
  StatusChip,
  Tag,
  TimeZoneNote,
} from "@/ui/components"
import { Page, Section } from "@/ui/views/shared/page"

/**
 * `/design` — the primitive gallery, and the only place every slot state is
 * rendered side by side. It is not a product screen: it exists so a recipe that
 * has never been seen in a non-happy-path state cannot ship unseen, and so the
 * uniform-height rule is verifiable by eye and by test.
 */

const NAMES: NameMaps = {
  engines: new Map([[1, "Streamlink"]]),
  resolvers: new Map([[1, "Wide IPTV"]]),
  profiles: new Map([[1, "F1 Weekend"]]),
}

const NOW = new Date("2026-10-12T09:30:00Z")

const POSTER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1f1f26"/><stop offset="1" stop-color="#0a0a0c"/></linearGradient></defs><rect width="160" height="90" fill="url(#g)"/><circle cx="80" cy="45" r="14" fill="rgba(0,230,118,.16)"/><path d="M76 38l12 7-12 7z" fill="#00e676"/></svg>',
  )

const SESSION_ACTIONS = (
  <RowActions
    label="Actions for session #101"
    className="ml-auto"
    actions={[
      { label: "Save as profile", onSelect: () => undefined },
      { label: "Delete", danger: true, separatorBefore: true, onSelect: () => undefined },
    ]}
  />
)

function SessionChrome({ status }: { readonly status: string }) {
  return (
    <>
      <StatusChip status={status} />
      {SESSION_ACTIONS}
    </>
  )
}

function SessionIdentity({
  title,
  meta,
  id,
}: {
  readonly title: string
  readonly meta: string
  readonly id: number
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate font-semibold text-ink">{title}</span>
        <span className="shrink-0 font-mono text-xs tabular-nums text-dim">#{id}</span>
      </div>
      <span className="truncate text-sm text-dim">{meta}</span>
    </div>
  )
}

const SESSION_HERO = "text-2xl font-semibold tabular-nums text-ink"

export function DesignView() {
  const [filter, setFilter] = useState<"all" | "live" | "spent">("all")
  const [search, setSearch] = useState("")
  const windowText = formatWindow("2026-10-15T09:00:00", "2026-10-15T11:00:00", NOW)

  return (
    <Page
      title="Design"
      description="Every primitive and every card slot state, at the recipe's real height."
      actions={<Button variant="secondary">Not a product screen</Button>}
    >
      <Section title="Card gallery · Sessions" description="frame · plate · pinned remux line · failed reason">
        <CardGrid rowHeight={330} label="Session card states">
          <EntityCard
            header={<SessionChrome status="recording" />}
            media={
              <MediaFill fill="frame" label="Live preview">
                <div className="relative aspect-video bg-sunken">
                  <img src={POSTER} alt="" className="h-full w-full object-cover" />
                  <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-sm bg-[var(--overlay-scrim)] px-1.5 py-0.5 text-2xs font-semibold tracking-[0.06em] uppercase text-ink">
                    <span className="size-1.5 rounded-full bg-danger" /> live
                  </span>
                </div>
              </MediaFill>
            }
            hero={
              <div className="flex items-baseline justify-between gap-3">
                <span className={SESSION_HERO}>{formatDuration(4_212)}</span>
                <span className="text-xs text-dim">of 2:00:00</span>
              </div>
            }
            identity={<SessionIdentity title="Formula 1 — Qualifying" meta="Wide IPTV → Streamlink · started 08:12" id={101} />}
            footer={
              <div className="flex w-full items-center gap-2">
                <Button size="sm" variant="danger">Stop</Button>
                <span className="text-xs text-dim">1.8 GB captured</span>
              </div>
            }
          />

          <EntityCard
            header={<SessionChrome status="stream_pending" />}
            media={
              <MediaFill
                fill="plate"
                label="Waiting for the stream"
                fields={[
                  "Waiting on the engine process",
                  "Wide IPTV → Streamlink",
                  "attempt 1 · 00:42 elapsed",
                ]}
              />
            }
            hero={<span className={SESSION_HERO}>0:42</span>}
            identity={<SessionIdentity title="Formula 1 — Qualifying" meta="Wide IPTV → Streamlink · started 08:12" id={102} />}
            footer={<Button size="sm" variant="danger">Stop</Button>}
          />

          <EntityCard
            header={<SessionChrome status="remuxing" />}
            media={
              <MediaFill
                fill="cover"
                src="/design/not-a-real-file.mp4"
                poster={POSTER}
                label="Recorded file"
                pin={
                  <>
                    <span className="flex-1 truncate">Remuxing 68% · 127 MB written</span>
                    <span className="tabular-nums text-dim">1:53:10</span>
                  </>
                }
              />
            }
            hero={<span className={SESSION_HERO}>1:53:10</span>}
            identity={<SessionIdentity title="Formula 1 — Race" meta="Wide IPTV → Streamlink · ended 20:30" id={103} />}
            footer={<span className="text-xs text-dim">File kept while it finalises</span>}
          />

          <EntityCard
            header={<SessionChrome status="failed" />}
            media={
              <MediaFill
                fill="plate"
                tone="danger"
                label="No file — capture failed"
                fields={[
                  "Stream ended before the first segment",
                  "3 attempts · 12.0 MB captured",
                  "Retry lives in the actions menu",
                ]}
              />
            }
            hero={
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-md font-semibold text-danger">3 attempts used</span>
                <span className="text-xs text-dim">12.0 MB</span>
              </div>
            }
            identity={<SessionIdentity title="Formula 1 — Sprint" meta="Wide IPTV → Streamlink · started 16:00" id={104} />}
          />

          <EntityCard
            header={<SessionChrome status="completed" />}
            media={
              <MediaFill
                fill="plate"
                tone="success"
                label="Recorded — not published"
                fields={["2:30:00 · 2.1 GB", "Publish failed: media route not mounted", "File kept on disk"]}
              />
            }
            hero={<span className={SESSION_HERO}>2:30:00</span>}
            identity={<SessionIdentity title="Formula 1 — Race" meta="Wide IPTV → Streamlink · ended 20:30" id={105} />}
            footer={<Button size="sm" variant="outline">Open recording</Button>}
          />

          <EntityCard
            header={<SessionChrome status="terminating" />}
            media={<MediaFill fill="plate" label="Stopped by you" fields={["0:14:32 · 240 MB", "Stopped at 09:44", "File kept"]} />}
            hero={<span className={SESSION_HERO}>0:14:32</span>}
            identity={<SessionIdentity title="Formula 1 — Practice" meta="Wide IPTV → Streamlink · ended 09:44" id={106} />}
          />
        </CardGrid>
      </Section>

      <Section title="Card gallery · Autoruns" description="countdown hero · one window detail · flagged reason">
        <CardGrid rowHeight={250} label="Autorun card states">
          <EntityCard
            header={
              <>
                <StatusChip status="scheduled" />
                <RowActions
                  label="Actions for F1 Race"
                  className="ml-auto"
                  actions={[
                    { label: "Edit schedule", onSelect: () => undefined },
                    { label: "Run now", onSelect: () => undefined },
                    { label: "Delete", danger: true, separatorBefore: true, onSelect: () => undefined },
                  ]}
                />
              </>
            }
            hero={
              <div className="flex items-baseline gap-2">
                <span className={SESSION_HERO}>{formatCountdown("2026-10-15T09:00:00", NOW)}</span>
              </div>
            }
            detail={
              windowText === null ? null : (
                <div className="rounded-md border border-line bg-surface-3 px-3 py-2">
                  <div className="text-2xs font-medium tracking-[0.06em] uppercase text-dim">{windowText.date}</div>
                  <div className="text-base font-semibold text-ink">
                    {windowText.time}
                    <span className="ml-1.5 text-2xs font-normal text-dim">CEST</span>
                  </div>
                  <div className="text-sm text-dim">2:00:00 · local time</div>
                </div>
              )
            }
            identity={
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-semibold text-ink">F1 Race</span>
                  <Tag>f1-race</Tag>
                </div>
                <span className="truncate text-sm text-dim">Wide IPTV → Streamlink · F1 Weekend</span>
              </div>
            }
          />

          <EntityCard
            header={
              <>
                <StatusChip status="scheduled" />
                <RowActions
                  label="Actions for Flagged"
                  className="ml-auto"
                  actions={[{ label: "Edit schedule", onSelect: () => undefined }]}
                />
              </>
            }
            issue="profile-deleted"
            hero={<span className="text-lg font-semibold text-warning">Its profile was deleted</span>}
            detail={
              <div className="rounded-md border border-[color:rgba(227,179,65,0.35)] bg-warning-dim px-3 py-2">
                <div className="text-sm font-medium text-ink">Its profile was deleted, so it will not run</div>
                <div className="text-sm text-ink-muted">Nothing starts it until you pick a profile again.</div>
                <div className="text-sm text-dim">2026-10-15 09:00 → 11:00 · 2:00:00</div>
              </div>
            }
            identity={<SessionIdentity title="Flagged Window" meta="Wide IPTV → Streamlink · no profile" id={202} />}
          />

          <EntityCard
            header={
              <>
                <StatusChip status="completed" />
                <span className="ml-auto text-2xs font-medium tracking-[0.06em] uppercase text-dim">Retired</span>
              </>
            }
            hero={<span className={SESSION_HERO}>2:00:00</span>}
            detail={
              <div className="rounded-md border border-line bg-surface-3 px-3 py-2">
                <div className="text-base font-semibold text-ink">Ran once · 2026-10-08 18:00</div>
                <div className="text-sm text-dim">Retired — a one-shot schedule never repeats</div>
              </div>
            }
            identity={<SessionIdentity title="F1 Sprint" meta="Wide IPTV → Streamlink · F1 Weekend" id={203} />}
          />
        </CardGrid>
      </Section>

      <Section title="Card gallery · Recordings" description="served cover · unserved plate + copy link">
        <CardGrid rowHeight={330} label="Recording card states">
          <EntityCard
            header={
              <>
                <Tag>f1-race</Tag>
                <RowActions
                  label="Actions for recording #301"
                  className="ml-auto"
                  actions={[{ label: "Delete", danger: true, onSelect: () => undefined }]}
                />
              </>
            }
            media={<MediaFill fill="cover" src="/design/not-a-real-file.mp4" poster={POSTER} label="F1 Race preview" />}
            hero={<span className={SESSION_HERO}>2:30:00</span>}
            identity={<SessionIdentity title="F1 Race" meta="Wide IPTV → Streamlink · F1 Weekend · 2.0 GB" id={301} />}
            footer={
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline">Download</Button>
                <Button size="sm" variant="ghost">Copy link</Button>
              </div>
            }
          />
          <EntityCard
            header={
              <>
                <StatusChip status="completed" />
                <RowActions
                  label="Actions for recording #302"
                  className="ml-auto"
                  actions={[{ label: "Delete", danger: true, onSelect: () => undefined }]}
                />
              </>
            }
            media={
              <MediaFill
                fill="plate"
                label="File kept — not served"
                fields={["2:30:00 · 2.0 GB", "Media route is not mounted on this install", "Copy the internal link instead"]}
              />
            }
            hero={<span className={SESSION_HERO}>2:30:00</span>}
            identity={<SessionIdentity title="F1 Sprint" meta="Wide IPTV → Streamlink · F1 Weekend · 1.2 GB" id={302} />}
            footer={<Button size="sm" variant="ghost">Copy link</Button>}
          />
        </CardGrid>
      </Section>

      <Section title="Toolbar & states" description="one toolbar, one count, one zone note">
        <PageToolbar
          filters={
            <FilterSegmented
              ariaLabel="Filter sessions"
              value={filter}
              onChange={setFilter}
              items={[
                { id: "all", label: "All" },
                { id: "live", label: "Live" },
                { id: "spent", label: "Spent" },
              ]}
            />
          }
          search={<Input aria-label="Search" placeholder="Search sessions" value={search} onChange={(e) => setSearch(e.target.value)} />}
          sort={<Button variant="secondary" size="sm">Newest</Button>}
          count={<span>6 sessions</span>}
          select={<Checkbox label="Select" indeterminate />}
        />
        <TimeZoneNote />
        <StatLine items={["6 sessions", "3 live", "1 failed", "60 GB free"]} />
        <CardGrid rowHeight={260} label="Empty and error states">
          <EmptyState title="No sessions yet." text="A session is one capture run." action={<Button>New session</Button>} />
          <ErrorPanel message="Cannot reach the recorder — retry" onRetry={() => undefined} />
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-4">
            <Field label="Schedule name" htmlFor="design-name" required hint="Shown on the card">
              <Input id="design-name" placeholder="F1 Race" />
            </Field>
            <Field label="Start" htmlFor="design-start" error="End must be after start">
              <Input id="design-start" type="datetime-local" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="danger">Danger</Button>
            </div>
          </div>
        </CardGrid>
      </Section>

      <Section title="Vocabulary" description="The terms this build uses everywhere.">
        <dl className="grid grid-cols-1 gap-2 text-base sm:grid-cols-2">
          <div><dt className="font-semibold text-ink">Session</dt><dd className="text-ink-muted">One capture run.</dd></div>
          <div><dt className="font-semibold text-ink">Autorun</dt><dd className="text-ink-muted">A one-shot schedule. Never “Scheduled”.</dd></div>
          <div><dt className="font-semibold text-ink">Profile</dt><dd className="text-ink-muted">Reusable capture config.</dd></div>
          <div><dt className="font-semibold text-ink">Source</dt><dd className="text-ink-muted">Saved resolver + config.</dd></div>
          <div><dt className="font-semibold text-ink">Recording</dt><dd className="text-ink-muted">A finished media file.</dd></div>
          <div><dt className="font-semibold text-ink">Presets</dt><dd className="text-ink-muted">Gone. The word is not used anywhere.</dd></div>
        </dl>
        <p className="text-sm text-dim">Rendered at {formatDateTime("2026-10-12T09:30:00")} · names: {NAMES.profiles.get(1)}</p>
      </Section>
    </Page>
  )
}
