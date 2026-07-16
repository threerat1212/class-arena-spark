// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "https://fkjazvlqfgycoauemopz.supabase.co";
const supabasePublishableKey =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZramF6dmxxZmd5Y29hdWVtb3B6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3MTYwMDksImV4cCI6MjA5NTI5MjAwOX0.lJL0cpWUpoTAeZRVefbjmmxB8uN3XCQLe_JVePbl4lg";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
const plugins: any[] = [mcpPlugin()];

export default defineConfig({
  plugins: process.env.SKIP_MCP_PLUGIN ? [] : plugins,
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(supabasePublishableKey),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined;

            if (id.includes("react-dom") || id.includes("react/")) return "vendor-react";
            if (id.includes("@supabase/")) return "vendor-supabase";
            if (id.includes("@radix-ui/")) return "vendor-radix";
            if (id.includes("i18next") || id.includes("react-i18next")) return "vendor-i18n";
            if (id.includes("recharts")) return "vendor-charts";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("motion")) return "vendor-motion";

            return undefined;
          },
        },
      },
    },
  },
});
