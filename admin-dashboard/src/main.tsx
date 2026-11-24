import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import App from "./App";
import { AuthProvider } from "./auth";
import { FeedbackProvider } from "./components/ui";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Hash routes (/#/leads) work on any static host without rewrite rules. */}
    <HashRouter>
      <AuthProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </AuthProvider>
    </HashRouter>
  </StrictMode>,
);
