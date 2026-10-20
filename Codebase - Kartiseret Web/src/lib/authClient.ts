import { inferAdditionalFields } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/client";

const client = createAuthClient({
  basePath: "/api/auth",
  plugins: [
    inferAdditionalFields({
      user: { signupLocation: { type: "string", required: false } },
    }),
  ],
});

export function getAuthClient() {
  return client;
}
