# Resolver Sources & Interactive Discovery

Design spec — **implemented** (P1–P4 + P5 pickers). Import/export bundles deferred (§7).
Core landed as `cb49cec`; web landed as the matching `mirrorr-web` commit. Deviations
from the draft are noted inline and summarised in §8.
Scope: `mirrorr-core` (models, API, plugin contract) + `mirrorr-web` (views, panel).

---

## 1. Summary

Two connected features:

1. **Resolver Sources** — a named, saved resolver config. Today the resolver section
   (`resolver_id` + `resolver_config`) is duplicated inline on every `Profile`,
   `Session` and `Autorun`. A source gives that pair a name so it can be saved once
   and re-loaded into any of them. It is **live**: it is not a link to a running
   thing, it is a config you run a resolver with.
2. **Interactive Discovery** — an optional capability a resolver plugin can
   implement so the user can browse/search what that resolver is built to handle,
   straight from the UI, and turn a result into a source.

The UI half of (2) is a **large scrollable panel**: a catalog of mosaics with a
search bar (and inline filters) on top; typing a query replaces the mosaics with
live results. A resolver may instead declare *search-only* (no catalog), in which
case the panel is just the input, waiting for a query.

---

## 2. Concepts & naming

| Term | Meaning |
|---|---|
| **Resolver** | Plugin that turns a config into a `Source` (`url` + `headers`). Unchanged. |
| **`Source`** | *Existing* dataclass — the resolver's **output**. Unchanged. (Name is taken; do not reuse.) |
| **ResolverSource** | *New.* A named saved `(resolver_id, resolver_config)`. Table `resolver_sources`, UI label **"Sources"**. |
| **Discovery** | *New.* Optional resolver capability: browse a catalog and/or search, returning candidate configs. |

A source is *just a saved resolver config with a name*. It carries no engine, no
retry, no session — those stay on the profile/session/autorun. Picking a source
fills `resolver_id` + `resolver_config` in whatever form is open.

---

## 3. Data model (`mirrorr-core/src/mirrorr/storage/models.py`)

```python
class ResolverSource(SQLModel, table=True):
    __tablename__ = "resolver_sources"

    id: int = Field(default=None, primary_key=True)
    name: str
    resolver_id: int = Field(foreign_key="resolvers.id")
    resolver_config: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    requester_user_token: str = Field(default="")

    resolver: "Resolver" = Relationship(back_populates="sources")
```

`Resolver` gains:

```python
    search_schema: dict[str, Any] = Field(default_factory=dict, sa_column=Column(SAJSON))
    sources: list["ResolverSource"] = Relationship(back_populates="resolver")
```

- `search_schema` is the JSON Schema of the resolver's **discovery filter model**
  (`{}` when the resolver has no discovery). It drives the inline filter UI.
- `ensure_db` auto-adds the new table/columns — no manual migration
  (see `startup/ensure_db.py`).
- `enums.py`: `ResourceType` gains `SOURCE = "source"` (for subscriptions/notifications).

---

## 4. Plugin contract (`mirrorr-core/src/mirrorr/plugin_api/interfaces.py`)

Discovery is **optional methods on `ResolverInterface`** (same style as
`EngineInterface`'s optional `retry_modes` / `should_retry`), not a separate ABC —
defaults make it a no-op so existing resolvers are untouched.

```python
@dataclass
class DiscoveryItem:
    """One catalog/search result — the shape the UI's mosaic card template fills."""
    id: str                              # resolver-scoped, stable
    title: str
    config: dict[str, Any]               # resolver_config to save as a source
    subtitle: str | None = None
    image: str | None = None             # mosaic thumbnail URL
    description: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)   # free-form badges/extras

@dataclass
class DiscoveryPage:
    items: list[DiscoveryItem]
    next_cursor: str | None = None       # opaque; None => end of results
```

```python
class ResolverInterface(ABC, Generic[ConfigT]):
    # …existing name / description / config_model / resolve / stop…

    # ── Optional discovery ────────────────────────────────────────────
    @property
    def discovery_model(self) -> type[BaseModel] | None:
        """Pydantic model of the *filter/params* the panel exposes inline.
        Any number/kind of fields. None => no discovery at all."""
        return None

    @property
    def discovery_has_catalog(self) -> bool:
        """True => the panel opens on a browsable catalog. False => search-only."""
        return False

    async def browse(
        self, params: BaseModel, cursor: str | None, context: ResolverContext
    ) -> DiscoveryPage | None:
        """Catalog page. Only called when discovery_has_catalog."""
        return None

    async def search(
        self, query: str, params: BaseModel, cursor: str | None, context: ResolverContext
    ) -> DiscoveryPage | None:
        """Search page. `query` is the user's text; `params` the inline filters."""
        return None
```

Notes
- **"Any number of any kind of parameter/args"** is served by `discovery_model`:
  the plugin declares an arbitrary Pydantic model; its `model_json_schema()` is
  what the UI renders.
- `ResolverContext` is reused with `session_folder` pointed at a per-resolver
  scratch dir (`{base_dir}/cache/discovery/{resolver_name}`) and the API's NATS
  `bus`. (Alternative if this feels stretched: a small `DiscoveryContext{cache_dir}`.)
- `_extract_db_fields` in `startup/ensure_resolvers.py` adds:
  `"search_schema": (instance.discovery_model.model_json_schema() if instance.discovery_model else {})`.
  A plugin file edit changes its hash → `ensure_plugins` resyncs the row on restart
  (same mechanism as the capabilities fix).

---

## 5. API surface (`mirrorr-core/src/mirrorr/api`)

### Sources — CRUD mirroring profiles

New `sources_router = APIRouter(prefix="/sources", route_class=PrivilegedRoute)`
in `routers/crud.py`, added to `crud_routers`; follows the existing pattern exactly
(`cursor`/`limit`/`include_total`, `_get_paginated_for_user`, `require_capability(..., Capability.X)`,
`subscribe_requester(..., ResourceType.SOURCE, id)`, `_safe_emit`).

| Method | Path | Body / returns |
|---|---|---|
| `GET` | `/sources/` | cursor page of `ResolverSourceResponse` |
| `GET` | `/sources/{id}` | `ResolverSourceResponse` |
| `POST` | `/sources/` | `CreateResolverSourceRequest{name, resolver_id, resolver_config}` |
| `PUT` | `/sources/{id}` | `UpdateResolverSourceRequest` |
| `DELETE` | `/sources/{id}` | `DeleteResultResponse` |

Schemas in `api/schemas.py` (next to the Profile block):

```python
class CreateResolverSourceRequest(BaseModel):
    name: str
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)

class UpdateResolverSourceRequest(BaseModel):   # all optional
    name: str | None = None
    resolver_id: int | None = None
    resolver_config: dict[str, Any] | None = None

class ResolverSourceResponse(BaseModel):
    id: int
    name: str
    resolver_id: int
    resolver_config: dict[str, Any] = Field(default_factory=dict)
    resolver_name: str | None = None
```

Optional convenience (mirrors `save-as-profile`):
`POST /profiles/{id}/save-as-source`, `POST /sessions/{id}/save-as-source`,
`POST /autoruns/{id}/save-as-source` → `{name}`. One generic create endpoint is
sufficient for v1; the UI can prefill.

`ResolverResponse` gains `search_schema: dict[str, Any] = {}` so the UI can render
the filter form without a second call.

### Discovery

Single endpoint (mode inferred — no `query` ⇒ browse):

```
POST /resolvers/{id}/discover
body: { "query": "…"?, "params": {…}, "cursor": "…"? }
→     { "items": [ {id,title,subtitle,image,description,config,meta}, … ],
        "next_cursor": "…" | null }
```

- Loads the resolver JIT via the existing `load_resolver_jit(resolvers_dir, origin, expected_hash)`.
- Validates `params` against `discovery_model`; calls `search` (query present) or
  `browse` (query absent).
- `404` if the resolver has no discovery; `400` on param validation failure.
- Read-only, but `POST` because `params` is arbitrary — it is not a cacheable GET.

---

## 6. Web UI (`mirrorr-web`)

### 6.1 Component extraction (prerequisite)

`SchemaForm`, `SchemaField`, `JsonField` and the `schema*` helpers currently live
**inside** `src/ui/views/profiles/profiles-view.tsx` (lines ~68–297). Extract them to
`src/ui/components/schema-form.tsx` so the source dialog and the discovery panel can
reuse them. `profiles-view.tsx` imports them back. Pure move, with one deliberate
addition: `SchemaField` had **no `type === "string"` branch**, so a plain text field
(e.g. `StaticConfig.url`) fell through to the JSON textarea. The extraction adds a
text `Input` branch, so text config fields render as
inputs instead of raw JSON.

### 6.2 New view + route + nav

Sources live **inside the Profiles tab** (§9.1), so there is no new top-level nav
entry and no `/sources` route of its own.

- `src/ui/views/profiles/profiles-view.tsx` — `ProfilesView` renders `ProfilesPanel`
  and `SourcesPanel` as two stacked `Section`s under one `Page title="Presets"` (the
  Profiles|Sources tab switcher this view used to own was deleted Oct 8 2026; the
  only kind toggle left is the one inside the create dialog, §6.5).
- `src/ui/views/profiles/sources-panel.tsx` — list (table ≥640px / cards <640px,
  mirroring profiles), delete via `BulkBar`/row action; create/edit is the Source tab
  of `presets-dialog.tsx` (§6.5). Implemented beside the profiles view rather than in a
  separate `views/sources/` dir.
- `src/api/query-keys.ts` — `sources`/`source` keys, `queryRoots.sources`, reuse
  `staleTimes`.
- `src/api/endpoints/index.ts` — `fetchSourcePage/fetchSource/createSource/updateSource/deleteSource`
  + `discoverResolver(id, body)`.
- `src/api/schemas/source.ts` — zod `ResolverSourceSchema`.

### 6.3 The discovery panel

`src/ui/views/shared/discovery-drawer.tsx` — a **large panel, not a modal**:
full-height, near-full-width on desktop (e.g. right-side sheet `w-[min(1100px,92vw)]`),
full-screen sheet on mobile. Scrollable body; header fixed.

```
┌─ Discovery · <resolver name> ───────────────────────── [×] ┐
│ [🔎 query…………………]  <n> of <m> matches "…"             │
├───────────────────────────────────────────────────────────┤
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   ← mosaics grid     │
│  │ img  │ │ img  │ │ img  │ │ img  │     (catalog)        │
│  │ title│ │ title│ │ title│ │ title│                      │
│  └──────┘ └──────┘ └──────┘ └──────┘                      │
│  … infinite scroll …                                       │
└───────────────────────────────────────────────────────────┘
```

- **One searchbox, no filter form.** The resolver's discovery filter model
  (`search_schema` / `discovery_model`) is deliberately **not** rendered — the row
  above is the panel's only control. A catalog resolver filters what it already
  holds, so a server-side filter would either duplicate or contradict that.
- **Catalog vs search**: if `has_catalog`, the body reads every page once (a
  background exhaust, not a scroll-gated one) and ranks the accumulated items
  locally through `rankBySearch` on each keystroke — no per-input request. A
  readout (`<n> of <m> matches "…"`) makes the re-rank visible, and says so when
  the catalog is still loading. Otherwise the panel is search-only: each debounced
  query hits `search`, and the body is empty until one arrives.
- **Mosaic card**: `image` (when present), `title`, `subtitle`, `description`, and
  one action — **Use**, which fills the open form's `resolver_config`. A
  **Save as source** action on the card was dropped as redundant: the panel is
  reached from the source form, which owns saving. (No separate
  `discovery-card.tsx`; the card is markup inside the drawer.)
- **Scroll, not pages**: `useInfiniteQuery` with `getNextPageParam` (the existing
  cursor contract) + an intersection-observer sentinel. Debounced (~250 ms) search
  input; requests cancelled via AbortController on new keystrokes.
- Entered from the source form, the profile / session / autorun dialogs — a
  **Browse `<resolver>`…** button, shown when `canBrowseResolver` is true: the
  resolver declares a browsable catalog (`has_catalog`) **or** a discovery model
  (`search_schema`, how a search-only plugin announces searchability, which the core
  always serializes as non-empty for such a plugin).

### 6.4 Saved sources in the other dialogs

`SourceFields` (`src/ui/views/shared/source-chain.tsx`) fills one capture's source
either way round: a resolver plus its `SchemaForm` config, or a **Saved source**
that fills both. The two are the same thing to the server, so they are one control
with two faces (`Resolver + config | Saved source`), and switching keeps whatever is
already filled — never both controls at once. It is mounted by `AutorunFormDialog`'s
engine + resolver branch, the session create dialog, and every rung of
`FallbackSources` (each sent as `{resolver_id, resolver_config}`).

**A face with nothing behind it is not offered (Oct 25 2026).** The switch is drawn
only when a saved source is actually pickable — excluding the run's own source and
any rung already in the chain. When none is, the panel says why in one line ("No
saved source to load — fill a resolver and its config." / "Every saved source is
already in this chain — …") and takes a resolver instead, because a `disabled`
segment answers a tap with silence: the reported bug was exactly that (a phone user
tapping **Saved source** and seeing nothing happen).

### 6.5 The Presets dialog (Oct 15 2026)

`src/ui/views/profiles/presets-dialog.tsx` — `PresetsDialog` — is one create/edit
dialog for both kinds the Presets page holds, opened by the page's single **New
preset** `Fab` and by either section's primary button. Each panel used to pin its own
`Fab` to the same corner: on a phone the two overlay exactly, so the source one won
every tap and a profile could not be created.

The kind switcher is a **phone affordance** — the `Fab` only exists under `sm` and is
the only create entry there, so it is the one entry that still has to ask, and it
carries a segmented **Profile | Source** control (`allowKindSwitch`). On a wide screen
each section keeps its own button and the dialog opens scoped to that kind, titled
after it, with nothing to choose. **Editing always locks the dialog to the kind being
edited** (no switcher, no cross-kind retarget). Only the active tab's `<form>` is
mounted, and the shared footer submits it via `form=` + `type="submit"`.

The profile body reads top-to-bottom in numbered blocks — Identity · Resolver · Engine &
retry, each a bordered `bg-surface-1` panel with an accent step index, an uppercase
title and, on the right, a lowercase clause saying what the block *decides* (`what it's
called` / `how the stream is found` / `how it's recorded`) — never an instruction, never
a question, and worded identically in the source form's Identity and Resolver blocks.
The *Resolver* block opens with the input-mode control, labelled `Config source`:
**Pick a resolver** (picker + the generated `config_schema` form) or **Use a saved
source** (picker + an accent-tinted card showing the copied `resolver_config`), and both
modes carry the same `Resolver config` sub-heading — the generated fields in one, the
copied values in the other.
Exactly one mode is rendered, so the two origins can no longer both be live; switching
to *Pick a resolver* keeps the copied resolver and config — only the link to the source
is dropped — and the copy stays editable. Resolver before engine is deliberate (the
resolver decides *what* is recorded, the engine only *how*), and the retry group in the
third block stays dimmed and disabled until an engine is chosen, because the modes are
the engine's — picking an engine selects its `none` mode, which is the same thing the
core falls back to when a profile carries no mode at all, so the picker has no extra
“no retry” entry beside the schema. Both segmented controls size to their own content (`self-start`) rather
than stretching into an empty full-width strip.

---

## 7. Events, permissions, import/export

- **Events** (`event_bus/event.py`): `ResolverSourceCreated/Updated/Deleted`
  (`resolver_source.created|updated|deleted`, `id: int`), emitted via `_safe_emit` like profiles.
  Add `SOURCE` to `ResourceType` and a handler branch if notifications are wanted.
- **Permissions**: sources are user-scoped exactly like profiles — **ownership is
  unchanged** (`requester_user_token` + `_get_paginated_for_user`). **Plus per-user
  capability grants** (2026-10-15; six-capability model 2026-10-16): the owner, an admin or a
  `SHARE` holder can grant any source a capability set through `resource_access`. Every gate
  goes through `services/permissions.py` `has_capability(db, auth, obj, Capability.X)` —
  `VIEW` for reads (list rows via `_get_paginated_for_user`'s unfiltered grant EXISTS),
  `OPERATE` for control, `EDIT` for "load this source into my own object", `DELETE`/`EXPORT`
  for their actions — and **VIEW is the base: any grant implies it, and nothing else is
  inherited** (the old `_require_owner_or_admin` is deleted).
  `ResolverSourceResponse` remains an entry in `privileged.py`'s `PRIVILEGED_FIELDS`, so a
  granted (non-admin) reader still never receives `requester_user_token`.
- **Import/export** (`routers/import_export.py`): add a `sources` array to bundles
  (`{name, resolver:{name,origin_hash}, resolver_config, content_hash}`), mirroring
  `_profile_to_bundle`. Can ship in a later phase; bundles without sources still apply.

---

## 8. Phasing

| Phase | Deliverable | Status |
|---|---|---|
| **P1 — core model + CRUD** | `ResolverSource` model, `ResourceType.SOURCE`, schemas, `/sources` router, events | ✅ done (`cb49cec`) |
| **P2 — plugin contract** | `DiscoveryItem`/`DiscoveryPage`, optional `ResolverInterface` methods, `search_schema` column + extractor, `POST /resolvers/{id}/discover` | ✅ done (`cb49cec`) |
| **P3 — web foundations** | extract `schema-form.tsx` (+ `string` branch); sources sub-tab + query keys + endpoints | ✅ done |
| **P4 — discovery panel** | overlay drawer + cards + inline filters + infinite scroll | ✅ done |
| **P5 — pickers** | saved-source control in the profile / session / autorun dialogs (the profile form's is the mode switcher in §6.5) | ✅ done |
| **P5b — import/export bundles** | `sources` array in bundles (§7) | ⏳ deferred |

Verified: core `pytest` (incl. `tests/test_resolver_discovery.py`); web `typecheck` /
80 unit tests / `build` / `check:tokens` 97 / `check:contrast` 43; and a
route-fulfilled Playwright pass at 375 + 1280 (`.omo/verify-sources.mjs`) exercising
the Sources section, source create, discovery catalog + search + Use, and the profile
form's saved-source mode — 0 console errors, 0 failed requests. **Oct 15 2026:** the
saved-source picker left the profile form (it is a mode of it now, §6.5) and the
Presets create/edit path is covered by `mirrorr-web/tests/e2e/presets.spec.ts` (5
cases) with the visual gate untouched at 52/52.

Each phase keeps the existing gates green: core `pytest`; web `typecheck` / `test:unit`
/ `build` / `check-tokens` / `check-contrast`.

---

## 9. Decisions (confirmed)

1. **Naming & placement.** UI label **"Sources"** — code `ResolverSource`, table
   `resolver_sources`, API `/sources/`. They live **inside the Profiles nav tab**
   (a sub-tab/section), not a separate top-level nav entry.
2. **Item shape.** The standard **`DiscoveryItem` envelope**
   (image/title/subtitle/description/meta/config).
3. **Panel.** An **overlay** panel component (not a route).
4. **Context.** **Reuse `ResolverContext`** with a per-resolver scratch dir.
5. **Browse vs search.** **Inferred** from `query` presence.

---

## 10. Reference (existing code this builds on)

- Models: `storage/models.py` — `Profile` (148–163), `Session` (109–145), `Autorun` (78–106), `Resolver` (183–195).
- Plugin ABCs: `plugin_api/interfaces.py` — `ResolverInterface` (172–205), `Source` (33–38), `ResolverContext` (59–63).
- Sync: `startup/ensure_resolvers.py` — `_extract_db_fields` (26–33), `sync_resolvers_db` (47–57); generic `startup/ensure_plugins.py`.
- Routers: `api/routers/crud.py` (profiles 790–855, `_serialize_profile` 356–361, `_create_profile_from_entity` 631–664); `api/api.py` `include_router(crud_routers)`.
- Events/enums: `event_bus/event.py` (`ProfileCreated` 85–87); `storage/enums.py` `ResourceType`.
- Web: `ui/views/profiles/profiles-view.tsx` (`ProfilesView`, `ProfilesPanel`), `ui/views/profiles/sources-panel.tsx` (`SourcesPanel`), `ui/views/profiles/presets-dialog.tsx` (`PresetsDialog` — create/edit for both kinds; `SchemaForm`/`SchemaField` have lived in `ui/components/schema-form.tsx` since Oct 8 2026); `routes/route-tree.tsx`; `ui/chrome/nav-items.tsx`; `api/query-keys.ts` (cursor contract); `api/endpoints/index.ts`.
