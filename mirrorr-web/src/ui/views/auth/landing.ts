/**
 * Where a just-authenticated user lands.
 *
 * An admin's home is the admin console, which is a *second build* served under
 * `/admin/` — so that hop is a document navigation rather than a router hop.
 * Inside that build the console is this app, so the same intent is an ordinary
 * route. Everyone else lands on the session list.
 */

export type Landing =
  | { readonly kind: "route"; readonly to: "/sessions" | "/settings" }
  | { readonly kind: "document"; readonly path: string }

export function postAuthLanding(role: string | null | undefined): Landing {
  if (role !== "admin") return { kind: "route", to: "/sessions" }
  return __ADMIN__ ? { kind: "route", to: "/settings" } : { kind: "document", path: "/admin/settings" }
}

/** Send the user to that home; `goTo` performs the in-app hop when there is one. */
export async function landAfterAuth(
  role: string | null | undefined,
  goTo: (to: "/sessions" | "/settings") => Promise<void> | void,
): Promise<void> {
  const landing = postAuthLanding(role)
  if (landing.kind === "document") {
    window.location.assign(landing.path)
    return
  }
  await goTo(landing.to)
}
