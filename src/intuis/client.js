// -----------------------------------------------------------------------------
// HTTP client of the intuis Connect cloud (formerly "Muller Intuitiv with
// Netatmo"). The API is Netatmo Energy's, hosted for intuis: OAuth2 password
// grant, then `homesdata`, `homestatus`, `setstate`, `setthermmode` and
// `getroommeasure`, as the community projects credited in the README use them.
//
// What this module guarantees:
//   - the password is only ever sent to the token endpoint; the tokens it
//     returns are handed to `onSession` (persisted under /data) and never
//     appear in an error message;
//   - an expired access token is refreshed once and the request replayed;
//     a refused refresh signs in again with the password;
//   - every error carries a short `kind` (credentials, network, rate_limited,
//     api) so the caller can phrase it for the user and pace its retries.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

// The two clusters the intuis app talks to, in the order it tries them.
export const BASE_URLS = ['https://app.muller-intuitiv.net', 'https://app-prod.intuis-sas.com'];

// Identifiers of the intuis Connect mobile app, the same for every user (they
// are inside the app; the Jeedom, Node-RED and Home Assistant projects use
// them). They identify the application, not the account: only the user's
// e-mail and password are personal. Two app generations are in circulation;
// the second is tried when intuis no longer knows the first (`invalid_client`).
export const APP_CLIENTS = [
  { id: '59e604948fe283fd4dc7e355', secret: 'rAeWu8Y3YqXEPqRJ4BpFzFG98MRXpCcz' },
  { id: '59e604638fe283fd4dc7e353', secret: 'ZW2vL8czEkn87zemtR1h1ZB0ZVwoeR' },
];
const SCOPE = 'read_muller write_muller';
const USER_PREFIX = 'muller';

const TIMEOUT_MS = 20_000;
// Refresh a little before the access token expires (it lasts 3 hours).
const EXPIRY_MARGIN_MS = 5 * 60_000;
// Netatmo error codes: 2 invalid token, 3 expired token, 26 user usage reached.
const TOKEN_ERROR_CODES = new Set([2, 3]);
const RATE_LIMIT_CODES = new Set([26]);

export class IntuisError extends Error {
  /**
   * @param {'credentials'|'network'|'rate_limited'|'api'} kind
   * @param {string} message never contains a token nor the password
   * @param {{ status?: number, code?: number|string, retryAfterMs?: number }} [details]
   */
  constructor(kind, message, details = {}) {
    super(message);
    this.name = 'IntuisError';
    this.kind = kind;
    this.status = details.status;
    this.code = details.code;
    this.retryAfterMs = details.retryAfterMs;
  }
}

/** A short, stable fingerprint of the account: tokens of another one are dropped. */
export function accountKey(username) {
  return createHash('sha256')
    .update(String(username).trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

async function readJson(response) {
  const text = await response.text();
  if (text === '') {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 200) };
  }
}

/** The Netatmo error of a body: `{ error: { code, message } }` or `{ error: "invalid_grant" }`. */
function apiError(body) {
  const error = body?.error;
  if (!error) {
    return null;
  }
  if (typeof error === 'string') {
    return { code: error, message: body.error_description ?? error };
  }
  return { code: error.code, message: error.message ?? 'error' };
}

function retryAfterMs(response) {
  const seconds = Number(response.headers?.get?.('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
}

export class IntuisClient {
  /**
   * @param {object} options
   * @param {string} options.username
   * @param {string} options.password
   * @param {object} [options.session] tokens saved by a previous run
   * @param {(session: object) => void} [options.onSession] persist new tokens
   * @param {typeof fetch} [options.fetch]
   * @param {() => number} [options.now]
   */
  constructor({ username, password, session, onSession, fetch, now }) {
    this.username = username;
    this.password = password;
    this.account = accountKey(username);
    this.fetch = fetch ?? globalThis.fetch;
    this.now = now ?? (() => Date.now());
    this.onSession = onSession ?? (() => {});
    // Tokens of another account (the e-mail changed) are worth nothing.
    this.session = session?.account === this.account ? { ...session } : null;
    this.baseUrl = this.session?.base_url ?? BASE_URLS[0];
    // A refresh token only works with the app identifiers that issued it.
    this.client =
      APP_CLIENTS.find((client) => client.id === this.session?.client_id) ?? APP_CLIENTS[0];
    // One sign-in at a time: parallel requests wait for the same one.
    this.signingIn = null;
  }

  // --- Transport ---------------------------------------------------------------

  async send(url, init) {
    try {
      return await this.fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? 'timeout' : (err.cause?.code ?? err.message);
      throw new IntuisError('network', `intuis cloud unreachable (${reason})`);
    }
  }

  // --- Authentication ----------------------------------------------------------

  async tokenRequest(baseUrl, form) {
    const response = await this.send(`${baseUrl}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
    const body = await readJson(response);
    if (response.ok && typeof body.access_token === 'string') {
      return body;
    }
    if (response.status === 429) {
      throw new IntuisError('rate_limited', 'intuis sign-in rate limited', {
        status: 429,
        retryAfterMs: retryAfterMs(response),
      });
    }
    const error = apiError(body);
    if ([400, 401, 403].includes(response.status)) {
      throw new IntuisError(
        'credentials',
        `intuis refused the sign-in (${error?.code ?? response.status})`,
        {
          status: response.status,
          code: error?.code,
        },
      );
    }
    throw new IntuisError('api', `intuis sign-in failed (HTTP ${response.status})`, {
      status: response.status,
    });
  }

  storeTokens(baseUrl, client, body) {
    const expiresInMs = (Number(body.expires_in) > 0 ? Number(body.expires_in) : 10_800) * 1000;
    this.baseUrl = baseUrl;
    this.client = client;
    this.session = {
      account: this.account,
      base_url: baseUrl,
      client_id: client.id,
      access_token: body.access_token,
      refresh_token: body.refresh_token ?? this.session?.refresh_token,
      expires_at: this.now() + expiresInMs,
    };
    this.onSession({ ...this.session });
  }

  /** Sign in with the e-mail and the password, trying both clusters. */
  async login() {
    const bases = [this.baseUrl, ...BASE_URLS.filter((url) => url !== this.baseUrl)];
    const clients = [this.client, ...APP_CLIENTS.filter((client) => client !== this.client)];
    let lastError = null;
    for (const base of bases) {
      for (const client of clients) {
        try {
          const body = await this.tokenRequest(base, {
            grant_type: 'password',
            client_id: client.id,
            client_secret: client.secret,
            scope: SCOPE,
            user_prefix: USER_PREFIX,
            username: this.username,
            password: this.password,
          });
          this.storeTokens(base, client, body);
          return;
        } catch (err) {
          lastError = err;
          // An unknown app: try the other identifiers.
          if (err.kind === 'credentials' && err.code === 'invalid_client') {
            continue;
          }
          // A refused password is refused by every cluster: stop there.
          if (err.kind === 'credentials' || err.kind === 'rate_limited') {
            throw err;
          }
          break;
        }
      }
    }
    throw lastError;
  }

  /** Trade the refresh token for a new access token; sign in again if refused. */
  async refresh() {
    const refreshToken = this.session?.refresh_token;
    if (refreshToken) {
      try {
        const body = await this.tokenRequest(this.baseUrl, {
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: this.client.id,
          client_secret: this.client.secret,
          user_prefix: USER_PREFIX,
        });
        this.storeTokens(this.baseUrl, this.client, body);
        return;
      } catch (err) {
        if (err.kind !== 'credentials') {
          throw err;
        }
        // The refresh token was revoked (password changed, too old): sign in.
      }
    }
    await this.login();
  }

  /** Make sure a valid access token is at hand (one sign-in for parallel callers). */
  async authenticate({ force = false } = {}) {
    const valid =
      this.session?.access_token && this.session.expires_at - EXPIRY_MARGIN_MS > this.now();
    if (valid && !force) {
      return;
    }
    if (!this.signingIn) {
      this.signingIn = (this.session?.refresh_token ? this.refresh() : this.login()).finally(() => {
        this.signingIn = null;
      });
    }
    await this.signingIn;
  }

  // --- Requests ----------------------------------------------------------------

  /**
   * One authenticated call. `form` is sent url-encoded, `json` as JSON.
   * @returns {Promise<object>} the response body
   */
  async request(method, path, { form, json, query } = {}, retried = false) {
    await this.authenticate();
    const headers = { Authorization: `Bearer ${this.session.access_token}` };
    let body;
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(json);
    } else if (form !== undefined) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const search = query ? `?${new URLSearchParams(query).toString()}` : '';
    const response = await this.send(`${this.baseUrl}${path}${search}`, { method, headers, body });
    const payload = await readJson(response);
    const error = apiError(payload);

    const tokenRefused =
      response.status === 401 || (error && TOKEN_ERROR_CODES.has(Number(error.code)));
    if (tokenRefused && !retried) {
      await this.authenticate({ force: true });
      return this.request(method, path, { form, json, query }, true);
    }
    if (response.status === 429 || (error && RATE_LIMIT_CODES.has(Number(error.code)))) {
      throw new IntuisError('rate_limited', `intuis rate limit reached on ${path}`, {
        status: response.status,
        code: error?.code,
        retryAfterMs: retryAfterMs(response),
      });
    }
    if (!response.ok || error) {
      const what = error ? `${error.code}: ${error.message}` : `HTTP ${response.status}`;
      throw new IntuisError('api', `intuis ${path} failed (${what})`, {
        status: response.status,
        code: error?.code,
      });
    }
    return payload;
  }

  // --- Endpoints ---------------------------------------------------------------

  /** Homes of the account: rooms, modules, schedules, home mode. */
  async homesData() {
    const payload = await this.request('GET', '/api/homesdata');
    return payload.body?.homes ?? [];
  }

  /** Live state of one home: rooms (temperatures, modes) and modules. */
  async homeStatus(homeId) {
    const payload = await this.request('POST', '/syncapi/v1/homestatus', {
      form: { home_id: homeId },
    });
    return payload.body?.home ?? {};
  }

  /** Settings of one home, among them the default duration of a manual setpoint. */
  async homeConfigs(homeId) {
    const payload = await this.request('POST', '/syncapi/v1/getconfigs', {
      form: { home_id: homeId },
    });
    return payload.body?.home ?? {};
  }

  /**
   * Change one room: `{ therm_setpoint_mode, therm_setpoint_temperature?,
   * therm_setpoint_end_time? }`.
   */
  async setRoomState(homeId, roomId, state, timezone) {
    await this.request('POST', '/syncapi/v1/setstate', {
      json: {
        app_identifier: 'app_muller',
        home: {
          id: homeId,
          ...(timezone ? { timezone } : {}),
          rooms: [{ id: roomId, ...state }],
        },
      },
    });
  }

  /** Mode of the whole home: `schedule`, `away` or `hg` (frost protection). */
  async setHomeMode(homeId, mode) {
    await this.request('POST', '/api/setthermmode', { json: { home_id: homeId, mode } });
  }

  /**
   * Energy of one room between two instants (seconds), at `scale` (`30min`,
   * `1day`). Every tariff column is asked for: which one carries the
   * consumption depends on the contract entered in the app.
   */
  async roomMeasure({ homeId, roomId, scale, begin, end }) {
    const payload = await this.request('POST', '/api/getroommeasure', {
      form: {
        home_id: homeId,
        room_id: roomId,
        scale,
        type: ENERGY_TYPES.join(','),
        date_begin: String(begin),
        date_end: String(end),
      },
    });
    return payload.body ?? [];
  }
}

// The total, then the three tariff periods of the contract (base or peak,
// off-peak, a third period for Tempo-like contracts). Order matters: it is
// the column order of the answer.
export const ENERGY_TYPES = [
  'sum_energy_elec',
  'sum_energy_elec$0',
  'sum_energy_elec$1',
  'sum_energy_elec$2',
];
