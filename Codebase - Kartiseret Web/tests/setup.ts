import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

Object.defineProperty(globalThis, "__SUPABASE_URL__", {
  configurable: true,
  value: "http://127.0.0.1:54321",
});

Object.defineProperty(globalThis, "__SUPABASE_PUBLISHABLE_KEY__", {
  configurable: true,
  value: "local-test-only",
});

Object.defineProperty(window, "matchMedia", {
  configurable: true,
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, "requestAnimationFrame", {
  configurable: true,
  writable: true,
  value: (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(performance.now()), 0),
});

Object.defineProperty(window, "cancelAnimationFrame", {
  configurable: true,
  writable: true,
  value: (handle: number) => window.clearTimeout(handle),
});

Object.defineProperty(window, "scrollTo", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "scrollTo", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
  configurable: true,
  writable: true,
  value: vi.fn(() => false),
});

Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

class TestResizeObserver implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

Object.defineProperty(window, "ResizeObserver", {
  configurable: true,
  writable: true,
  value: TestResizeObserver,
});

afterEach(() => {
  cleanup();
  if (typeof window.localStorage?.clear === "function") {
    window.localStorage.clear();
  }
  document.body.innerHTML = "";
});
