// -----------------------------------------------------------------------------
// A fake intuis cloud, behind a `fetch` function: the OAuth2 token endpoint
// and the Netatmo-style endpoints the integration calls, answering with the
// fixtures of test/fixtures/intuis/ and applying the commands to its state, so
// a re-read shows their effect. Nothing leaves the process.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/intuis/${name}.json`, import.meta.url), 'utf8'));

export const FIXTURES = {
  homesdata: () => fixture('homesdata'),
  homestatus: () => fixture('homestatus'),
  getconfigs: () => fixture('getconfigs'),
  token: () => fixture('token'),
  measureDay: () => fixture('roommeasure_1day'),
};

export const HOME_ID = '5e8a1c2b3d4f5a6b7c8d9e0f';
export const ROOMS = {
  LIVING: '2140019301',
  BEDROOM: '2140019302',
  BATHROOM: '2140019303',
  OFFICE: '2140019304',
};
export const USERNAME = 'utilisateur@example.com';
export const PASSWORD = 'Correct-Horse-42';
export const KNOWN_CLIENT_IDS = ['59e604948fe283fd4dc7e355', '59e604638fe283fd4dc7e353'];

const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

/**
 * @param {object} [options]
 * @param {() => number} [options.now] the cloud clock, in ms
 * @param {Record<string, '30min'|'1day'>} [options.energy] rooms reporting a consumption
 * @param {string[]} [options.clientIds] app identifiers intuis accepts
 */
export function createFakeIntuis({
  now = () => Date.now(),
  energy = { [ROOMS.LIVING]: '30min', [ROOMS.BEDROOM]: '1day' },
  clientIds = KNOWN_CLIENT_IDS,
} = {}) {
  const homesdata = FIXTURES.homesdata();
  const homestatus = FIXTURES.homestatus();
  const cloud = {
    homesdata,
    homestatus,
    energy,
    password: PASSWORD,
    clientIds,
    requests: [],
    /** Tokens currently valid. */
    accessToken: null,
    refreshToken: null,
    issued: 0,
    /** 'network' | 'rate_limited' | 'server' | null: how every call fails. */
    failure: null,
    /** Unreachable hosts (network error), e.g. the primary cluster. */
    deadHosts: new Set(),
    /** Make the next authenticated call see an expired token. */
    expireToken() {
      cloud.accessToken = `expired-${cloud.accessToken}`;
    },
    room(id) {
      return cloud.homestatus.body.home.rooms.find((room) => room.id === id);
    },
    count(path) {
      return cloud.requests.filter((request) => request.path === path).length;
    },
  };

  function issueTokens() {
    cloud.issued += 1;
    cloud.accessToken = `access-${cloud.issued}`;
    cloud.refreshToken = `refresh-${cloud.issued}`;
    return {
      ...FIXTURES.token(),
      access_token: cloud.accessToken,
      refresh_token: cloud.refreshToken,
    };
  }

  function token(form) {
    if (!cloud.clientIds.includes(form.get('client_id'))) {
      return json(400, { error: 'invalid_client' });
    }
    if (form.get('grant_type') === 'password') {
      if (form.get('password') !== cloud.password || form.get('username') !== USERNAME) {
        return json(400, { error: 'invalid_grant' });
      }
      return json(200, issueTokens());
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (form.get('refresh_token') !== cloud.refreshToken) {
        return json(400, { error: 'invalid_grant' });
      }
      return json(200, issueTokens());
    }
    return json(400, { error: 'unsupported_grant_type' });
  }

  function setState(body) {
    for (const change of body.home?.rooms ?? []) {
      const room = cloud.room(change.id);
      if (!room) {
        return json(400, { error: { code: 31, message: 'Device not found in home' } });
      }
      const mode = change.therm_setpoint_mode;
      room.therm_setpoint_mode = mode;
      if (mode === 'manual') {
        room.therm_setpoint_temperature = change.therm_setpoint_temperature;
        room.therm_setpoint_end_time = change.therm_setpoint_end_time;
      } else {
        room.therm_setpoint_end_time = 0;
        room.therm_setpoint_temperature = { home: 19, away: 16, hg: 7 }[mode] ?? 19;
      }
    }
    return json(200, { status: 'ok', time_server: Math.floor(now() / 1000) });
  }

  function measure(form) {
    const scale = form.get('scale');
    const reported = cloud.energy[form.get('room_id')];
    const begin = Number(form.get('date_begin'));
    const end = Number(form.get('date_end'));
    if (!reported || (scale === '30min' && reported !== '30min')) {
      return json(200, { body: [], status: 'ok' });
    }
    if (scale === '1day') {
      // Days stamped at noon (the middle of the day), like Netatmo.
      const first = Math.floor(begin / 86400) * 86400 + 11 * 3600;
      const value = [];
      for (let at = first; at < end; at += 86400) {
        value.push([null, null, 4200, 2100]);
      }
      return json(200, { body: [{ beg_time: first, step_time: 86400, value }], status: 'ok' });
    }
    // 30 minutes: stamped in the middle of the slot (+15 min), 100 Wh off-peak
    // at night, 250 Wh peak in the day.
    const first = Math.ceil(begin / 1800) * 1800 + 900;
    const value = [];
    for (let at = first; at < end; at += 1800) {
      const hour = new Date(at * 1000).getUTCHours();
      value.push(hour < 5 ? [null, null, 100, null] : [null, 250, null, null]);
    }
    return json(200, { body: [{ beg_time: first, step_time: 1800, value }], status: 'ok' });
  }

  async function fetch(url, init = {}) {
    const { host, pathname } = new URL(url);
    const method = init.method ?? 'GET';
    const contentType = init.headers?.['Content-Type'] ?? '';
    const form = contentType.includes('urlencoded') ? new URLSearchParams(init.body) : null;
    const body = contentType.includes('json') ? JSON.parse(init.body) : null;
    cloud.requests.push({ host, method, path: pathname, form, body, headers: init.headers ?? {} });

    if (cloud.deadHosts.has(host) || cloud.failure === 'network') {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
    }
    if (cloud.failure === 'rate_limited') {
      return json(
        429,
        { error: { code: 26, message: 'User usage reached' } },
        { 'Retry-After': '120' },
      );
    }
    if (cloud.failure === 'server') {
      return json(503, { error: { code: 1, message: 'Service unavailable' } });
    }
    if (pathname === '/oauth2/token') {
      return token(form);
    }
    const authorization = init.headers?.Authorization;
    if (!cloud.accessToken || authorization !== `Bearer ${cloud.accessToken}`) {
      const code = authorization?.includes('expired') ? 3 : 2;
      return json(403, {
        error: { code, message: code === 3 ? 'Access token expired' : 'Invalid access_token' },
      });
    }
    switch (`${method} ${pathname}`) {
      case 'GET /api/homesdata':
        return json(200, structuredClone(cloud.homesdata));
      case 'POST /syncapi/v1/homestatus': {
        if (form.get('home_id') !== HOME_ID) {
          return json(200, {
            status: 'ok',
            body: { home: { id: form.get('home_id'), rooms: [], modules: [] } },
          });
        }
        return json(200, structuredClone(cloud.homestatus));
      }
      case 'POST /syncapi/v1/getconfigs':
        return json(200, FIXTURES.getconfigs());
      case 'POST /syncapi/v1/setstate':
        return setState(body);
      case 'POST /api/setthermmode': {
        const home = cloud.homesdata.body.homes.find((candidate) => candidate.id === body.home_id);
        if (!home || !['schedule', 'away', 'hg'].includes(body.mode)) {
          return json(400, { error: { code: 21, message: 'Invalid argument' } });
        }
        home.therm_mode = body.mode;
        return json(200, { status: 'ok' });
      }
      case 'POST /api/getroommeasure':
        return measure(form);
      default:
        return json(404, { error: { code: 404, message: 'Not found' } });
    }
  }

  cloud.fetch = fetch;
  return cloud;
}
