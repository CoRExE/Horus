import { beforeEach, expect, test, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { usePlayerFullscreen } from "../src/components/usePlayerFullscreen";

const native = vi.hoisted(() => ({
  enabled: true,
  isFullscreen: vi.fn(),
  setFullscreen: vi.fn(),
  onResized: vi.fn(),
  unlisten: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => native.enabled }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
const onError = vi.fn();
function Harness({ episode = "Premier" }: { episode?: string }) {
  const { container, fullscreen, toggle, exit } = usePlayerFullscreen(onError);
  return (
    <div ref={container} data-testid="player" data-fullscreen={fullscreen}>
      <span>{episode}</span>
      <button onClick={() => void toggle()}>Basculer</button>
      <button onClick={() => void exit()}>Quitter</button>
    </div>
  );
}
beforeEach(() => {
  native.enabled = true;
  native.isFullscreen.mockReset().mockResolvedValue(false);
  native.setFullscreen.mockReset().mockResolvedValue(undefined);
  native.onResized.mockReset().mockResolvedValue(native.unlisten);
  document.body.style.overflow = "auto";
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    value: null,
  });
});

test("Échap et la fermeture restaurent le mode fenêtre et le défilement", async () => {
  const result = render(<Harness />);
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() =>
    expect(screen.getByTestId("player").dataset.fullscreen).toBe("true"),
  );
  expect(native.setFullscreen).toHaveBeenCalledWith(true);
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(document, { key: "Escape" });
  await waitFor(() =>
    expect(screen.getByTestId("player").dataset.fullscreen).toBe("false"),
  );
  expect(native.setFullscreen).toHaveBeenLastCalledWith(false);
  expect(document.body.style.overflow).toBe("auto");
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() =>
    expect(screen.getByTestId("player").dataset.fullscreen).toBe("true"),
  );
  result.unmount();
  await waitFor(() =>
    expect(native.setFullscreen).toHaveBeenLastCalledWith(false),
  );
  expect(native.unlisten).toHaveBeenCalled();
});

test("un changement de source sans démontage conserve le plein écran initial de la fenêtre", async () => {
  native.isFullscreen.mockResolvedValue(true);
  const result = render(<Harness />);
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() =>
    expect(screen.getByTestId("player").dataset.fullscreen).toBe("true"),
  );
  result.rerender(<Harness episode="Suivant" />);
  expect(screen.getByTestId("player").dataset.fullscreen).toBe("true");
  result.unmount();
  await act(async () => {});
  expect(native.setFullscreen).not.toHaveBeenCalled();
});

test("fermer pendant l'entrée native en plein écran restaure la fenêtre après la réponse tardive", async () => {
  let finish!: () => void;
  native.setFullscreen.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const result = render(<Harness />);
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() => expect(native.setFullscreen).toHaveBeenCalledWith(true));
  result.unmount();
  await act(async () => finish());
  await waitFor(() =>
    expect(native.setFullscreen.mock.calls).toEqual([[true], [false]]),
  );
});

test("une demande de sortie pendant la transition n'est pas perdue", async () => {
  let finish!: () => void;
  native.setFullscreen.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<Harness />);
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() => expect(native.setFullscreen).toHaveBeenCalledWith(true));
  fireEvent.click(screen.getByText("Quitter"));
  await act(async () => finish());
  await waitFor(() =>
    expect(native.setFullscreen.mock.calls).toEqual([[true], [false]]),
  );
});

test("le refus du système reste récupérable et une sortie native met l'interface à jour", async () => {
  native.setFullscreen.mockRejectedValueOnce(new Error("Refus"));
  render(<Harness />);
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() => expect(onError).toHaveBeenCalled());
  expect(screen.getByTestId("player").dataset.fullscreen).toBe("false");
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() =>
    expect(screen.getByTestId("player").dataset.fullscreen).toBe("true"),
  );
  await act(async () => native.onResized.mock.calls[0][0]());
  expect(screen.getByTestId("player").dataset.fullscreen).toBe("false");
});

test("le navigateur libère uniquement le plein écran appartenant au lecteur", async () => {
  native.enabled = false;
  const result = render(<Harness />);
  const element = screen.getByTestId("player");
  element.requestFullscreen = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: element,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  document.exitFullscreen = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      value: null,
    });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  fireEvent.click(screen.getByText("Basculer"));
  await waitFor(() => expect(element.dataset.fullscreen).toBe("true"));
  result.unmount();
  await waitFor(() => expect(document.exitFullscreen).toHaveBeenCalledTimes(1));
  expect(native.setFullscreen).not.toHaveBeenCalled();
});
