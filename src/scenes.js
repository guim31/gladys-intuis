// -----------------------------------------------------------------------------
// Scene action (manifest `scene_actions`, Gladys 5.1+): `set_room_setpoint`.
//
// A scene can already write the setpoint feature of a room; this action adds
// what the feature cannot carry: how long the setpoint holds ("21 °C in the
// bathroom for 1 hour, then back to the programme"). The temperature is a
// text field, so a scene variable fits in it, with a comma or a dot.
// -----------------------------------------------------------------------------

import { MANUAL_DURATIONS } from './config.js';
import { MESSAGES } from './i18n.js';

export const SCENE_ACTION_KEYS = { SET_ROOM_SETPOINT: 'set_room_setpoint' };

/** "19,5", "19.5 °C" -> 19.5; NaN when it is not a temperature. */
export function parseTemperature(value) {
  if (typeof value === 'number') {
    return value;
  }
  const match = String(value ?? '')
    .trim()
    .replace(',', '.')
    .match(/^-?\d+(\.\d+)?/);
  return match ? Number(match[0]) : Number.NaN;
}

/**
 * The scene action handlers, by key.
 * @param {import('./hub.js').IntuisHub} hub
 */
export function sceneActions(hub) {
  return {
    [SCENE_ACTION_KEYS.SET_ROOM_SETPOINT]: async (fields) => {
      await hub.ensureFresh();
      const located = hub.locateRoom(fields.room);
      if (!located) {
        throw hub.fail(MESSAGES.unknownRoom);
      }
      const duration = String(fields.duration ?? 'default');
      const minutes =
        duration !== 'default' && MANUAL_DURATIONS.includes(duration)
          ? Number(duration)
          : undefined;
      const { until } = await hub.setRoomSetpoint(
        located.home,
        located.room,
        parseTemperature(fields.temperature),
        minutes,
      );
      return { until: new Date(until * 1000).toISOString() };
    },
  };
}
