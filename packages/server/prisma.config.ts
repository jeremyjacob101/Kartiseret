import { defineConfig } from "prisma/config";

const generationOnlyUrl =
  "postgresql://prisma-generate:unused@127.0.0.1:1/prisma_generate_only?schema=public";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Prisma 7 keeps connection configuration outside schema.prisma. Generation
    // does not connect; operational SQL migrations use Supabase CLI instead.
    url: process.env.DATABASE_URL ?? generationOnlyUrl,
  },
});
