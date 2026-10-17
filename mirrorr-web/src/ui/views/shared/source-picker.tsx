import { useSources } from "@/api";
import type { ResolverSource } from "@/api/schemas";
import { Field, Select } from "@/ui/components";

/**
 * Load a saved resolver config into the open form. Options are the sources for
 * the chosen resolver — or every source when none is chosen yet, since picking
 * one also selects its resolver. Renders nothing when no source exists.
 */
export function SourcePicker({
  resolverId,
  onPick,
  idPrefix,
}: {
  readonly resolverId: string;
  readonly onPick: (source: ResolverSource) => void;
  readonly idPrefix: string;
}) {
  const sources = useSources();
  if (sources.length === 0) return null;
  const options =
    resolverId === ""
      ? sources
      : sources.filter((item) => String(item.resolver_id) === resolverId);
  const id = `${idPrefix}-source`;

  return (
    <Field
      label="Load from a source"
      htmlFor={id}
      hint={
        options.length === 0
          ? "No sources for this resolver yet."
          : "Fills the resolver and its config."
      }
    >
      <Select
        id={id}
        value=""
        disabled={options.length === 0}
        onChange={(event) => {
          const picked = options.find(
            (item) => String(item.id) === event.target.value,
          );
          if (picked !== undefined) onPick(picked);
        }}
      >
        <option value="">Pick a saved source…</option>
        {options.map((item) => (
          <option key={item.id} value={String(item.id)}>
            {item.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
