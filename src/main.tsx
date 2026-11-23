import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

const render = () =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

// Browser preview mode: `npm run dev` opened in a normal browser uses sample
// data instead of the Rust backend. Never included in release builds.
if (import.meta.env.DEV && !("__TAURI_INTERNALS__" in window)) {
  import("./dev/mockTauri").then(render);
} else {
  render();
}
