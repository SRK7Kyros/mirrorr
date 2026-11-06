import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Recording } from "@/api/schemas";
import { toast } from "@/ui/components";
import { RecordingCard } from "./recording-card";

const api = vi.hoisted(() => ({
  probeMediaUrl: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/api", () => api);

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    readonly to?: string;
    readonly params?: Record<string, string>;
    readonly children?: ReactNode;
  }) => {
    const href = (to ?? "#").replace(
      /\$(\w+)/g,
      (_match, key: string) => params?.[key] ?? "",
    );
    return <a href={href} {...rest}>{children}</a>;
  },
}));

function recording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: 3,
    user_friendly_name: "Speedcubing finals",
    snake_case_name: "speedcubing_finals",
    content_url: "https://example.test/content/speedcubing_3/recording.mp4",
    profile_name: "speedcubing",
    engine_name: "yt_dlp_piped",
    resolver_name: "daddylive",
    started_at: "2026-10-09 17:00:00",
    ended_at: "2026-10-09 18:00:00",
    duration_seconds: 3600,
    size_bytes: 123456789,
    created_at: "2026-10-09 18:00:00",
    media_served: true,
    ...overrides,
  };
}

let open: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();
  HTMLMediaElement.prototype.load = vi.fn();
  open = vi.spyOn(window, "open").mockImplementation(() => null);
});

afterEach(() => {
  open.mockRestore();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

function renderCard(value: Recording, selectMode = false) {
  const onDelete = vi.fn();
  const onToggle = vi.fn();
  return {
    onDelete,
    onToggle,
    ...render(
      <RecordingCard
        recording={value}
        onDelete={onDelete}
        highlightRef={() => {}}
        selectMode={selectMode}
        onToggle={onToggle}
      />,
    ),
  };
}

describe("RecordingCard", () => {
  it("fills the media slot with the file's own first frame when served", () => {
    const { container } = renderCard(recording());

    const media = container.querySelector('[data-slot="media-fill"]');
    expect(media?.getAttribute("data-fill")).toBe("cover");

    const video = container.querySelector("video");
    expect(video).not.toBeNull();
    expect(video?.getAttribute("src")).toBe(
      "https://example.test/content/speedcubing_3/recording.mp4#t=0.1",
    );
    expect(video?.hasAttribute("data-card-ignore")).toBe(true);
    expect(container.querySelector('[data-fill="plate"]')).toBeNull();
  });

  it("renders a plate with the record's own fields when the file is not served", () => {
    const { container } = renderCard(recording({ media_served: false }));

    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    const plate = container.querySelector('[data-fill="plate"]') as HTMLElement;
    expect(plate).not.toBeNull();
    expect(within(plate).getByText(/file kept — not served/i)).not.toBeNull();
    expect(within(plate).getByText("1:00:00")).not.toBeNull();
    expect(within(plate).getByText("117.7 MB")).not.toBeNull();
    expect(within(plate).getByText(/not serving this file/i)).not.toBeNull();
  });

  it("probes for the serve state when the server does not answer it", async () => {
    api.probeMediaUrl.mockResolvedValueOnce(false);
    const { container } = renderCard(recording({ media_served: undefined }));

    await waitFor(() =>
      expect(
        container.querySelector('[data-slot="media-fill"]')?.getAttribute("data-fill"),
      ).toBe("plate"),
    );
    expect(api.probeMediaUrl).toHaveBeenCalledWith(
      "https://example.test/content/speedcubing_3/recording.mp4",
    );
  });

  it("offers a real download control that points at the file", () => {
    renderCard(recording());

    const download = screen.getByRole("link", { name: /download recording #3/i });
    expect(download.getAttribute("href")).toBe(
      "https://example.test/content/speedcubing_3/recording.mp4",
    );
    expect(download.hasAttribute("download")).toBe(true);
  });

  it("offers no dead download when the file is not served", () => {
    renderCard(recording({ media_served: false }));

    expect(screen.queryByRole("link", { name: /download recording #3/i })).toBeNull();
    expect(screen.getByRole("button", { name: /copy link for recording #3/i })).not.toBeNull();
  });

  it("copies the link and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const success = vi.spyOn(toast, "success").mockImplementation(() => 0);
    renderCard(recording());

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "https://example.test/content/speedcubing_3/recording.mp4",
      ),
    );
    expect(success).toHaveBeenCalled();
  });

  it("surfaces a message when the clipboard refuses the copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    const failure = vi.spyOn(toast, "error").mockImplementation(() => 0);
    renderCard(recording());

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(failure).toHaveBeenCalled());
    expect(failure.mock.calls[0]?.[0]).toMatch(/could not copy/i);
  });

  it("delete lives in the actions menu and asks the parent", () => {
    const { onDelete } = renderCard(recording());

    fireEvent.click(screen.getByRole("button", { name: "Actions for recording #3" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete recording #3/i }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0]?.[0]).toMatchObject({ id: 3 });
    expect(open).not.toHaveBeenCalled();
  });

  it("clicking the card body opens the file in a new tab", () => {
    renderCard(recording());

    fireEvent.click(screen.getByText("daddylive", { exact: false }));

    expect(open).toHaveBeenCalledWith(
      "https://example.test/content/speedcubing_3/recording.mp4",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not open a file the install does not serve", () => {
    const { container } = renderCard(recording({ media_served: false }));

    fireEvent.click(container.querySelector('[data-slot="identity"]') as Element);

    expect(open).not.toHaveBeenCalled();
  });

  it("shows the select checkbox only in select mode", () => {
    const first = renderCard(recording());
    expect(screen.queryByRole("checkbox")).toBeNull();
    first.unmount();

    const selectable = renderCard(recording(), true);
    const box = screen.getByRole("checkbox", { name: "Select Speedcubing finals" });
    fireEvent.click(box);

    expect(selectable.onToggle).toHaveBeenCalledWith(3);
  });

  it("keeps a link to the session that produced the file", () => {
    renderCard(recording({ session_id: 42 }));

    expect(screen.getByRole("link", { name: "Session #42" })).not.toBeNull();
  });
});
