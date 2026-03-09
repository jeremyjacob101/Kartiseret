import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./components/app/AppShell";
import { RatingSourcesProvider } from "./prefs/RatingSourcesContext";
import "./components/topbar/topbar.css";
import "./index.css";

export default function App() {
  return (
    <RatingSourcesProvider>
      <AppShell />
    </RatingSourcesProvider>
  );
}

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
