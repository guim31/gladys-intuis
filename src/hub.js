// -----------------------------------------------------------------------------
// The integration's state and work: signing in to intuis, reading the homes
// every 5 minutes, publishing the devices and their states, running the
// commands, and feeding the energy consumption.
//
// Pace and quota. intuis publishes no quota; its API is Netatmo's, whose
// documented limit is 500 requests per hour and per user. One refresh reads
// `homesdata` once and `homestatus` once per home: 24 requests an hour for one
// home. The energy is read once an hour, one request per room that reports
// it. A command adds a write and one re-read. A 429 (or Netatmo's error 26)
// pauses the readings for 15 minutes; a refused password stops the sign-in
// attempts until the configuration changes, or 30 minutes have passed, so a
// wrong password never locks the account.
//
// Logs. Info only for the lifecycle (start, connection, loss and return of the
// cloud, one line per user action); a cycle that goes well writes nothing above
// debug, a failure that repeats writes one line when it starts and one when it
// ends (src/issues.js). Never a token, a password or an e-mail.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { isConfigured, manualMinutes, normalizeConfig } from './config.js';
import {
  DEVICE_TYPES,
  OPTIONAL_ROOM_FEATURES,
  ROOM_FEATURES,
  HOME_FEATURES,
  buildHomeDevice,
  buildRoomDevice,
  homeIds,
  homeStates,
  observedFeatures,
  roomIds,
  roomStates,
} from './devices.js';
import { MESSAGES, PRESET_NAMES, STATUS, pick } from './i18n.js';
import { IntuisClient, IntuisError } from './intuis/client.js';
import {
  PRESET_TO_HOME_MODE,
  PRESET_TO_ROOM_MODE,
  SCALES,
  SETPOINT,
  THERMOSTAT_MODE,
  defaultManualMinutes,
  localDate,
  parseHomes,
  parseMeasures,
  parseRoomStates,
} from './intuis/model.js';
import { createIssueLog } from './issues.js';

const logger = createLogger({ name: 'intuis' });

export const DEFAULT_TIMINGS = {
  // The pace of the brief: every 5 minutes, and a re-read after a command.
  refreshMs: 5 * 60_000,
  energyMs: 60 * 60_000,
  // intuis applies a command through the gateway: give it a moment.
  rereadDelayMs: 3_000,
  rateLimitPauseMs: 15 * 60_000,
  credentialsRetryMs: 30 * 60_000,
  // An unchanged value is re-sent twice a day: the front says "no recent
  // value" past 48 hours.
  heartbeatMs: 6 * 60 * 60_000,
  // A room that reported no energy is asked again once a week.
  energyProbeRetryMs: 7 * 24 * 60 * 60_000,
};

const HOUR = 3600;
const DAY = 86400;

export class IntuisHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {import('./store.js').Store} options.store
   * @param {typeof fetch} [options.fetch]
   * @param {boolean} [options.timers] run the periodic timers (tests may turn them off)
   * @param {object} [options.timings]
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, fetch, timers = true, timings = {}, now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetch;
    this.timers = timers;
    this.timings = { ...DEFAULT_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = normalizeConfig();
    this.client = null;
    this.data = { rooms: {} };
    /** @type {Array<object>} parsed homes */
    this.homes = [];
    /** @type {Map<string, Map<string, object>>} room states by home id */
    this.states = new Map();
    this.accountMinutes = new Map();
    this.published = null;
    this.lastRefreshAt = null;
    this.lastEnergyAt = null;
    this.pausedUntil = 0;
    this.blockedUntil = 0;
    this.connected = false;
    this.refreshing = null;
    this.refreshTimer = null;
    this.energyTimer = null;
    this.rereadTimer = null;
    this.stopped = false;
    this.issues = createIssueLog(logger);
    this.loaded = null;
  }

  get language() {
    return this.config.language;
  }

  // --- Lifecycle ------------------------------------------------------------------

  async load() {
    this.loaded ??= this.store.load().then((data) => {
      this.data = { rooms: {}, ...data };
      if (typeof this.data.rooms !== 'object' || this.data.rooms === null) {
        this.data.rooms = {};
      }
    });
    return this.loaded;
  }

  save() {
    return this.store.save(this.data);
  }

  /** (Re)start with a configuration: a new client, a refresh now, the timers. */
  async start(rawConfig) {
    await this.load();
    // A (re)start always says where it stands, even if it is the same as before.
    this.lastStatus = null;
    const config = normalizeConfig(rawConfig);
    const accountChanged =
      config.username !== this.config.username || config.password !== this.config.password;
    this.config = config;
    if (accountChanged || !this.client) {
      this.client = isConfigured(config)
        ? new IntuisClient({
            username: config.username,
            password: config.password,
            session: this.data.session,
            fetch: this.fetch,
            now: this.now,
            onSession: (session) => {
              this.data.session = session;
              this.save();
            },
          })
        : null;
      this.blockedUntil = 0;
      this.pausedUntil = 0;
      this.connected = false;
      this.homes = [];
      this.states.clear();
      this.accountMinutes.clear();
      this.published = null;
    }
    this.stopped = false;
    if (!this.client) {
      logger.info('Not configured yet: waiting for the intuis e-mail and password');
      await this.setStatus(false, STATUS.notConfigured);
      return;
    }
    // A new language renames the features of the devices added from now on.
    this.published = null;
    await this.refresh({ force: true });
    this.lastEnergyAt = null;
    await this.refreshEnergy();
    this.schedule();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.energyTimer);
    clearTimeout(this.rereadTimer);
    this.refreshTimer = null;
    this.energyTimer = null;
    this.rereadTimer = null;
    return this.store.flush();
  }

  // --- Timers -------------------------------------------------------------------
  //
  // The core cannot be trusted to poll an external device (GladysAssistant/
  // Gladys#3198), and its scheduler cannot go slower than once a minute: the
  // container refreshes by itself. The core's onPoll stays as a fallback,
  // skipped while this timer keeps up.

  schedule() {
    clearTimeout(this.refreshTimer);
    clearTimeout(this.energyTimer);
    if (!this.timers || this.stopped) {
      return;
    }
    const loop = (key, period, work) => {
      this[key] = setTimeout(async () => {
        this[key] = null;
        try {
          await work();
        } catch (err) {
          logger.error(`Periodic ${key} failed (${err.message})`);
        } finally {
          if (!this.stopped) {
            loop(key, period, work);
          }
        }
      }, period);
      this[key].unref?.();
    };
    loop('refreshTimer', this.timings.refreshMs, () => this.refresh({ minGap: 0.5 }));
    loop('energyTimer', this.timings.energyMs, () => this.refreshEnergy());
  }

  /** The core's onPoll: refreshes unless the timer did it recently. */
  async poll() {
    await this.refresh({ minGap: 0.9 });
  }

  // --- Refresh --------------------------------------------------------------------

  /**
   * Read every home and publish. Concurrent callers share the refresh in
   * progress. Errors are reported (connection status, one log line) and not
   * thrown.
   * @param {{ force?: boolean, minGap?: number }} [options] minGap: skip when
   *   the last refresh is younger than this share of the period
   */
  async refresh({ force = false, minGap = 0 } = {}) {
    if (!this.client) {
      return;
    }
    if (this.refreshing) {
      return this.refreshing;
    }
    const now = this.now();
    if (!force) {
      if (
        this.lastRefreshAt !== null &&
        now - this.lastRefreshAt < this.timings.refreshMs * minGap
      ) {
        logger.debug(`Refreshed ${now - this.lastRefreshAt} ms ago: skipped`);
        return;
      }
      if (now < this.pausedUntil || now < this.blockedUntil) {
        logger.debug('Refresh paused (rate limit or refused sign-in)');
        return;
      }
    }
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async doRefresh() {
    this.lastRefreshAt = this.now();
    try {
      await this.readAccount();
    } catch (err) {
      await this.reportFailure(err);
      return;
    }
    await this.reportSuccess();
    await this.publishDevices();
    await this.publishAllStates();
  }

  /** Read the homes, then the live state of each. Throws an IntuisError. */
  async readAccount() {
    const homes = parseHomes(await this.client.homesData());
    const states = new Map();
    for (const home of homes) {
      states.set(home.id, parseRoomStates(home, await this.client.homeStatus(home.id)));
    }
    this.homes = homes;
    this.states = states;
    this.rememberFeatures();
  }

  /** Remember the optional features each room has shown (structure never shrinks). */
  rememberFeatures() {
    let changed = false;
    for (const home of this.homes) {
      for (const room of home.rooms) {
        const state = this.states.get(home.id)?.get(room.id);
        if (!state) {
          continue;
        }
        const entry = this.roomData(home, room);
        for (const key of observedFeatures(state)) {
          if (!entry.known.includes(key)) {
            entry.known.push(key);
            changed = true;
          }
        }
      }
    }
    if (changed) {
      this.save();
    }
  }

  roomData(home, room) {
    const key = roomIds(this.gladys, home, room).device;
    this.data.rooms[key] ??= { known: [] };
    this.data.rooms[key].known ??= [];
    return this.data.rooms[key];
  }

  /** The optional features a room has, energy included when enabled. */
  knownFeatures(home, room) {
    const entry = this.roomData(home, room);
    const known = entry.known.filter((key) => OPTIONAL_ROOM_FEATURES.includes(key));
    if (this.config.energy && entry.energy?.scale === SCALES.THIRTY_MINUTES.key) {
      known.push(ROOM_FEATURES.ENERGY);
    }
    if (this.config.energy && entry.energy?.scale === SCALES.DAY.key) {
      known.push(ROOM_FEATURES.ENERGY_DAILY);
    }
    return known;
  }

  async reportFailure(err) {
    const kind = err instanceof IntuisError ? err.kind : 'api';
    const message = err.message;
    this.lastFailure = kind;
    if (kind === 'credentials') {
      this.blockedUntil = this.now() + this.timings.credentialsRetryMs;
      this.issues.fail('cloud', `intuis sign-in refused (${message})`);
      await this.setStatus(false, STATUS.credentials);
    } else if (kind === 'rate_limited') {
      this.pausedUntil = this.now() + (err.retryAfterMs ?? this.timings.rateLimitPauseMs);
      this.issues.fail('cloud', `intuis rate limit reached: readings paused (${message})`);
      await this.setStatus(false, STATUS.rateLimited);
    } else {
      this.issues.fail('cloud', `intuis cloud unavailable (${message})`);
      await this.setStatus(false, STATUS.unreachable);
    }
    this.connected = false;
    await this.publishTransports(DEVICE_TRANSPORTS.UNREACHABLE);
  }

  async reportSuccess() {
    const rooms = this.homes.reduce((sum, home) => sum + home.rooms.length, 0);
    if (!this.connected) {
      if (!this.issues.isFailing('cloud')) {
        logger.info(`Connected to intuis: ${this.homes.length} home(s), ${rooms} room(s)`);
      }
      this.issues.ok(
        'cloud',
        `intuis cloud answers again: ${this.homes.length} home(s), ${rooms} room(s)`,
      );
    }
    this.connected = true;
    if (this.homes.length === 0) {
      await this.setStatus(false, STATUS.noHome);
    }
  }

  async setStatus(connected, message) {
    const key = connected ? 'ok' : JSON.stringify(message);
    if (this.lastStatus === key) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(connected, message);
      this.lastStatus = key;
    } catch (err) {
      logger.debug(`Connection status not sent (${err.message})`);
    }
  }

  /** The devices of every home, for the Discovery screen. */
  buildDevices() {
    const devices = [];
    for (const home of this.homes) {
      devices.push(buildHomeDevice(this.gladys, home, { language: this.language }));
      for (const room of home.rooms) {
        devices.push(
          buildRoomDevice(this.gladys, home, room, {
            language: this.language,
            known: this.knownFeatures(home, room),
          }),
        );
      }
    }
    return devices;
  }

  /** Publish the devices when the list changed (or when asked by a scan). */
  async publishDevices({ force = false } = {}) {
    const devices = this.buildDevices();
    const signature = JSON.stringify(devices);
    if (!force && signature === this.published) {
      if (this.homes.length > 0) {
        await this.setStatus(true);
      }
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = signature;
      this.issues.ok('publish', 'Gladys accepted the devices again');
      if (this.homes.length > 0) {
        await this.setStatus(true);
      }
    } catch (err) {
      this.issues.fail('publish', `Publishing the devices failed (${err.message})`, 'error');
      await this.setStatus(false, STATUS.publishFailed);
    }
  }

  /** External ids of the devices the user added to Gladys. */
  createdDevices() {
    return new Map((this.gladys.devices ?? []).map((device) => [device.external_id, device]));
  }

  /** Every state of the added devices, deduplicated by the SDK. */
  async publishAllStates({ deviceExternalId } = {}) {
    const created = this.createdDevices();
    const states = [];
    const transports = [];
    for (const home of this.homes) {
      const homeDevice = homeIds(this.gladys, home).device;
      if (created.has(homeDevice) && (!deviceExternalId || deviceExternalId === homeDevice)) {
        states.push(...homeStates(this.gladys, home));
        transports.push({ external_id: homeDevice, transport: DEVICE_TRANSPORTS.CLOUD });
      }
      for (const room of home.rooms) {
        const device = roomIds(this.gladys, home, room).device;
        const state = this.states.get(home.id)?.get(room.id);
        if (!state || !created.has(device) || (deviceExternalId && deviceExternalId !== device)) {
          continue;
        }
        states.push(...roomStates(this.gladys, home, room, state, this.knownFeatures(home, room)));
        transports.push({
          external_id: device,
          transport:
            state.reachable === false ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD,
        });
      }
    }
    try {
      const { count } = await this.gladys.publishChangedStates(states, {
        heartbeat: this.timings.heartbeatMs,
      });
      logger.debug(`${count} state(s) published`);
      this.issues.ok('states', 'Gladys accepts the states again');
    } catch (err) {
      this.issues.fail('states', `Publishing the states failed (${err.message})`);
    }
    await this.sendTransports(transports);
  }

  async publishTransports(transport) {
    const created = this.createdDevices();
    const entries = [];
    for (const home of this.homes) {
      for (const device of [
        homeIds(this.gladys, home).device,
        ...home.rooms.map((room) => roomIds(this.gladys, home, room).device),
      ]) {
        if (created.has(device)) {
          entries.push({ external_id: device, transport });
        }
      }
    }
    await this.sendTransports(entries);
  }

  async sendTransports(entries) {
    const signature = JSON.stringify(entries);
    if (entries.length === 0 || signature === this.lastTransports) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.lastTransports = signature;
    } catch (err) {
      logger.debug(`Transports not published (${err.message})`);
    }
  }

  /** A device was added (or updated) in Gladys: send its states now. */
  async deviceAdded(device) {
    await this.publishAllStates({ deviceExternalId: device.external_id });
    const located = this.locateRoom(device.external_id);
    if (located && this.config.energy) {
      await this.publishRoomEnergy(located.home, located.room).catch((err) =>
        logger.debug(`Energy of a new room not published (${err.message})`),
      );
    }
  }

  // --- Lookup ---------------------------------------------------------------------

  locateRoom(deviceExternalId) {
    for (const home of this.homes) {
      for (const room of home.rooms) {
        if (roomIds(this.gladys, home, room).device === deviceExternalId) {
          return { home, room, state: this.states.get(home.id)?.get(room.id) ?? null };
        }
      }
    }
    return null;
  }

  locateHome(deviceExternalId) {
    return (
      this.homes.find((home) => homeIds(this.gladys, home).device === deviceExternalId) ?? null
    );
  }

  /** A home from a widget setting: a home device, a room device, or the first home. */
  homeOf(deviceExternalId) {
    if (deviceExternalId) {
      const home = this.locateHome(deviceExternalId) ?? this.locateRoom(deviceExternalId)?.home;
      if (home) {
        return home;
      }
    }
    return this.homes[0] ?? null;
  }

  // --- Commands -------------------------------------------------------------------

  /** Minutes a setpoint holds: the configured duration, or the app's own. */
  async holdMinutes(home) {
    if (this.config.manual_duration !== 'default') {
      return manualMinutes(this.config);
    }
    if (!this.accountMinutes.has(home.id)) {
      try {
        this.accountMinutes.set(
          home.id,
          defaultManualMinutes(await this.client.homeConfigs(home.id)),
        );
      } catch (err) {
        logger.debug(`Default manual duration unavailable (${err.message})`);
        this.accountMinutes.set(home.id, null);
      }
    }
    return manualMinutes(this.config, this.accountMinutes.get(home.id));
  }

  fail(message) {
    const error = new Error(pick(message, this.language));
    error.userMessage = message;
    return error;
  }

  async ensureFresh() {
    if (this.homes.length === 0) {
      await this.refresh({ force: true });
    }
    if (!this.connected && this.homes.length === 0) {
      throw this.fail(STATUS.unreachable);
    }
  }

  /**
   * Hold a setpoint in a room.
   * @returns {Promise<{ until: number }>} end of the hold, in seconds
   */
  async setRoomSetpoint(home, room, value, minutes) {
    const temperature = Number(value);
    if (!Number.isFinite(temperature) || temperature < SETPOINT.MIN || temperature > SETPOINT.MAX) {
      throw this.fail(MESSAGES.invalidTemperature);
    }
    const rounded = Math.round(temperature / SETPOINT.STEP) * SETPOINT.STEP;
    const holdFor = minutes ?? (await this.holdMinutes(home));
    const until = Math.floor(this.now() / 1000) + holdFor * 60;
    await this.client.setRoomState(
      home.id,
      room.id,
      {
        therm_setpoint_mode: 'manual',
        therm_setpoint_temperature: rounded,
        therm_setpoint_end_time: until,
      },
      home.timezone,
    );
    logger.info(`${room.name}: setpoint ${rounded} °C for ${holdFor} min`);
    this.rereadSoon();
    return { until };
  }

  async setRoomMode(home, room, state, value) {
    if (value === THERMOSTAT_MODE.AUTO) {
      await this.client.setRoomState(
        home.id,
        room.id,
        { therm_setpoint_mode: 'home' },
        home.timezone,
      );
      logger.info(`${room.name}: back to the schedule`);
      this.rereadSoon();
      return;
    }
    if (value === THERMOSTAT_MODE.HEATING) {
      // Manual: hold the current setpoint.
      const setpoint = state?.setpoint ?? 19;
      await this.setRoomSetpoint(
        home,
        room,
        Math.min(Math.max(setpoint, SETPOINT.MIN), SETPOINT.MAX),
      );
      return;
    }
    if (value === THERMOSTAT_MODE.OFF) {
      throw this.fail(MESSAGES.offRefused);
    }
    throw this.fail(MESSAGES.unknownValue);
  }

  async setRoomPreset(home, room, value) {
    const mode = PRESET_TO_ROOM_MODE[value];
    if (!mode) {
      throw this.fail(MESSAGES.unknownValue);
    }
    await this.client.setRoomState(home.id, room.id, { therm_setpoint_mode: mode }, home.timezone);
    logger.info(`${room.name}: preset ${mode}`);
    this.rereadSoon();
  }

  async setHomeMode(home, value) {
    const mode = PRESET_TO_HOME_MODE[value];
    if (!mode) {
      throw this.fail(MESSAGES.unknownValue);
    }
    await this.client.setHomeMode(home.id, mode);
    logger.info(`${home.name}: home mode ${mode}`);
    // The widget re-pulls as soon as its action resolves: re-read now (the
    // home mode is applied by the cloud), and again once the rooms follow.
    await this.refresh({ force: true });
    this.rereadSoon();
    return pick(MESSAGES.homeMode, this.language)(pick(PRESET_NAMES, this.language)[value]);
  }

  /** Gladys asks to change a feature (device box, scene, voice). */
  async setValue(device, feature, value) {
    await this.ensureFresh();
    const numeric = Number(value);
    const featureId = feature.external_id;
    const home = this.locateHome(device.external_id);
    if (home) {
      if (featureId === homeIds(this.gladys, home).feature(HOME_FEATURES.MODE)) {
        await this.setHomeMode(home, numeric);
        return;
      }
      throw this.fail(MESSAGES.unknownValue);
    }
    const located = this.locateRoom(device.external_id);
    if (!located) {
      throw this.fail(MESSAGES.unknownRoom);
    }
    const ids = roomIds(this.gladys, located.home, located.room);
    switch (featureId) {
      case ids.feature(ROOM_FEATURES.SETPOINT):
        await this.setRoomSetpoint(located.home, located.room, numeric);
        return;
      case ids.feature(ROOM_FEATURES.MODE):
        await this.setRoomMode(located.home, located.room, located.state, numeric);
        return;
      case ids.feature(ROOM_FEATURES.PRESET):
        await this.setRoomPreset(located.home, located.room, numeric);
        return;
      default:
        throw this.fail(MESSAGES.unknownValue);
    }
  }

  /** Re-read the homes shortly after a command, so Gladys shows its effect. */
  rereadSoon() {
    clearTimeout(this.rereadTimer);
    this.rereadTimer = setTimeout(() => {
      this.rereadTimer = null;
      this.refresh({ force: true }).catch(() => {});
    }, this.timings.rereadDelayMs);
    this.rereadTimer.unref?.();
  }

  // --- Energy ---------------------------------------------------------------------
  //
  // intuis measures the energy of each room (not every radiator model does: a
  // pilot-wire radiator may report nothing). It is published after the fact
  // with publishEnergyConsumption: 30-minute slots when the account has them
  // (enough for peak / off-peak pricing), daily totals otherwise. Only
  // elapsed intervals are published; the last day is published again every
  // hour, the core upserts and writes nothing for an unchanged value.

  /** Find which scale a room reports, once (again a week later if none). */
  async probeEnergy(home, room) {
    const entry = this.roomData(home, room);
    const probedAt = entry.energy?.probedAt ?? 0;
    if (entry.energy?.scale && entry.energy.scale !== 'none') {
      return entry.energy.scale;
    }
    if (entry.energy?.scale === 'none' && this.now() - probedAt < this.timings.energyProbeRetryMs) {
      return 'none';
    }
    const end = Math.floor(this.now() / 1000);
    for (const [scale, span] of [
      [SCALES.THIRTY_MINUTES, 2 * DAY],
      [SCALES.DAY, 7 * DAY],
    ]) {
      const body = await this.client.roomMeasure({
        homeId: home.id,
        roomId: room.id,
        scale: scale.key,
        begin: end - span,
        end,
      });
      if (parseMeasures(body, scale).length > 0) {
        entry.energy = { scale: scale.key, probedAt: this.now() };
        this.save();
        return scale.key;
      }
    }
    entry.energy = { scale: 'none', probedAt: this.now() };
    this.save();
    return 'none';
  }

  /** Probe the rooms, publish the new energy features, feed the added ones. */
  async refreshEnergy() {
    if (!this.config.energy || !this.connected || this.now() < this.pausedUntil) {
      return;
    }
    this.lastEnergyAt = this.now();
    let structureChanged = false;
    let failure = null;
    for (const home of this.homes) {
      for (const room of home.rooms) {
        if (this.now() < this.pausedUntil) {
          break;
        }
        // One room failing (a radiator without meter, a 404) does not stop the others.
        try {
          const before = this.roomData(home, room).energy?.scale;
          const scale = await this.probeEnergy(home, room);
          structureChanged ||= scale !== before && scale !== 'none';
          await this.publishRoomEnergy(home, room);
        } catch (err) {
          failure ??= err;
          if (err instanceof IntuisError && err.kind === 'rate_limited') {
            this.pausedUntil = this.now() + (err.retryAfterMs ?? this.timings.rateLimitPauseMs);
          }
        }
      }
    }
    if (failure) {
      this.issues.fail('energy', `Energy reading failed (${failure.message})`);
    } else {
      this.issues.ok('energy', 'Energy readings work again');
    }
    if (structureChanged) {
      await this.publishDevices();
    }
  }

  /** Feed the consumption feature of one added room. */
  async publishRoomEnergy(home, room) {
    const entry = this.roomData(home, room);
    const scaleKey = entry.energy?.scale;
    const ids = roomIds(this.gladys, home, room);
    const featureKey =
      scaleKey === SCALES.THIRTY_MINUTES.key
        ? ROOM_FEATURES.ENERGY
        : scaleKey === SCALES.DAY.key
          ? ROOM_FEATURES.ENERGY_DAILY
          : null;
    if (!featureKey) {
      return;
    }
    const featureId = ids.feature(featureKey);
    const device = this.createdDevices().get(ids.device);
    if (!device || !(device.features ?? []).some((feature) => feature.external_id === featureId)) {
      // Not added yet, or added before the energy was found: "Update" in Discovery.
      return;
    }
    const scale = scaleKey === SCALES.THIRTY_MINUTES.key ? SCALES.THIRTY_MINUTES : SCALES.DAY;
    const end = Math.floor(this.now() / 1000);
    // First time: a week of history; then the last day, which intuis completes late.
    const span = entry.energy.publishedUntil
      ? scale === SCALES.DAY
        ? 3 * DAY
        : DAY + HOUR
      : 7 * DAY;
    const body = await this.client.roomMeasure({
      homeId: home.id,
      roomId: room.id,
      scale: scale.key,
      begin: end - span,
      end,
    });
    const measures = parseMeasures(body, scale);
    const intervals = this.toIntervals(measures, scale, home.timezone, end);
    if (intervals.length === 0) {
      return;
    }
    const { count } = await this.gladys.publishEnergyConsumption(featureId, intervals);
    logger.debug(`${room.name}: ${intervals.length} energy interval(s) sent, ${count} stored`);
    entry.energy.publishedUntil = end;
    this.save();
  }

  /** Elapsed intervals in the shape of publishEnergyConsumption. */
  toIntervals(measures, scale, timeZone, nowSeconds) {
    if (scale === SCALES.THIRTY_MINUTES) {
      return measures
        .filter(({ start }) => start + scale.seconds <= nowSeconds)
        .slice(-2000)
        .map(({ start, wh }) => ({
          starts_at: new Date(start * 1000).toISOString(),
          kwh: Math.round(wh) / 1000,
        }));
    }
    // Days: the date where intuis put the reading; today is not over.
    const today = localDate(nowSeconds, process.env.TZ || timeZone);
    const byDate = new Map();
    for (const { start, wh } of measures) {
      const date = localDate(start, timeZone || process.env.TZ);
      byDate.set(date, (byDate.get(date) ?? 0) + wh);
    }
    return [...byDate.entries()]
      .filter(([date]) => date < today)
      .map(([date, wh]) => ({ date, kwh: Math.round(wh) / 1000 }));
  }

  // --- Configuration screen action ---------------------------------------------

  /** "Test the connection": sign in, read the homes, say what was found. */
  async testConnection() {
    if (!this.client) {
      return STATUS.notConfigured;
    }
    // A user gesture lifts the pause of a refused password.
    this.blockedUntil = 0;
    await this.refresh({ force: true });
    if (!this.connected) {
      return (
        { credentials: STATUS.credentials, rate_limited: STATUS.rateLimited }[this.lastFailure] ??
        STATUS.unreachable
      );
    }
    if (this.homes.length === 0) {
      return STATUS.noHome;
    }
    const rooms = this.homes.reduce((sum, home) => sum + home.rooms.length, 0);
    return Object.fromEntries(
      Object.entries(MESSAGES.connected).map(([language, render]) => [
        language,
        render(this.homes.length, rooms),
      ]),
    );
  }
}

export { DEVICE_TYPES };
