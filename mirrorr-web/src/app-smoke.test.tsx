import { QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { queryKeys } from "@/lib/query-keys"
import { queryClient } from "@/query-client"
import { routeTree } from "@/router"
import { AUTH_BODY } from "@/test/api-helpers"

describe("mirrorr-web app smoke", () => {
  beforeEach(() => {
    queryClient.clear()
  })

  afterEach(() => {
    queryClient.clear()
  })

  it("renders the authenticated landing through the real router tree and providers", async () => {
    expect.assertions(3)

    queryClient.setQueryData(queryKeys.authMe(), AUTH_BODY)

    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByTestId("sessions-placeholder")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeTruthy()
    expect(screen.getByRole("main")).toBeTruthy()
  })
})
