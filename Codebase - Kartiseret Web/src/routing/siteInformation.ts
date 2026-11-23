export const siteInformationPages = [
  { path: "/support", label: "Support" },
  { path: "/accessibility", label: "Accessibility" },
  { path: "/privacy", label: "Privacy", title: "Privacy Policy" },
  { path: "/terms", label: "Terms of Use" },
  { path: "/attribution", label: "Credits" },
] as const;

export type SiteInformationPage = (typeof siteInformationPages)[number];

export const supportEmail = "jeremyjacob101@gmail.com";
