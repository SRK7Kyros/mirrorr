import { QueryClientProvider } from "@tanstack/react-query"
import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { queryClient } from "@/query-client"
import { routeTree } from "@/router"

describe("mirrorr-web app smoke", () => {
  it("renders the index route through the real router tree and providers", async () => {
    expect.assertions(3)

    const router = createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    )

    expect(await screen.findByRole("heading", { name: "Mirrorr" })).toBeTruthy()
    expect(screen.getByText("Client scaffold online.")).toBeTruthy()
    expect(screen.getByRole("main")).toBeTruthy()
  })
})
