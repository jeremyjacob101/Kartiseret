import { createProductionApp } from "@kartiseret/server/production";

// Vercel's catch-all handles the versioned Express API. Existing fixed OG routes
// remain more specific, and unmatched /api paths receive the Express JSON 404.
const { app } = createProductionApp();

export default app;
