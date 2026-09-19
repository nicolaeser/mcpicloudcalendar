export class ConfirmationRequiredError extends Error {
  public constructor(toolName: string) {
    super(`${toolName} is a write. Pass confirm: true after reviewing the arguments.`);
    this.name = "ConfirmationRequiredError";
  }
}

export class MissingTokenError extends Error {
  public constructor() {
    super(
      "No iCloud Calendar credentials are configured. For stdio, set ICLOUD_EMAIL and ICLOUD_APP_PASSWORD. For HTTP OAuth, enter them on the login page."
    );
    this.name = "MissingTokenError";
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "Error";
}
