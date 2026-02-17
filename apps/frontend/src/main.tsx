import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { CoreProvider } from "@/providers/core-provider";
import router from "@/router";
// Global styles - must be imported in the entry point for Vite
import "@packages/ui/styles/globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CoreProvider>
      <RouterProvider router={router} />
    </CoreProvider>
  </React.StrictMode>
);
