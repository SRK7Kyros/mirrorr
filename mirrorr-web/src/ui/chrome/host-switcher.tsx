import { useEffect, useState } from "react";
import { hostPickerUrl, isNativeShell, readShellHosts } from "@/api/native";
import {
  IconExternal,
  IconServer,
  menuItemClass,
  MenuSeparator,
  Tag,
} from "@/ui/components";

/**
 * Which host this console is running from, and the way back to the host list —
 * which is also where auto-connect is chosen, since the shell's launch target is
 * one host for the whole app and only that list knows every host. The name comes
 * from the record the picker writes; in a browser there is no such record, so
 * this renders nothing at all.
 */
export function HostSwitcher() {
  const origin = window.location.origin;
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readShellHosts().then((state) => {
      if (!live || state === null) return;
      // A host the picker has no name for is still worth naming — by its address.
      setName(
        state.hosts.find((host) => host.url === origin)?.name ||
          window.location.host,
      );
    });
    return () => {
      live = false;
    };
  }, [origin]);

  if (!isNativeShell()) return null;

  return (
    <>
      {name !== null && (
        <div className="flex items-center gap-2 px-3 py-2 text-2xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
          <IconServer size={14} />
          <span>Server</span>
          <Tag
            className="ml-auto max-w-[62%] truncate"
            title={`Signed in to ${name}`}
          >
            {name}
          </Tag>
        </div>
      )}
      <a role="menuitem" className={menuItemClass} href={hostPickerUrl()}>
        <IconExternal size={16} />
        <span>Switch server</span>
      </a>
      <MenuSeparator />
    </>
  );
}
