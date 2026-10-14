import { useEffect, useState } from "react";
import {
  hostPickerUrl,
  isNativeShell,
  readShellHosts,
  setShellAutoConnect,
} from "@/api/native";
import {
  IconExternal,
  IconServer,
  menuItemClass,
  MenuSeparator,
  Switch,
  Tag,
} from "@/ui/components";

/**
 * Which host this console is running from, and the switch that lets the shell
 * open it on launch instead of the picker. Both answers come from the app-wide
 * store the picker writes, which only exists inside the app — in a browser this
 * renders nothing at all, like every other native-only affordance.
 */
export function HostSwitcher() {
  const origin = window.location.origin;
  const [name, setName] = useState<string | null>(null);
  const [auto, setAuto] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void readShellHosts().then((state) => {
      if (!live || state === null) return;
      // A host the picker has no name for is still worth naming — by its address.
      setName(
        state.hosts.find((host) => host.url === origin)?.name ||
          window.location.host,
      );
      setAuto(state.autoUrl === origin);
    });
    return () => {
      live = false;
    };
  }, [origin]);

  if (!isNativeShell() || name === null) return null;

  const toggle = async (next: boolean): Promise<void> => {
    setBusy(true);
    setAuto(next);
    if (!(await setShellAutoConnect(next ? origin : null))) setAuto(!next);
    setBusy(false);
  };

  return (
    <>
      <div className="flex flex-col gap-1 p-2">
        <div className="flex items-center gap-2 px-1 py-1 text-2xs font-semibold tracking-[0.04em] uppercase text-ink-faint">
          <IconServer size={14} />
          <span>Server</span>
          <Tag
            className="ml-auto max-w-[62%] truncate"
            title={`Signed in to ${name}`}
          >
            {name}
          </Tag>
        </div>
        <a role="menuitem" className={menuItemClass} href={hostPickerUrl()}>
          <IconExternal size={16} />
          <span>Switch server</span>
        </a>
        {/* A control, not a destination: flipping it must not dismiss the menu. */}
        <div
          className="flex flex-col gap-0.5 px-3 pt-1 pb-2"
          onClick={(event) => event.stopPropagation()}
        >
          <Switch
            // Inside `role="menu"` a control is a menu item, so the checkbox is one.
            role="menuitemcheckbox"
            aria-checked={auto}
            label="Auto-connect on start"
            checked={auto}
            disabled={busy}
            onChange={(event) => void toggle(event.target.checked)}
          />
          <p className="text-xs text-ink-dim">
            Skips the server list next launch.
          </p>
        </div>
      </div>
      <MenuSeparator />
    </>
  );
}
