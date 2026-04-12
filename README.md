# signalk-garmin-race-timer-plugin

Signal K server plugin that decodes Garmin Race Timer broadcasts from NMEA 2000 (PGN 126720, manufacturer code 229) and publishes them as Signal K racing data.

> **Note:** This plugin is read-only. It decodes race timer data broadcast by a physical Garmin race timer device over NMEA 2000. The device operator must start and control the race countdown on the hardware — this plugin cannot initiate or modify the timer.

## Signal K Paths

| Path | Type | Units | Description |
|---|---|---|---|
| `navigation.racing.timeToStart` | number | s | Countdown time remaining. 0 after race start. |
| `navigation.racing.elapsedTime` | number \| `null` | s | Elapsed race time since start. `null` during countdown. |
| `navigation.racing.startTime` | string \| `null` | ISO 8601 | Predicted start time during countdown, locked to actual time after start. |
| `navigation.racing.finishTime` | string \| `null` | ISO 8601 | Captured when timer is stopped during race. Cleared if race resumes. |
| `navigation.racing.status` | string | - | `countdown`, `racing`, `countdownPaused`, `raceFinished` |

## Notifications

| Path | Trigger | Cleared when |
|---|---|---|
| `notifications.navigation.racing.raceStart` | Countdown-to-race transition (race begins) | Race finishes or new countdown starts |
| `notifications.navigation.racing.raceFinish` | Race-to-finished transition (timer stopped during race). Includes elapsed time in message. | Race resumes or new countdown starts |

## NMEA 2000 Data

The plugin registers a custom canboatjs definition for **PGN 126720** (Garmin proprietary, manufacturer code 229). It listens for 39-byte "data exchange" messages (command byte `0xFE`) with message type `0x0002` (timer data), broadcast at 1 Hz by the race timer device.

Relevant fields extracted from each message:

| Field | Bits | Description |
|---|---|---|
| Command | 8 | `0xFE` — data exchange (filtered; heartbeat `0xE7` and others are ignored) |
| Message Type | 16 | `0x0002` — timer data (filtered; keepalive `0x0007` and others are ignored) |
| Timer Data Type | 8 | `0x05` — time data |
| Timer Value | 32 | Milliseconds — countdown remaining or elapsed race time, depending on status |
| Timer Status | 8 | `0` = race running, `1` = countdown running, `2` = race paused (finished), `3` = countdown paused |

The full field layout is defined in [`src/pgns.js`](src/pgns.js).

## REST API

`GET /plugins/signalk-garmin-race-timer/state` returns the current timer state as JSON.

## Development

```bash
npm run build    # compile TypeScript
npm run watch    # compile on change
npm test         # run tests
```

## Disclaimer

This project is not affiliated with, endorsed by, or associated with Garmin or its subsidiaries. "Garmin" is a registered trademark of Garmin. This plugin is an independent, unofficial project provided for demonstration purposes only. Use at your own risk.

## License

Apache-2.0
