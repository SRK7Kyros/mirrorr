/**
 * Import/export wire contracts.
 *
 * Contract: `docs/general-client-specification.md` §9 (bundle shape, validate
 * report, apply body) and §13.5 (wire details). The bundle is a portable
 * snapshot of profiles + autoruns; the raw file object is the validate body,
 * while apply wraps the EDITED bundle together with the resolution payload.
 *
 * Every object is `.passthrough()`: the client parses a bundle it did not
 * author, edits two keys at most, and must round-trip unknown fields
 * untouched (the server owns the schema's evolution).
 */
import { z } from "zod"

/** `{name, origin_hash}` reference to an engine or resolver. */
export const pluginRefSchema = z
  .object({
    name: z.string(),
    origin_hash: z.string(),
  })
  .passthrough()

/** A plugin as installed on the server (`{id, name, origin_hash}` plus extras). */
export const installedPluginRefSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    origin_hash: z.string(),
  })
  .passthrough()

/**
 * One exported profile entry (contract §9 "Bundle shape (profile)").
 *
 * Entry shape is intentionally permissive: the client-side parse is a guard
 * (JSON/version/size), NOT a validator — the server's `validate` call owns
 * per-entry diagnostics, so a sparse entry must reach it and come back with
 * issues rather than being rejected in the browser.
 */
export const bundleProfileSchema = z
  .object({
    name: z.string(),
    default_engine: pluginRefSchema.optional(),
    resolver: pluginRefSchema.optional(),
    resolver_config: z.record(z.string(), z.unknown()).nullable().optional(),
    retry_mode: z.string().nullable().optional(),
    retry_config: z.record(z.string(), z.unknown()).nullable().optional(),
    content_hash: z.string().optional(),
  })
  .passthrough()

/**
 * One exported autorun entry. `profile` is the embedded profile — the bind
 * resolution rewrites it to `{"name": "<installed>"}`, the inline resolution
 * removes it entirely.
 */
export const bundleAutorunSchema = z
  .object({
    user_friendly_name: z.string(),
    profile_name: z.string().optional(),
    profile: bundleProfileSchema.partial().optional(),
    start_time: z.string().nullable().optional(),
    end_time: z.string().nullable().optional(),
    recording: z.boolean().optional(),
    engine_override: pluginRefSchema.optional(),
    content_hash: z.string().optional(),
  })
  .passthrough()

export const bundleSchema = z
  .object({
    version: z.number().int(),
    exported_at: z.string().optional(),
    profiles: z.array(bundleProfileSchema).default([]),
    autoruns: z.array(bundleAutorunSchema).default([]),
  })
  .passthrough()

/** One validate issue; `problem` is the discriminator the badges read. */
export const validateIssueSchema = z
  .object({
    problem: z.string(),
    field: z.string().optional(),
    bundled: pluginRefSchema.optional(),
    installed: installedPluginRefSchema.optional(),
    alternatives: z.array(installedPluginRefSchema).optional(),
    existing_id: z.number().int().optional(),
    new_name: z.string().optional(),
    profile_name: z.string().optional(),
  })
  .passthrough()

export const validateItemSchema = z
  .object({
    name: z.string(),
    content_hash: z.string().optional(),
    valid: z.boolean(),
    issues: z.array(validateIssueSchema).default([]),
  })
  .passthrough()

export const validateReportSchema = z
  .object({
    valid: z.boolean(),
    profiles: z.array(validateItemSchema).default([]),
    autoruns: z.array(validateItemSchema).default([]),
  })
  .passthrough()

/** The three contract counts; the live core also returns `created`/`renamed`. */
export const applyResponseSchema = z
  .object({
    profiles_created: z.number().int(),
    profiles_skipped: z.number().int(),
    autoruns_created: z.number().int(),
  })
  .passthrough()

/** `{<origin_hash>: {type, id}}` — only for not_installed/hash_mismatch. */
export type PluginMap = Record<string, { readonly type: "engine" | "resolver"; readonly id: number }>

export interface ApplyBody {
  readonly bundle: Bundle
  readonly plugin_map: PluginMap
  readonly removed_profiles?: readonly string[]
  readonly removed_autoruns?: readonly string[]
}

export type PluginRef = z.infer<typeof pluginRefSchema>
export type InstalledPluginRef = z.infer<typeof installedPluginRefSchema>
export type BundleProfile = z.infer<typeof bundleProfileSchema>
export type BundleAutorun = z.infer<typeof bundleAutorunSchema>
export type Bundle = z.infer<typeof bundleSchema>
export type ValidateIssue = z.infer<typeof validateIssueSchema>
export type ValidateItem = z.infer<typeof validateItemSchema>
export type ValidateReport = z.infer<typeof validateReportSchema>
export type ApplyResponse = z.infer<typeof applyResponseSchema>
