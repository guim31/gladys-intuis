# Muller Intuitiv (intuis) for Gladys Assistant

External [Gladys Assistant](https://gladysassistant.com) integration for **Muller Intuitiv
connected radiators** (Muller, Campa, Airelec, Applimo, Noirot radiators with the connected module),
through the **intuis Connect** cloud — the app formerly called "Muller Intuitiv with Netatmo". Its
API is derived from Netatmo Energy's.

> **Developed without the hardware: feedback welcome.** Neither the radiators nor an intuis account
> were available to write it: the cloud exchanges follow the community projects credited below, and
> the tests run against their published answers. Please report what works and what does not, on
> the Gladys forum or in the issues.

## Features

| Device                  | Features                                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home** (one per home) | Home mode (schedule / away / frost protection, settable), active weekly schedule (read only)                                                                                                                                                               |
| **Room** (one per room) | Measured temperature, setpoint (7-30 °C by half a degree, held for a configurable duration), mode (schedule or manual), heating preset (schedule / away / frost protection), heating in progress, open window, presence, consumption (30 minutes or daily) |

The optional room features (heating, open window, presence, consumption) only appear when the
radiators report them. The rooms use the **thermostat** category of Gladys 5.2 (setpoint, mode,
preset, operating state); the consumption feeds the **energy monitoring** of Gladys through
`publishEnergyConsumption`, so the rooms can be priced by the user's contract (peak / off-peak
included, from the half-hour readings).

Also:

- a **Heating rooms** dashboard widget: every room on one line (temperature → setpoint, mode,
  window) and the home mode in one tap;
- a **Set a room setpoint for a while** scene action (temperature and duration, then back to the
  schedule);
- a **Test the connection** button in the Configuration screen;
- everything visible in English, French, German and Spanish (French by default).

Turning a room completely off is deliberately not offered from Gladys: frost protection is the safe
stop, turning off stays in the intuis app.

## Requirements

- Gladys Assistant **5.2.0** or later (thermostat preset type, dated energy consumption, widgets and
  scene actions).
- Radiators set up in the intuis Connect app, with the gateway online.
- The e-mail and the password of the intuis Connect account.

## Installation

1. In Gladys, open **Integrations**. Find **Muller Intuitiv (intuis)** in the catalog, or use
   **Integrations → Install from GitHub** with `https://github.com/guim31/gladys-intuis`.
2. In the **Configuration** tab, enter the e-mail and the password of the intuis Connect app and
   save. **Test the connection** says how many homes and rooms were found.
3. Open the **Discovery** tab and add the home and the rooms.

The user guide is in [`docs/en.md`](docs/en.md) ([français](docs/fr.md), [Deutsch](docs/de.md),
[español](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

```
Integration container ──HTTPS──▶ app.muller-intuitiv.net (fallback app-prod.intuis-sas.com)
   POST /oauth2/token              password grant of the intuis app, then refresh tokens
   GET  /api/homesdata             homes, rooms, modules, schedules, home mode   ┐ every 5 min
   POST /syncapi/v1/homestatus     temperatures, setpoints, modes, window...      ┘ + after a command
   POST /syncapi/v1/setstate       room setpoint / mode
   POST /api/setthermmode          home mode
   POST /api/getroommeasure        room consumption, once an hour
```

- **Refresh.** The container refreshes by itself every 5 minutes (devices are published with
  `should_poll: false`): the core cannot poll slower than once a minute, and does not reliably poll
  external devices (GladysAssistant/Gladys#3198). `onPoll` stays as a fallback.
- **Quota.** intuis publishes none; Netatmo documents 500 requests per hour and per user. The
  integration makes about 30 per hour for one home (plus one per room reporting consumption), pauses
  15 minutes on a `429`, and waits 30 minutes after a refused password so it never locks the account.
- **States.** Only changes are published (SDK deduplication), with a 6-hour heartbeat. A device just
  added gets its states at once.
- **Secrets.** The password stays in the Gladys configuration and only goes to the token endpoint.
  `/data/intuis-state.json` (mode `600`) keeps the access and refresh tokens, the account
  fingerprint (a hash, not the e-mail), and what the energy reading learned. Nothing secret is ever
  logged.
- **Footprint.** No dependency beside the Gladys SDK; Node's built-in `fetch`.

## Limitations

- **Developed without the hardware nor an account** (see above).
- Cloud only: no local API is known for the intuis gateway.
- The weekly schedules are edited in the app; the active one is shown, not switched.
- No "boost" and no complete stop of a room from Gladys.
- The consumption depends on the radiator model (pilot-wire models may report none) and arrives up to
  a day late. The 30-minute scale is tried first, then the daily one.
- Feature names are fixed when a device is added (a Gladys rule): changing the language only renames
  the devices added afterwards.

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: fake Gladys (SDK) + fake intuis cloud
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
```

```
index.js                SDK wiring (src/app.js registers the handlers)
src/app.js              handlers: discovery, commands, poll fallback, action, scene, widget
src/hub.js              sign-in, 5-minute refresh, states, commands, energy
src/devices.js          homes and rooms -> Gladys devices and states
src/intuis/client.js    HTTP client of the intuis cloud (OAuth2, endpoints, errors)
src/intuis/model.js     reading the answers: homes, room states, modes, energy rows
src/widgets.js          "Heating rooms" dashboard widget
src/scenes.js           "Set a room setpoint for a while" scene action
src/store.js            /data/intuis-state.json
scripts/probe.mjs       read-only check against the real cloud (see below)
test/fixtures/intuis/   cloud answers, anonymized
```

`test/gladys-rules.test.js` checks every discovered device against the category/type table
extracted from the Gladys core.

`scripts/probe.mjs` runs the real client against the real cloud, read only, and prints a summary
without any identifier, token or e-mail:

```bash
node scripts/probe.mjs                       # fake account: the sign-in must be refused cleanly
INTUIS_USERNAME=... INTUIS_PASSWORD=... node scripts/probe.mjs   # a real account: read only
```

Releases are made by the **Release** workflow (Actions → Release); never edit the versions by hand.
See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [antoine-pyre/intuis-connect](https://github.com/antoine-pyre/intuis-connect) by Antoine Pyré and
  contributors (MIT): the endpoints, the two clusters, the room energy request
  (`getroommeasure`, form-encoded, every tariff column) and the real daily measure used in
  `test/fixtures/intuis/roommeasure_1day.json`; its documentation of the module types and fields
  shaped the fixtures.
- [alexisthiant/intuis-connect](https://github.com/alexisthiant/intuis-connect) (MIT): the home mode
  through `setthermmode`, the default manual duration from `getconfigs`.
- [jabesq-org/pyatmo](https://github.com/jabesq-org/pyatmo) (MIT): how Netatmo stamps measures in the
  middle of their interval and lays out the tariff columns.
- The [Node-RED flow](https://flows.nodered.org/flow/3d7f77cef8a7c6aa4fc33e2dbf26f15e) by Yann V and
  the Jeedom plugin [mullerintuitiv](https://github.com/shun84/jeedom-plugin-mullerintuitiv) (GPL,
  read only to understand the protocol, no code reused).
- The [Netatmo Energy API documentation](https://dev.netatmo.com/apidocumentation/energy), the base
  of the intuis API.

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Muller, Groupe Atlantic or intuis.
"Muller Intuitiv", "intuis" and the radiator brands belong to their owners.

## License

[Apache-2.0](LICENSE)
