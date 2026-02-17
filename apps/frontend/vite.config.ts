import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      // Include .tsx files in Fast Refresh
      include: "**/*.{jsx,tsx}"
    }),
    tailwindcss()
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@packages/ui": path.resolve(__dirname, "../../packages/ui/src"),
      "@packages/types": path.resolve(__dirname, "../../packages/types/src"),
      "@packages/utils": path.resolve(__dirname, "../../packages/utils/src"),
      "@packages/core-client": path.resolve(
        __dirname,
        "../../packages/core-client/src"
      ),
      "@packages": path.resolve(__dirname, "../../packages"),
      "@utils": path.resolve(__dirname, "../../packages/utils/src"),
      "@ui": path.resolve(__dirname, "../../packages/ui/src")
    },
    dedupe: ["react", "react-dom"]
  },

  server: {
    port: 8000,
    host: true, // Allow external connections
    open: false, // Don't auto-open browser
    cors: true,
    fs: {
      allow: ["..", "../../packages/ui"] // Allow Vite to read files above app root
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path // Keep the /api prefix
      }
    }
  },

  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2020", // Modern browser support
    minify: "esbuild", // Fast minification
    cssCodeSplit: true, // Split CSS into separate files

    rollupOptions: {
      output: {
        // Let Vite handle automatic chunking for optimal performance
        manualChunks: undefined,

        // Optimize chunk file names
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId
            ? chunkInfo.facadeModuleId
                .split("/")
                .pop()
                ?.replace(/\.[^.]*$/, "")
            : "chunk";
          return `js/${facadeModuleId}-[hash].js`;
        },
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name?.split(".") || [];
          const ext = info[info.length - 1];
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext || "")) {
            return `img/[name]-[hash][extname]`;
          }
          if (/css/i.test(ext || "")) {
            return `css/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
        entryFileNames: "js/[name]-[hash].js"
      }
    },

    // Optimize dependencies
    commonjsOptions: {
      include: [/node_modules/]
    }
  },

  // Optimize dependencies
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react-router-dom",
      "@tanstack/react-query",
      "@supabase/supabase-js",
      "@reduxjs/toolkit",
      "react-redux"
    ],
    exclude: ["@packages/utils"]
  },

  // Environment validation - will be checked by our env.ts module
  define: {
    __DEV__: JSON.stringify(
      !process.env.NODE_ENV || process.env.NODE_ENV === "development"
    ),
    __PROD__: JSON.stringify(process.env.NODE_ENV === "production")
  },

  // CSS configuration
  css: {
    devSourcemap: true,
    postcss: {
      plugins: []
    }
  },

  // Keep UI packages bundled (not externalized)
  ssr: {
    noExternal: ["@packages/ui", "@packages/core-client"]
  },

  // Preview server configuration (for production builds)
  preview: {
    port: 8080,
    host: true,
    cors: true
  }
});
