import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/**
 * Organization Settings Index
 *
 * Redirects to members page
 */
export default function OrganizationPage() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate("/settings/organization/members", { replace: true });
  }, [navigate]);

  return null;
}
