/**
 * Shared "save as profile" hook.
 * Encapsulates the save-as-profile state, mutation, and UI logic
 * used in sessions/detail and autoruns/detail.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useSaveAsProfile(
    saveFn: (entityId: number, name: string) => Promise<void>,
    entityLabel: string,
) {
    const queryClient = useQueryClient();
    const [name, setName] = useState("");
    const [open, setOpen] = useState(false);

    const mutation = useMutation({
        mutationFn: ({ id, name }: { id: number; name: string }) =>
            saveFn(id, name),
        onSuccess: () => {
            setOpen(false);
            setName("");
            queryClient.invalidateQueries({ queryKey: ["profiles"] });
            toast.success(`Profile created from ${entityLabel}`);
        },
        onError: (err: Error) =>
            toast.error(`Failed to save as profile: ${err.message}`),
    });

    return {
        name,
        setName,
        open,
        setOpen,
        save: (id: number) => mutation.mutate({ id, name: name.trim() }),
        isPending: mutation.isPending,
    };
}
