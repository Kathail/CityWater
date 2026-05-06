import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { registerServiceWorker } from "./lib/offline/registerSW";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

registerServiceWorker((apply) => {
  // Minimal update prompt — confirm() is acceptable for v1; a styled
  // toast lands in S11 polish.
  if (window.confirm("A new version of FlowOps is available. Reload now?")) {
    apply();
  }
});
