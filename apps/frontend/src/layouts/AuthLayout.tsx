import { Outlet } from "react-router-dom";
import { Toaster } from "@packages/ui";

/**
 * AuthLayout
 *
 * Simple centered layout for authentication pages
 * No navigation, just the auth form centered on the page
 */
export default function AuthLayout() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  );
}
