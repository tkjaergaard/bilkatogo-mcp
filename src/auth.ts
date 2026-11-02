// The auth session: turns the configured login into a shop JWT, on demand.
// Nothing happens until a tool that needs the account asks for a JWT, so
// search and the store list work with no credentials at all.
//
// A login attempt tries each source at most once, in order:
//   1. the remembered login token (the session store)
//   2. the pasted login token (BILKATOGO_LOGIN_TOKEN or login.json)
//   3. a fresh Gigya password login (BILKATOGO_EMAIL + BILKATOGO_PASSWORD)
// The first login token Gigya swaps for a JWT wins, and is remembered.

import {
  BilkaError,
  exchangeLoginToken,
  JWT_LIFETIME_SECONDS,
  type GigyaAnswer,
  passwordLogin,
  type Session,
} from "./bilka.ts";
import { type CredentialSources, readCredentials } from "./credentials.ts";
import type { SessionStore } from "./session-store.ts";

/** No login source worked. The message is safe to show the model: it never holds a secret. */
export class LoginError extends BilkaError {
  constructor(message: string) {
    super(message);
    this.name = "LoginError";
  }
}

/**
 * How long before the JWT's 24 hours run out it is refreshed, so a call never
 * goes out with a JWT about to expire. Expiry counts from when the exchange
 * was sent, which errs on the early side.
 */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** One way to get a login token, as named in error messages. */
type Source = {
  name: string;
  /** A login token, or Gigya's rejection. */
  loginToken(): Promise<{ loginToken: string } | { rejected: GigyaAnswer }>;
};

export function createSession(options: {
  fetch: typeof fetch;
  /** Undefined means no credentials are configured at all. */
  credentials: CredentialSources | undefined;
  /** Undefined means the login token is remembered in memory only. */
  store: SessionStore | undefined;
  now: () => number;
  warn: (line: string) => void;
}): Session {
  const { fetch, credentials, store, now, warn } = options;
  // The login token that last worked. Read from the store on the first login,
  // then kept in memory; undefined once Gigya has rejected it.
  let remembered: Promise<string | undefined> | undefined;
  // The JWT in use, and when to swap it for a fresh one.
  let current: { jwt: string; refreshAt: number } | undefined;
  // One login at a time: concurrent tool calls share it. A failed login isn't
  // cached, so the next call tries again (e.g. after the user fixes the token).
  let pending: Promise<string> | undefined;

  function loadRemembered(): Promise<string | undefined> {
    remembered ??= (store?.load() ?? Promise.resolve(undefined)).catch((error: unknown) => {
      warn(`warning: ${messageOf(error)}; logging in from scratch`);
      return undefined;
    });
    return remembered;
  }

  async function remember(loginToken: string): Promise<void> {
    if ((await loadRemembered()) === loginToken) return;
    remembered = Promise.resolve(loginToken);
    try {
      await store?.save(loginToken);
    } catch (error) {
      warn(
        `warning: ${messageOf(error)}; the server carries on, but will log in again after a restart`,
      );
    }
  }

  // Read lazily, source by source: a working remembered token means the
  // credentials are never read.
  async function* sources(): AsyncGenerator<Source> {
    const rememberedToken = await loadRemembered();
    if (rememberedToken !== undefined) {
      yield {
        name: "the remembered login token (session file)",
        loginToken: async () => ({ loginToken: rememberedToken }),
      };
    }
    const { loginToken, email, password } =
      credentials === undefined
        ? {}
        : await readCredentials(credentials.env, credentials.loginFile, warn);
    // Each source at most once: a pasted token that was just rejected as the
    // remembered one isn't sent again.
    if (loginToken !== undefined && loginToken !== rememberedToken) {
      yield {
        name: "the pasted login token (BILKATOGO_LOGIN_TOKEN or login.json)",
        loginToken: async () => ({ loginToken }),
      };
    }
    if (email && password) {
      yield {
        name: "email and password (BILKATOGO_EMAIL and BILKATOGO_PASSWORD)",
        loginToken: () => passwordLogin(fetch, email, password),
      };
    }
  }

  async function login(): Promise<string> {
    const failures: string[] = [];
    for await (const source of sources()) {
      const token = await source.loginToken();
      if ("rejected" in token) {
        failures.push(`${source.name}: Gigya rejected the login (${describe(token.rejected)})`);
        continue;
      }
      const outcome = await exchangeLoginToken(fetch, token.loginToken);
      if ("jwt" in outcome) {
        await remember(token.loginToken);
        return outcome.jwt;
      }
      if ((await loadRemembered()) === token.loginToken) remembered = Promise.resolve(undefined);
      failures.push(
        `${source.name}: Gigya rejected the login token (${describe(outcome.rejected)})`,
      );
    }
    if (failures.length === 0) {
      throw new LoginError(
        "No BilkaToGo login is configured. Set BILKATOGO_EMAIL and BILKATOGO_PASSWORD, or " +
          "BILKATOGO_LOGIN_TOKEN to the login token from your browser (on bilkatogo.dk, run " +
          'localStorage.getItem("auth") in the developer console). They can also go in ' +
          '~/.config/bilka-mcp/login.json as "email", "password" and "loginToken" (mode 600). ' +
          "Then restart the server.",
      );
    }
    throw new LoginError(
      `BilkaToGo login failed. Tried ${failures.join("; ")}. Check BILKATOGO_EMAIL and ` +
        "BILKATOGO_PASSWORD, or copy a fresh login token from the browser into " +
        "BILKATOGO_LOGIN_TOKEN, then restart the server.",
    );
  }

  return {
    async jwt() {
      if (current !== undefined && now() < current.refreshAt) return current.jwt;
      pending ??= (async () => {
        const startedAt = now();
        const jwt = await login();
        current = { jwt, refreshAt: startedAt + JWT_LIFETIME_SECONDS * 1000 - REFRESH_MARGIN_MS };
        return jwt;
      })().finally(() => {
        pending = undefined;
      });
      return pending;
    },

    rejected(jwt) {
      if (current?.jwt === jwt) current = undefined;
    },
  };
}

/** Gigya's numeric error code and the HTTP status: never Gigya's text, which can echo a secret. */
function describe({ status, body }: GigyaAnswer): string {
  const code = typeof body.errorCode === "number" ? `Gigya error ${body.errorCode}, ` : "";
  return `${code}HTTP ${status}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
