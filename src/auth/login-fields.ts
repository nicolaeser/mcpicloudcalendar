import type { LoginField } from "./fields.js";
import type { CalendarCredentials } from "../caldav/types.js";
import { ICLOUD_CALDAV_URL } from "../caldav/icloud.js";

export function loginFields(): readonly LoginField[] {
  return [
    {
      name: "email",
      label: "iCloud address",
      type: "text",
      required: true,
      secret: false,
      envFallback: "ICLOUD_EMAIL",
      prompt: "if-missing",
      autocomplete: "username",
      placeholder: "you@icloud.com",
      help: "Full iCloud address (@icloud.com, @me.com, @mac.com, or an iCloud custom domain)."
    },
    {
      name: "appPassword",
      label: "App-specific password",
      type: "password",
      required: true,
      secret: true,
      envFallback: "ICLOUD_APP_PASSWORD",
      prompt: "if-missing",
      autocomplete: "current-password",
      placeholder: "xxxx-xxxx-xxxx-xxxx",
      help: "Create an app-specific password in your Apple Account security settings. Your regular Apple Account password will not work. CalDAV server settings are configured for you."
    }
  ];
}

export interface CalendarEnv {
  readonly email?: string | undefined;
  readonly appPassword?: string | undefined;
}

export function credentialsFromBag(
  bag: {
    readonly secrets: Readonly<Record<string, string>>;
    readonly claims?: Readonly<Record<string, string>>;
  },
  env: CalendarEnv = {}
): CalendarCredentials | undefined {
  const claims = bag.claims ?? {};
  const email = (claims.email ?? env.email ?? "").trim().toLowerCase();
  const password = bag.secrets.appPassword ?? env.appPassword ?? "";
  if (!email.includes("@") || password.length === 0) return undefined;
  return {
    email,
    password,
    caldavUrl: ICLOUD_CALDAV_URL,
    username: email
  };
}
