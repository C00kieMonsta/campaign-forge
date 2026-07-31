import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "@/components/Toaster";
import { AuthProvider } from "@/contexts/AuthContext";
import { LanguageProvider } from "@/contexts/LanguageContext";
import { LexStoreProvider } from "@/store/LexStoreProvider";
import { ActiveAppProvider } from "@/superapp/ActiveAppContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ActiveAppProvider>
        <LanguageProvider>
          <AuthProvider>
            <Toaster />
            <LexStoreProvider>
              <App />
            </LexStoreProvider>
          </AuthProvider>
        </LanguageProvider>
      </ActiveAppProvider>
    </BrowserRouter>
  </StrictMode>
);
