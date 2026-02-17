// frontend/src/components/navigation/sidebar/SecondaryMenu.tsx
import React, { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from "@packages/ui";
import { LifeBuoy, LogOut } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const SecondaryMenu: React.FC = () => {
  const [emailContent, setEmailContent] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const { user, signOut } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const mailtoLink = `mailto:info@remorai.solutions?subject=Support%20Request&body=${encodeURIComponent(
      emailContent
    )}`;
    window.location.href = mailtoLink;
    setIsDialogOpen(false);

    setEmailContent("");
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  return (
    <SidebarGroup className="mt-auto">
      <SidebarGroupContent>
        <SidebarMenu>
          {user && (
            <SidebarMenuItem>
              <SidebarMenuButton asChild size="sm" onClick={handleLogout}>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start text-destructive hover:text-destructive-foreground"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </Button>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
          <SidebarMenuItem>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <SidebarMenuButton asChild size="sm">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                  >
                    <LifeBuoy />
                    <span>Support</span>
                  </Button>
                </SidebarMenuButton>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[550px]">
                <DialogHeader>
                  <DialogTitle>Support</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <form onSubmit={handleSubmit}>
                    <label
                      htmlFor="supportEmail"
                      className="block text-sm font-medium text-gray-700"
                    >
                      How can we assist you today?
                    </label>
                    <textarea
                      id="supportEmail"
                      name="supportEmail"
                      rows={4}
                      className="mt-1 block w-full rounded-md shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2"
                      value={emailContent}
                      onChange={(e) => setEmailContent(e.target.value)}
                      required
                    />
                    <Button type="submit" className="mt-2">
                      Send
                    </Button>
                  </form>
                </div>
              </DialogContent>
            </Dialog>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
};

export default SecondaryMenu;
