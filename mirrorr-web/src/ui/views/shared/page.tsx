import type { ReactNode } from "react";
import { cn } from "@/ui/lib/cn";

export interface PageProps {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}

interface HeadProps {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly actions?: ReactNode;
  readonly level: "h1" | "h2";
}

function Head({ title, description, actions, level }: HeadProps) {
  if (title === undefined) return null;
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {level === "h1" ? (
          <h1 className="text-2xl font-bold leading-tight tracking-[-0.02em] max-sm:text-xl">
            {title}
          </h1>
        ) : (
          <h2 className="text-xl font-semibold leading-tight tracking-[-0.01em]">
            {title}
          </h2>
        )}
        {description !== undefined ? (
          <p className="mt-1 max-w-[68ch] text-md leading-normal text-ink-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions !== undefined ? (
        <div className="flex flex-wrap items-center gap-2 max-[479px]:[&_[data-slot=button]]:px-3 max-[479px]:[&_[data-slot=button-label]]:hidden">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Page scaffolding — the page column every view renders into, with the
 * optional title/description/actions head. Views own their own body.
 */
export function Page({
  title,
  description,
  actions,
  children,
  className,
}: PageProps) {
  return (
    <main
      className={cn(
        "mx-auto flex w-full max-w-[var(--content-max)] flex-1 flex-col gap-5 px-5 pt-6 pb-12 max-sm:px-3 max-sm:pt-4 max-sm:pb-8",
        className,
      )}
    >
      <Head
        title={title}
        description={description}
        actions={actions}
        level="h1"
      />
      {children}
    </main>
  );
}

/**
 * Section scaffolding — a titled block stacked inside a `Page`, used when a
 * single view holds more than one list (e.g. profiles + sources). Adjacent
 * sections are separated by the `[&+&]:mt-8` sibling margin.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: PageProps) {
  return (
    <section className={cn("flex flex-col gap-4 [&+&]:mt-8", className)}>
      <Head
        title={title}
        description={description}
        actions={actions}
        level="h2"
      />
      {children}
    </section>
  );
}
