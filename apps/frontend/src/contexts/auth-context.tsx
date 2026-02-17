import { createContext, useContext, useEffect, useState } from "react";
import {
  CreateUserProfileRequestSchema,
  type CreateUserProfileRequest
} from "@packages/types";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowser } from "@/lib/supabase-browser";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (
    email: string,
    password: string,
    userData: CreateUserProfileRequest,
    invitationToken?: string
  ) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (newPassword: string) => Promise<void>;
  getAccessToken: () => Promise<string | null>;
  refreshToken: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Use singleton client
const getSupabaseClient = getSupabaseBrowser;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Clear any cached sessions if environment changed
    const currentEnv = import.meta.env.VITE_SUPABASE_URL;
    const lastEnv = localStorage.getItem("supabase_last_env");
    if (lastEnv && lastEnv !== currentEnv) {
      localStorage.clear();
      sessionStorage.clear();
    }
    localStorage.setItem("supabase_last_env", currentEnv || "");

    const supabase = getSupabaseClient();

    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });
    if (error) throw error;
  };

  const signUp = async (
    email: string,
    password: string,
    userData: CreateUserProfileRequest,
    invitationToken?: string
  ) => {
    // Validate user profile data
    const validatedUserData = CreateUserProfileRequestSchema.parse(userData);

    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          first_name: validatedUserData.firstName,
          last_name: validatedUserData.lastName,
          invitation_token: invitationToken // Include invitation token if provided
        },
        emailRedirectTo: `${window.location.origin}/auth/callback`
      }
    });
    if (error) throw error;
  };

  const signOut = async () => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  const resetPassword = async (email: string) => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`
    });
    if (error) throw error;
  };

  const updatePassword = async (newPassword: string) => {
    const supabase = getSupabaseClient();
    console.log("Updating password with Supabase...");
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword
    });
    if (error) {
      throw error;
    }
    console.log("Supabase updateUser success:", data);
  };

  // Get current access token
  const getAccessToken = async (): Promise<string | null> => {
    const supabase = getSupabaseClient();
    const {
      data: { session },
      error
    } = await supabase.auth.getSession();

    if (error) {
      return null;
    }

    return session?.access_token || null;
  };

  // Refresh the current session token
  const refreshToken = async (): Promise<void> => {
    const supabase = getSupabaseClient();
    const { error } = await supabase.auth.refreshSession();

    if (error) {
      throw error;
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        resetPassword,
        updatePassword,
        getAccessToken,
        refreshToken
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // During SSR, context might not be available, return default values
    if (typeof window === "undefined") {
      return {
        user: null,
        session: null,
        loading: true,
        signIn: async () => {
          throw new Error("Not available during SSR");
        },
        signUp: async () => {
          throw new Error("Not available during SSR");
        },
        signOut: async () => {
          throw new Error("Not available during SSR");
        },
        resetPassword: async () => {
          throw new Error("Not available during SSR");
        },
        updatePassword: async () => {
          throw new Error("Not available during SSR");
        },
        getAccessToken: async () => {
          throw new Error("Not available during SSR");
        },
        refreshToken: async () => {
          throw new Error("Not available during SSR");
        }
      };
    }
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
