import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { Toaster } from "@/components/ui/toaster";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LanguageProvider>
      <Toaster />
      <App />
    </LanguageProvider>
  </StrictMode>,
);
