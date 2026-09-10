import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// Utiliser le stockage du document jsdom, même si Node expose son propre global.
const { jsdom } = globalThis as typeof globalThis & {
  jsdom: { window: Window };
};
vi.stubGlobal("localStorage", jsdom.window.localStorage);

// jsdom expose <dialog>, mais pas encore ses méthodes d'ouverture/fermeture.
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};

// jsdom ne décode pas de vidéo. Les médias réels sont validés par test:media.
vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});

afterEach(cleanup);
