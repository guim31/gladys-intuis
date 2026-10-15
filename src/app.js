// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { IntuisHub } from './hub.js';
import { STATUS } from './i18n.js';
import { sceneActions } from './scenes.js';
import { Store } from './store.js';
import {
  HOME_MODE_ACTIONS,
  TEXT,
  WIDGET_KEY,
  buildRoomsContent,
  messageContent,
} from './widgets.js';
import { createIssueLog } from './issues.js';

const logger = createLogger({ name: 'intuis-app' });

// Keys of the manifest `actions` (Configuration screen).
export const ACTION_KEYS = { TEST_CONNECTION: 'test_connection' };

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: store, fetch, timers, timings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new IntuisHub({
    gladys,
    store: options.store ?? new Store(),
    fetch: options.fetch,
    timers: options.timers ?? true,
    timings: options.timings,
    now: options.now,
  });
  const widgetIssues = createIssueLog(logger);

  // --- Discovery: the user opens the Discovery tab or clicks "Search" ---------
  gladys.onScanRequest(async () => {
    logger.debug('Scan requested');
    await hub.refresh({ force: true });
    await hub.publishDevices({ force: true });
  });

  // --- Commands ------------------------------------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    await hub.setValue(device, feature, value);
  });

  // --- Polling: the container's timer does the work; this is the fallback -----
  gladys.onPoll(async () => {
    await hub.poll();
  });

  // A device just added (or updated): its states now, then the widget.
  const deviceAdded = async (device) => {
    await hub.deviceAdded(device);
    gladys.requestWidgetRefresh(WIDGET_KEY);
  };
  gladys.onDeviceCreated(deviceAdded);
  gladys.onDeviceUpdated(deviceAdded);

  // --- Configuration screen action -------------------------------------------
  gladys.onAction(ACTION_KEYS.TEST_CONNECTION, async () => {
    logger.info('Connection test requested');
    return hub.testConnection();
  });

  // --- Scene action ------------------------------------------------------------
  for (const [key, handler] of Object.entries(sceneActions(hub))) {
    gladys.onSceneAction(key, handler);
  }

  // --- Dashboard widget ------------------------------------------------------------
  gladys.onWidgetGet(WIDGET_KEY, async ({ settings, language }) => {
    if (!hub.client) {
      return messageContent(TEXT.notConfigured, language);
    }
    if (hub.homes.length === 0) {
      await hub.refresh();
    }
    const home = hub.homeOf(settings?.home);
    if (!home) {
      widgetIssues.fail('rooms', 'rooms widget: no data from the intuis cloud');
      return messageContent(TEXT.unreachable, language);
    }
    widgetIssues.ok('rooms', 'rooms widget: intuis data available again');
    return buildRoomsContent(home, hub.states.get(home.id), language);
  });

  gladys.onWidgetAction(WIDGET_KEY, async (actionKey, _params, { settings }) => {
    const preset = HOME_MODE_ACTIONS[actionKey];
    if (preset === undefined) {
      throw new Error(`Unknown widget action ${actionKey}`);
    }
    await hub.ensureFresh();
    const home = hub.homeOf(settings?.home);
    if (!home) {
      return TEXT.unreachable;
    }
    return hub.setHomeMode(home, preset);
  });

  // --- Configuration and lifecycle ---------------------------------------------
  gladys.onConfigUpdated(async (config) => {
    logger.info('Configuration updated');
    await hub.start(config);
  });

  const ready = new Promise((resolve) => {
    gladys.on('connected', async () => {
      try {
        await hub.start(await gladys.getConfig());
      } catch (err) {
        logger.error(`Post-connection initialization failed (${err.message})`);
        await gladys.setConnectionStatus(false, STATUS.initFailed).catch(() => {});
      } finally {
        resolve();
      }
    });
  });

  return { hub, ready, stop: () => hub.stop() };
}
