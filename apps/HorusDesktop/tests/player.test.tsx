import { expect, test, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { Player } from "../src/components/Player";

const hls = vi.hoisted(() => ({
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
}));
vi.mock("hls.js", () => ({
  default: class {
    static isSupported = () => true;
    static Events = { ERROR: "error" };
    loadSource = hls.loadSource;
    attachMedia = hls.attachMedia;
    on = hls.on;
    off = hls.off;
    destroy = hls.destroy;
  },
}));

test("le démontage HLS détruit la session et sauvegarde sa dernière position", async () => {
  const onProgress = vi.fn();
  const { unmount, container } = render(
    <Player
      playback={{
        prepared: {
          id: "hls-1",
          url: "/fixture.m3u8",
          contentType: "application/vnd.apple.mpegurl",
        },
        title: "Test HLS",
        language: "VF",
        format: "hls",
        resumeAt: 0,
      }}
      onStop={vi.fn()}
      onProgress={onProgress}
    />,
  );
  const video = container.querySelector("video")!;
  await waitFor(() => expect(hls.attachMedia).toHaveBeenCalledWith(video));
  expect(hls.loadSource).toHaveBeenCalledWith("/fixture.m3u8");
  video.currentTime = 45;
  Object.defineProperty(video, "duration", { configurable: true, value: 600 });
  unmount();
  expect(onProgress).toHaveBeenLastCalledWith(45, 600, true);
  expect(hls.destroy).toHaveBeenCalledTimes(1);
  expect(video.pause).toHaveBeenCalled();
  expect(video.load).toHaveBeenCalled();
  expect(video.getAttribute("src")).toBeNull();
});
