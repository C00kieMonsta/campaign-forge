import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input
} from "@packages/ui";
import { Lock } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { useProtectedRoute } from "@/hooks/use-protected-route";

/**
 * SettingsPage - Account Settings
 *
 * User account settings including:
 * - Profile information (email, name)
 * - Security (password change)
 */
export default function SettingsPage() {
  const { user, loading } = useProtectedRoute();
  const { updatePassword } = useAuth();

  // Password form state
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Password validation
  const isPasswordLengthValid = newPassword.length >= 8;
  const isPasswordMatch =
    newPassword === confirmPassword && confirmPassword.length > 0;
  const hasPasswordTouched = newPassword.length > 0;
  const hasConfirmTouched = confirmPassword.length > 0;

  const handlePasswordUpdate = async () => {
    if (!user?.email) return;

    if (newPassword.length < 8) {
      alert("New password must be at least 8 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      alert("New passwords do not match.");
      return;
    }

    setIsUpdatingPassword(true);
    try {
      console.log(
        JSON.stringify({
          level: "info",
          action: "passwordUpdateStarted",
          email: user.email
        })
      );

      await updatePassword(newPassword);

      console.log(
        JSON.stringify({
          level: "info",
          action: "passwordUpdateSuccess",
          email: user.email
        })
      );

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPasswordForm(false);

      alert("Password updated successfully!");
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          action: "passwordUpdateFailed",
          error: err instanceof Error ? err.message : "Unknown error"
        })
      );
      alert(
        err instanceof Error
          ? err.message
          : "Failed to update password. Please try again."
      );
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const cancelPasswordUpdate = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setShowPasswordForm(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="animate-spin rounded-full h-12 w-12 lg:h-16 lg:w-16 border-t-2 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="p-4 lg:p-6">
      <div className="mx-auto max-w-4xl">
        {/* Header */}
        <div className="mb-6 lg:mb-8">
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
            Settings
          </h1>
          <p className="mt-2 text-sm lg:text-base text-gray-600">
            Manage your account settings and preferences.
          </p>
        </div>

        {/* Account Information */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Account Information</CardTitle>
            <CardDescription>
              Your basic account details and profile information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Email</label>
              <p className="text-sm lg:text-base text-gray-900 break-words">
                {user.email}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">
                First Name
              </label>
              <p className="text-sm lg:text-base text-gray-900">
                {user.user_metadata?.first_name || "Not set"}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">
                Last Name
              </label>
              <p className="text-sm lg:text-base text-gray-900">
                {user.user_metadata?.last_name || "Not set"}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Security Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Security
            </CardTitle>
            <CardDescription>
              Manage your account security settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-gray-700">
                Password
              </label>
              <p className="text-sm text-gray-600 mb-3">
                Change your account password. You must be logged in to change
                your password.
              </p>

              {!showPasswordForm ? (
                <Button
                  variant="outline"
                  onClick={() => setShowPasswordForm(true)}
                  className="w-full sm:w-auto"
                >
                  Change Password
                </Button>
              ) : (
                <div className="space-y-4 p-4 border rounded-lg bg-gray-50">
                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      Current Password
                    </label>
                    <Input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      placeholder="Enter your current password"
                      disabled={isUpdatingPassword}
                    />
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      New Password
                    </label>
                    <Input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter your new password (min 8 characters)"
                      disabled={isUpdatingPassword}
                      className={`${
                        hasPasswordTouched && !isPasswordLengthValid
                          ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                          : hasPasswordTouched && isPasswordLengthValid
                            ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                            : ""
                      }`}
                    />
                    {hasPasswordTouched && (
                      <div className="mt-2">
                        <div
                          className={`flex items-center text-xs ${
                            isPasswordLengthValid
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          <span className="mr-1">
                            {isPasswordLengthValid ? "✓" : "✗"}
                          </span>
                          At least 8 characters
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-medium text-gray-700 block mb-1">
                      Confirm New Password
                    </label>
                    <Input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your new password"
                      disabled={isUpdatingPassword}
                      className={`${
                        hasConfirmTouched && !isPasswordMatch
                          ? "border-red-500 focus:border-red-500 focus:ring-red-500"
                          : hasConfirmTouched && isPasswordMatch
                            ? "border-green-500 focus:border-green-500 focus:ring-green-500"
                            : ""
                      }`}
                    />
                    {hasConfirmTouched && (
                      <div className="mt-2">
                        <div
                          className={`flex items-center text-xs ${
                            isPasswordMatch ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          <span className="mr-1">
                            {isPasswordMatch ? "✓" : "✗"}
                          </span>
                          Passwords match
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      onClick={handlePasswordUpdate}
                      disabled={
                        isUpdatingPassword ||
                        !newPassword ||
                        !confirmPassword ||
                        !isPasswordLengthValid ||
                        !isPasswordMatch
                      }
                      className="flex-1 sm:flex-none"
                    >
                      {isUpdatingPassword ? "Updating..." : "Update Password"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={cancelPasswordUpdate}
                      disabled={isUpdatingPassword}
                      className="flex-1 sm:flex-none"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
