/**
 * Shared bulk-delete hook.
 * Encapsulates the sequential delete mutation pattern used in all resource pages.
 */
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMultiSelect } from "@/hooks/use-multi-select";
import { describeCascade } from "@/lib/utils";

export function useBulkDelete(
	deleteFn: (id: number) => Promise<unknown>,
	entityName: string,
) {
	const multi = useMultiSelect();

	const mutation = useMutation({
		mutationFn: async (ids: number[]) => {
			const results = await Promise.allSettled(ids.map((id) => deleteFn(id)));
			const failures = results.filter((r) => r.status === "rejected");
			if (failures.length > 0) {
				throw new Error(`${failures.length} of ${ids.length} deletions failed`);
			}
			return results;
		},
		onSuccess: (results) => {
			multi.clear();
			const cascades = results
				.filter(
					(r): r is PromiseFulfilledResult<{ deleted?: Record<string, number> }> =>
						r.status === "fulfilled" &&
						typeof r.value === "object" &&
						r.value !== null &&
						"deleted" in r.value,
				)
				.map((r) => r.value as { deleted: Record<string, number> })
				.map(describeCascade)
				.filter(Boolean);
			const cascadeMsg =
				cascades.length > 0
					? ` — also removed ${Array.from(new Set(cascades)).join(", ")}`
					: "";
			toast.success(`${entityName} deleted${cascadeMsg}`);
		},
		onError: (err: Error) =>
			toast.error(
				`Failed to delete ${entityName.toLowerCase()}: ${err.message}`,
			),
	});

	return {
		...mutation,
		mutate: () => mutation.mutate([...multi.selectedIds]),
		selectedIds: multi.selectedIds,
		clearSelection: multi.clear,
	};
}
