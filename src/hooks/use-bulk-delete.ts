/**
 * Shared bulk-delete hook.
 * Encapsulates the sequential delete mutation pattern used in all resource pages.
 */
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useMultiSelect } from "@/hooks/use-multi-select";
import { apiRequest } from "@/lib/api";

export function useBulkDelete(
	deleteFn: (id: number) => Promise<void>,
	entityName: string,
) {
	const multi = useMultiSelect();

	const mutation = useMutation({
		mutationFn: async (ids: number[]) => {
			const results = await Promise.allSettled(
				ids.map((id) => deleteFn(id)),
			);
			const failures = results.filter((r) => r.status === "rejected");
			if (failures.length > 0) {
				throw new Error(`${failures.length} of ${ids.length} deletions failed`);
			}
		},
		onSuccess: () => {
			multi.clear();
			toast.success(`${entityName} deleted`);
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
