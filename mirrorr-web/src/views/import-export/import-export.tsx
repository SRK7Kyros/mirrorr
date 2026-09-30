import { useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/ui/Button"
import { ErrorPanel } from "@/components/ui/ErrorPanel"
import { useToast } from "@/components/ui/Toast"
import { ApiError } from "@/lib/api"
import { queryRoots } from "@/lib/query-keys"
import {
  applyImport,
  validateBundle,
  type ImportApplySummary,
  type ImportValidateReport,
} from "@/views/shared/api"
import { useEngines, useProfiles, useResolvers } from "@/views/shared/hooks"
import { RouteLink } from "@/views/shared/parts"
import {
  BUNDLE_ITEM_LIMIT,
  buildApplyBody,
  countBundleItems,
  isSupportedVersion,
  issueKind,
  issueOriginHash,
  issuePluginType,
  type ItemResolution,
} from "./bundle"
import { ResolveStep, ReviewStep } from "./import-steps"

const STEPS = ["Choose file", "Review", "Resolve", "Apply"] as const

/**
 * V10 — Import wizard (file → validate → map → apply) + export explainer.
 * Apply encodes the body locally via `buildApplyBody` (no second validate).
 */
export function ImportExportView() {
  const engines = useEngines()
  const resolvers = useResolvers()
  const profiles = useProfiles()
  const client = useQueryClient()
  const { toast } = useToast()
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [step, setStep] = useState(0)
  const [bundle, setBundle] = useState<unknown>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [report, setReport] = useState<ImportValidateReport | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, ItemResolution>>({})
  const [included, setIncluded] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<ImportApplySummary | null>(null)

  const resetWizard = () => {
    setStep(0)
    setBundle(null)
    setFileName(null)
    setReport(null)
    setResolutions({})
    setIncluded({})
    setError(null)
    setSummary(null)
  }

  const items = useMemo(() => report?.items ?? [], [report])
  const overLimit = bundle !== null && countBundleItems(bundle) > BUNDLE_ITEM_LIMIT
  const versionOk = bundle === null ? true : isSupportedVersion(bundle)

  const readFile = async (file: File) => {
    setError(null)
    setSummary(null)
    setFileName(file.name)
    try {
      const parsed: unknown = JSON.parse(await file.text())
      setBundle(parsed)
      if (!isSupportedVersion(parsed)) {
        setError("Unsupported bundle version")
        setReport(null)
        return
      }
      if (countBundleItems(parsed) > BUNDLE_ITEM_LIMIT) {
        setError("Bundle exceeds 500 items")
        setReport(null)
        return
      }
    } catch {
      setError("Could not parse the bundle as JSON")
      setBundle(null)
    }
  }

  const runValidate = async () => {
    if (bundle === null) return
    setBusy(true)
    setError(null)
    try {
      const next = await validateBundle(bundle)
      setReport(next)
      const nextResolutions: Record<string, ItemResolution> = {}
      const nextIncluded: Record<string, boolean> = {}
      for (const item of next.items) {
        nextIncluded[item.name] = true
        const res: {
          included: boolean
          plugin?: ItemResolution["plugin"]
          pluginHash?: string
          profile?: ItemResolution["profile"]
          engine?: ItemResolution["engine"]
        } = {
          included: true,
        }
        for (const issue of item.issues) {
          const kind = issueKind(issue)
          if (kind === "not_installed" || kind === "hash_mismatch") {
            const hash = issueOriginHash(issue)
            const type = issuePluginType(issue)
            const installed = type === "engine" ? engines : resolvers
            const match = hash === null ? undefined : installed.find((entry) => entry.origin_hash === hash)
            if (match !== undefined && hash !== null) {
              res.plugin = { type, id: match.id }
              res.pluginHash = hash
            }
          }
          if (kind === "profile_missing") res.profile = { mode: "inline" }
          if (kind === "engine_override") res.engine = { mode: "keep" }
        }
        nextResolutions[item.name] = res
      }
      setResolutions(nextResolutions)
      setIncluded(nextIncluded)
      setStep(1)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Validation failed")
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (report === null) return
    setBusy(true)
    setError(null)
    const effective: Record<string, ItemResolution> = {}
    for (const item of items) {
      effective[item.name] = { ...(resolutions[item.name] ?? { included: true }), included: included[item.name] !== false }
    }
    try {
      const body = buildApplyBody(bundle, items, effective)
      const result = await applyImport(body)
      setSummary(result)
      void client.invalidateQueries({ queryKey: queryRoots.profiles })
      void client.invalidateQueries({ queryKey: queryRoots.autoruns })
      setStep(3)
      toast({
        kind: "success",
        title: `Imported — ${result.profiles_created} profiles, ${result.autoruns_created} autoruns`,
      })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Apply failed")
      setStep(2)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="view">
      <div className="view-header">
        <h1 className="view-title">Import / Export</h1>
      </div>

      <section className="card card-stack">
        <nav className="step-indicator" aria-label="Import steps">
          {STEPS.map((label, index) => (
            <span
              key={label}
              className="step-indicator__step"
              data-state={index === step ? "active" : index < step ? "done" : "upcoming"}
            >
              {index < step ? `✓ ${label}` : label}
              {index < STEPS.length - 1 ? <span className="step-indicator__rule" /> : null}
            </span>
          ))}
        </nav>

        {error !== null ? (
          <ErrorPanel
            title={
              error === "Bundle exceeds 500 items" || error === "Unsupported bundle version"
                ? error
                : "Unexpected server response"
            }
            body={error}
          />
        ) : null}

        {step === 0 ? (
          <>
            <div
              className="dropzone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault()
                const file = event.dataTransfer.files[0]
                if (file !== undefined) void readFile(file)
              }}
            >
              <p className="t-body">Drop the bundle here</p>
              <Button variant="ghost" onClick={() => fileRef.current?.click()}>
                Choose file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json"
                aria-label="Bundle file"
                style={{ position: "absolute", opacity: 0 }}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file !== undefined) void readFile(file)
                }}
              />
            </div>
            {fileName !== null ? <p className="t-meta">{fileName}</p> : null}
            {overLimit ? null : (
              <Button
                variant="primary"
                disabled={bundle === null || !versionOk}
                loading={busy}
                onClick={() => void runValidate()}
              >
                Validate
              </Button>
            )}
          </>
        ) : null}

        {step === 1 && report !== null ? (
          <ReviewStep
            items={items}
            included={included}
            onToggleInclude={(name, next) =>
              setIncluded((current) => ({ ...current, [name]: next }))
            }
            onBack={() => setStep(0)}
            onNext={() => setStep(2)}
            onCancel={resetWizard}
          />
        ) : null}

        {step === 2 && report !== null ? (
          <ResolveStep
            items={items}
            resolutions={resolutions}
            setResolutions={setResolutions}
            engines={engines}
            resolvers={resolvers}
            busy={busy}
            profiles={profiles}
            onBack={() => setStep(1)}
            onApply={() => void apply()}
            onCancel={resetWizard}
          />
        ) : null}

        {step === 3 && summary !== null ? (
          <div className="card">
            <h2 className="card__title">Import complete</h2>
            <div className="metrics">
              <div className="metrics__item">
                <span className="metrics__value">{summary.profiles_created}</span>
                <span className="metrics__label">profiles created</span>
              </div>
              <div className="metrics__item">
                <span className="metrics__value">{summary.profiles_skipped}</span>
                <span className="metrics__label">profiles skipped</span>
              </div>
              <div className="metrics__item">
                <span className="metrics__value">{summary.autoruns_created}</span>
                <span className="metrics__label">autoruns created</span>
              </div>
            </div>
            <RouteLink to="/profiles" className="t-body">
              View profiles
            </RouteLink>
          </div>
        ) : null}
      </section>

      <section className="card card-stack">
        <h2 className="card__title">Export</h2>
        <p className="t-body view-subtitle">
          Export lives as row actions on the Profiles and Autoruns views — each downloads a
          version-1 JSON bundle you can import here.
        </p>
      </section>
    </div>
  )
}
