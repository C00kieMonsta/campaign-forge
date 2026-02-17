// Load environment variables like the app does
require("dotenv/config");

console.log("Environment Variables:");
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "SET" : "MISSING");
console.log(
  "SUPABASE_SERVICE_ROLE_KEY:",
  process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET" : "MISSING"
);
console.log(
  "SUPABASE_ANON_KEY:",
  process.env.SUPABASE_ANON_KEY ? "SET" : "MISSING"
);

if (
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_ROLE_KEY &&
  process.env.SUPABASE_ANON_KEY
) {
  console.log("✅ Supabase configuration is complete");
} else {
  console.log("❌ Supabase configuration is incomplete");
  console.log("Values:");
  console.log("  SUPABASE_URL =", process.env.SUPABASE_URL);
  console.log(
    "  SUPABASE_SERVICE_ROLE_KEY =",
    process.env.SUPABASE_SERVICE_ROLE_KEY ? "[REDACTED]" : "undefined"
  );
  console.log(
    "  SUPABASE_ANON_KEY =",
    process.env.SUPABASE_ANON_KEY ? "[REDACTED]" : "undefined"
  );
}
