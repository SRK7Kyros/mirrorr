import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Recording } from "@/api/schemas";
import { RecordingCard } from "./recording-card";

const api = vi.hoisted(() => ({
  probeMediaUrl: vi.fn(() => Promise.resolve(true)),
}));

vi.mock("@/api", () => api);

vi.mock("hls.js", () => ({
  default: Object.assign(
    class {
      static isSupported(): boolean {
        return true;
      }
      loadSource = vi.fn();
      attachMedia = vi.fn();
      destroy = vi.fn();
      on = vi.fn();
    },
    { Events: { MANIFEST_PARSED: "MANIFEST_PARSED" } },
  ),
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
});

function renderCard(value: Recording) {
  const onDelete = vi.fn();
  return {
    onDelete,
    ...render(
      <RecordingCard
        recording={value}
        onDelete={onDelete}
        highlightRef={() => {}}
      />,
    ),
  };
}

describe("RecordingCard", () => {
  it("tapping preview pins playback without opening it", () => {
    const { container } = renderCard(recording());
    const preview = screen.getByRole("button", { name: /preview recording #3/i });
    expect(
      container.querySelector(".session-preview")?.getAttribute("data-active"),
    ).toBe("false");

    fireEvent.click(preview);

    expect(
      container.querySelector(".session-preview")?.getAttribute("data-active"),
    ).toBe("true");
    expect(open).not.toHaveBeenCalled();
  });

  it("tapping the preview video does not open the file", () => {
    const { container } = renderCard(recording());
    const video = container.querySelector("video");
    expect(video).not.toBeNull();

    fireEvent.click(video as Element);

    expect(open).not.toHaveBeenCalled();
  });

  it("clicking elsewhere on the card opens the file in a new tab", () => {
    const { container } = renderCard(recording());
    const source = container.querySelector(".session-card-source");
    expect(source).not.toBeNull();

    fireEvent.click(source as Element);

    expect(open).toHaveBeenCalledWith(
      "https://example.test/content/speedcubing_3/recording.mp4",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("delete asks the parent without opening the file", () => {
    const { onDelete } = renderCard(recording());

    fireEvent.click(
      screen.getByRole("button", { name: /delete recording #3/i }),
    );

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("offers no preview and no open when the media is not served", () => {
    const { container } = renderCard(recording({ media_served: false }));
    expect(
      screen.queryByRole("button", { name: /preview recording/i }),
    ).toBeNull();
    expect(
      screen.getByText(/media not served on this install/i),
    ).not.toBeNull();

    fireEvent.click(container.querySelector(".session-card-source") as Element);
    expect(open).not.toHaveBeenCalled();
  });
});
