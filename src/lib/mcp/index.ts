import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listClassrooms from "./tools/list-classrooms";
import getMyProfile from "./tools/get-profile";
import listAssignments from "./tools/list-assignments";

// The OAuth issuer must be the direct Supabase host. On publish, SUPABASE_URL is
// rewritten to the .lovable.cloud proxy which mcp-js rejects. Use the project ref
// literal that Vite inlines at build time; the fallback keeps the issuer well-formed
// during the throwaway manifest-extract eval.
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "scholarhall-mcp",
  title: "โรงเรียนศึกษาสงเคราะห์จิตต์อารีฯ – Scholar Hall",
  version: "0.1.0",
  instructions:
    "Tools for the Scholar Hall classroom app. Use `get_my_profile` for the signed-in user's XP/level, `list_classrooms` to enumerate accessible classrooms, and `list_assignments` for a classroom's assignments.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getMyProfile, listClassrooms, listAssignments],
});
