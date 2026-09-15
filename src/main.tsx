import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";
import { bootWebBridge } from "./webapi/boot";
// Side-effect import: sets html.lowfx BEFORE first render (weak-hardware
// detection / user's animation preference). Must not wait for the lazy
// Settings chunk, or early frames would animate on low-end machines.
import "@/lib/fx";

// Dev-only preview bridge so the UI can run in a plain browser without the
// real database. Enable with: http://localhost:5174/?preview=1 — the REAL
// Android bridge boots first, so the preview mock stays an explicit opt-in.
if (import.meta.env.DEV && ["localhost", "127.0.0.1"].includes(window.location.hostname) && new URLSearchParams(window.location.search).has("preview")) {
  import("@/lib/preview-mock").then(({ installPreviewMock }) => installPreviewMock());
}

function BootError({ message }: { message: string }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, fontFamily: "system-ui, sans-serif", padding: 24, textAlign: "center" }}>
      <b style={{ fontSize: 18 }}>MMS could not start</b>
      <span style={{ opacity: 0.75, maxWidth: 420, fontSize: 14 }}>{message}</span>
      <button onClick={() => window.location.reload()} style={{ padding: "10px 22px", borderRadius: 999, border: "none", background: "#0d9488", color: "#fff", fontSize: 15, marginTop: 8 }}>Try again</button>
    </div>
  );
}

const rootEl = document.getElementById("root")!;

bootWebBridge()
  .then(() => {
    ReactDOM.createRoot(rootEl).render(
      <React.StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </React.StrictMode>
    );
  })
  .catch((err) => {
    console.error("[mms.boot] failed:", err);
    ReactDOM.createRoot(rootEl).render(<BootError message={String((err as Error)?.message ?? err)} />);
  });
