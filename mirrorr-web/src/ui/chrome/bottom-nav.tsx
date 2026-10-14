import { Link, useMatchRoute } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  IconMenu,
  menuAnchorClass,
  menuItemClass,
  MenuPopover,
  useMenuDismiss,
} from "@/ui/components";
import { cn } from "@/ui/lib/cn";
import { springs } from "@/ui/lib/motion";
import { HostSwitcher } from "./host-switcher";
import { MOBILE_OVERFLOW, MOBILE_TABS } from "./nav-items";

const ITEM_CLASS =
  "relative isolate flex h-[calc(var(--bottomnav-h)_-_var(--s-2))] flex-col items-center justify-center gap-[2px] rounded-full text-2xs transition-[color,background] duration-[var(--dur-fast)] ease-[var(--ease-out)]";

export function BottomNav() {
  const matchRoute = useMatchRoute();
  const { open, setOpen, wrapRef } = useMenuDismiss();

  return (
    <nav
      className="fixed bottom-[calc(var(--s-3)_+_env(safe-area-inset-bottom,0px))] left-1/2 z-[var(--z-sidebar)] hidden w-[min(calc(100%_-_var(--s-6)),30rem)] -translate-x-1/2 max-sm:block"
      aria-label="Primary"
    >
      <div className="flex h-[var(--bottomnav-h)] items-center gap-1 rounded-full border border-line-strong bg-[color-mix(in_srgb,var(--surface-2)_86%,transparent)] px-1 shadow-elev-lg backdrop-blur-[16px]">
        {MOBILE_TABS.map((item) => {
          const active =
            matchRoute({ to: item.to, fuzzy: item.exact !== true }) !== false;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                ITEM_CLASS,
                "flex-[1_1_0]",
                active ? "text-brand" : "text-ink-dim hover:text-ink",
              )}
            >
              {active ? (
                <motion.span
                  layoutId="bottomnav-pill"
                  className="absolute inset-0 -z-10 rounded-full bg-[var(--accent-dim)]"
                  transition={springs.snappy}
                />
              ) : null}
              {item.icon}
              <span>{item.label}</span>
            </Link>
          );
        })}
        <div className={menuAnchorClass} ref={wrapRef}>
          <button
            type="button"
            className={cn(
              ITEM_CLASS,
              "w-[calc(var(--bottomnav-h)_-_var(--s-2))] flex-none text-ink-muted hover:text-ink",
            )}
            aria-label="More navigation"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <IconMenu size={20} />
          </button>
          <MenuPopover
            open={open}
            placement="up"
            className="w-[min(21rem,calc(100vw-var(--s-6)))]"
            onClick={() => setOpen(false)}
          >
            <HostSwitcher />
            {MOBILE_OVERFLOW.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                role="menuitem"
                className={menuItemClass}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </MenuPopover>
        </div>
      </div>
    </nav>
  );
}
