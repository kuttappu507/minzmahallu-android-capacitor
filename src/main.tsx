import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";
// Side-effect import: sets html.lowfx BEFORE first render (weak-hardware
// detection / user's animation preference). Must not wait for the lazy
// Settings chunk, or early frames would animate on low-end machines.
import "@/lib/fx";

// Dev-only preview bridge so the renderer can run in a plain browser
// (Electron IPC unavailable). Enable with: http://localhost:5174/?preview=1
// Gated on import.meta.env.DEV so the mock (which auto-logs-in as an
// Administrator and contains a historical demo password string) is
// tree-shaken OUT of packaged production builds entirely.
if (import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname) && new URLSearchParams(window.location.search).has("preview")) {
  import("@/lib/preview-mock").then(({ installPreviewMock }) => installPreviewMock());
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
