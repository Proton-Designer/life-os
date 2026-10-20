/**
 * The Settings page's section list. It drives BOTH the left tab list and the order the
 * panels render in the scrolling page (components/settings/settings-form.tsx slots +
 * app/(app)/settings/page.tsx), so the two can't drift: lib/settings/__tests__/
 * sections-order.test.ts pins the page against this list.
 */
export const SETTINGS_SECTIONS = [
  { id: "profile", label: "Profile" },
  { id: "appearance", label: "Appearance" },
  { id: "features", label: "Features" },
  { id: "prayer", label: "Prayer" },
  { id: "location", label: "Location" },
  { id: "timezone", label: "Timezone" },
  { id: "checkins", label: "Check-ins" },
  { id: "notifications", label: "Notifications" },
  { id: "reading", label: "Reading" },
  { id: "ai", label: "AI features" },
  { id: "canvas", label: "Canvas" },
  { id: "rescuetime", label: "RescueTime" },
  { id: "whoop", label: "Whoop" },
  { id: "connectors", label: "Connectors" },
  { id: "webhooks", label: "Webhooks" },
  { id: "security", label: "Security" },
  { id: "data", label: "Data" },
] as const;
