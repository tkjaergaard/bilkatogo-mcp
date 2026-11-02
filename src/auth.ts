// The auth session: turns the configured login into a shop JWT, on demand.
// Nothing happens until a tool that needs the account asks for a JWT, so
// search and the store list work with no credentials at all.
//
// Today the only login source is a pasted login token. Issue #6 adds the
// remembered token (session store), password login, refresh before expiry and
// "refresh once, retry once" after a NotLoggedInError; they slot into
// `login()` and `jwt()` below.

import { BilkaError, exchangeLoginToken, type Session } from "./bilka.ts";
import { type CredentialSources, readCredentials } from "./credentials.ts";

/** No login source worked. The message is safe to show the model: it never holds a secret. */
export class LoginError extends BilkaError {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

export function createSession(options: {
  fetch: typeof fetch;
  /** Undefined means no credentials are configured at all. */
  credentials: CredentialSources | undefined;
  warn: (line: string) => void;
}): Session {
  const { fetch, credentials, warn } = options;
  // One login at a time: concurrent tool calls share it. A failed login isn't
  // cached, so the next call tries again (e.g. after the user fixes the token).
  let pending: Promise<string> | undefined;

  async function login(): Promise<string> {
    const { loginToken, email, password } =
      credentials === undefined
        ? {}
        : await readCredentials(credentials.env, credentials.loginFile, warn);
    if (loginToken === undefined) {
      throw new LoginError(
        email && password
          ? "Password login isn't supported yet. Set BILKATOGO_LOGIN_TOKEN to the login token " +
              'from your browser (on bilkatogo.dk, run localStorage.getItem("auth") in the ' +
              "developer console), then restart the server."
          : "No BilkaToGo login is configured. Set BILKATOGO_LOGIN_TOKEN to the login token " +
              'from your browser (on bilkatogo.dk, run localStorage.getItem("auth") in the ' +
              'developer console), or put it as "loginToken" in ~/.config/bilka-mcp/login.json ' +
              "(mode 600), then restart the server.",
      );
    }
    const outcome = await exchangeLoginToken(fetch, loginToken);
    if ("jwt" in outcome) return outcome.jwt;
    const { status, body } = outcome.rejected;
    const code = typeof body.errorCode === "number" ? `Gigya error ${body.errorCode}, ` : "";
    throw new LoginError(
      `BilkaToGo login failed: Gigya rejected the login token (${code}HTTP ${status}). ` +
        "It has probably expired or been logged out. Copy a fresh one from the browser, set " +
        "BILKATOGO_LOGIN_TOKEN, then restart the server.",
    );
  }

  return {
    jwt() {
      pending ??= login().catch((error: unknown) => {
        pending = undefined;
        throw error;
      });
      return pending;
    },
  };
}
