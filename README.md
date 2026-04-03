# signalk-garmin-race-timer

Signal K server plugin that decodes Garmin Race Timer broadcasts from NMEA 2000 (PGN 126720, manufacturer code 229) and publishes them as Signal K racing data.

## SignalK Paths

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

## REST API

`GET /plugins/signalk-garmin-race-timer/state` returns the current timer state as JSON.

## Installation

```bash
# From the plugin directory
npm install && npm run build
npm link

# In your Signal K server config directory (~/.signalk/)
npm link signalk-garmin-race-timer
```

Then enable the plugin in the Signal K admin UI under Server > Plugin Config.

## Development

```bash
npm run build    # compile TypeScript
npm run watch    # compile on change
npm test         # run tests
```

## License

Apache-2.0
