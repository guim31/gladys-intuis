# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Muller Intuitiv radiators through the intuis Connect cloud: sign in with the
  e-mail and the password of the intuis Connect app.
- One device per home: home mode (schedule, away, frost protection), settable
  from Gladys, and the name of the active weekly schedule.
- One device per room, in the thermostat category of Gladys 5.2: measured
  temperature, setpoint (7 to 30 °C, held for a configurable duration, then
  back to the schedule), mode (schedule or manual) and heating preset
  (schedule, away, frost protection); when the radiators report them, heating
  in progress, open window, presence and the consumption of the room, fed to
  the energy monitoring of Gladys (per half hour, or per day).
- A "Heating rooms" dashboard widget: every room at a glance and the home mode
  in one tap.
- A "Set a room setpoint for a while" scene action.
- A "Test the connection" button in the Configuration screen.
- The rooms and the home are refreshed every 5 minutes by the integration
  itself, and right after each command.
- English, French, German and Spanish everywhere, with the documentation in the
  four languages.
