import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { loadSession } from "./lib/session";
import { initializeTheme } from "./lib/theme";
import "./index.css";
// Palettes that override index.css and the page sheets, so they load last (see src/themes/).
import "./themes/midnight-dark.generated.css";
import "./themes/midnight.css";
import "./themes/login-midnight.css";

// Sign-in and sign-up always open light. A signed-in tab keeps its choice on refresh.
initializeTheme(Boolean(loadSession()));

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
