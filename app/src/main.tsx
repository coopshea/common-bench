import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ds/tokens.css";
import "./styles.css";
import "./ds/ds.css";
import "./app.css";
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
