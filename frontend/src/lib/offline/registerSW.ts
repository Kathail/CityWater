/**
 * Service worker registration with an update prompt.
 *
 * `vite-plugin-pwa` injects the `virtual:pwa-register` module at build time;
 * in dev (devOptions.enabled = false) the import resolves to a no-op shim
 * via the conditional guard.
 */
import { drainQueue } from "./queue";

export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  // Avoid running in the test environment (jsdom, no `navigator.serviceWorker`)
  // or when the build hasn't injected the virtual module.
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  // Build the import path at runtime so Vitest/Vite's static analyzer
  // doesn't try to resolve the virtual module — only the production-built
  // bundle, where vite-plugin-pwa has injected it, will satisfy this.
  const moduleName = "virtual" + ":" + "pwa-register";
  import(/* @vite-ignore */ moduleName)
    .then((mod) => {
      const updateSW = (mod as { registerSW: (opts: unknown) => (reload?: boolean) => void })
        .registerSW({
          onNeedRefresh() {
            onUpdate(() => updateSW(true));
          },
          onOfflineReady() {
            /* cached shell ready — banner reflects state */
          },
        });
    })
    .catch(() => {
      /* no SW in this environment — fine */
    });

  // Drain the queue when the network comes back.
  window.addEventListener("online", () => {
    void drainQueue();
  });
}
