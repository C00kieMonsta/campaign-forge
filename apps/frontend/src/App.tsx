import { Navigate, Route, Routes, useParams } from "react-router-dom";
import AdminLayout from "@/components/admin/AdminLayout";
import CampaignEditor from "@/pages/admin/campaigns/CampaignEditor";
import Campaigns from "@/pages/admin/campaigns/Campaigns";
import Contacts from "@/pages/admin/campaigns/Contacts";
import Dashboard from "@/pages/admin/campaigns/Dashboard";
import Groups from "@/pages/admin/campaigns/Groups";
import LexArtifacts from "@/pages/admin/lex/LexArtifacts";
import LexArtifactView from "@/pages/admin/lex/LexArtifactView";
import LexAuthorities from "@/pages/admin/lex/LexAuthorities";
import LexWorkspace from "@/pages/admin/lex/LexWorkspace";
import LexWorkspaceChat from "@/pages/admin/lex/LexWorkspaceChat";
import LexWorkspaces from "@/pages/admin/lex/LexWorkspaces";
import LexWorkspaceStory from "@/pages/admin/lex/LexWorkspaceStory";
import Settings from "@/pages/admin/Settings";
import LoginPage from "@/pages/LoginPage";
import { useActiveApp } from "@/superapp/ActiveAppContext";

/** Sends a bare or unknown URL to the home of whichever app this browser was last in. */
function HomeRedirect() {
  const { app } = useActiveApp();
  return <Navigate to={app.basePath} replace />;
}

/** /campaigns/:id/edit was the pre-super-app path for editing a campaign. */
function LegacyMailingEditRedirect() {
  const { id } = useParams();
  return <Navigate to={`/campaigns/mailings/${id}/edit`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<AdminLayout />}>
        {/* Campaigns app */}
        <Route path="/campaigns" element={<Dashboard />} />
        <Route path="/campaigns/contacts" element={<Contacts />} />
        <Route path="/campaigns/groups" element={<Groups />} />
        <Route path="/campaigns/mailings" element={<Campaigns />} />
        <Route path="/campaigns/mailings/new" element={<CampaignEditor />} />
        <Route
          path="/campaigns/mailings/:id/edit"
          element={<CampaignEditor />}
        />

        {/* Lex app */}
        <Route path="/lex" element={<LexWorkspaces />} />
        <Route path="/lex/authorities" element={<LexAuthorities />} />
        <Route path="/lex/workspaces/:id" element={<LexWorkspaceChat />} />
        <Route
          path="/lex/workspaces/:id/story"
          element={<LexWorkspaceStory />}
        />
        <Route
          path="/lex/workspaces/:id/documents"
          element={<LexWorkspace />}
        />
        <Route
          path="/lex/workspaces/:id/artifacts"
          element={<LexArtifacts />}
        />
        <Route path="/lex/artifacts/:id" element={<LexArtifactView />} />

        {/* Shell-level, shared by both apps */}
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Paths from before the apps were namespaced. */}
      <Route path="/dashboard" element={<Navigate to="/campaigns" replace />} />
      <Route
        path="/contacts"
        element={<Navigate to="/campaigns/contacts" replace />}
      />
      <Route
        path="/groups"
        element={<Navigate to="/campaigns/groups" replace />}
      />
      <Route
        path="/campaigns/new"
        element={<Navigate to="/campaigns/mailings/new" replace />}
      />
      <Route
        path="/campaigns/:id/edit"
        element={<LegacyMailingEditRedirect />}
      />

      <Route path="*" element={<HomeRedirect />} />
    </Routes>
  );
}
