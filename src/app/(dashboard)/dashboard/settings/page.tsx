import { redirect } from "next/navigation";

/**
 * The Settings page was removed (it duplicated account/session information).
 * Direct visits and stale bookmarks land back on the dashboard; this route is
 * still inside the authenticated (dashboard) layout, so unauthenticated users
 * are handled by the existing layout-level auth guard first.
 */
export default function SettingsRedirectPage() {
  redirect("/dashboard");
}
