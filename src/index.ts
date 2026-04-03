import createDebugFn from 'debug'

const pgnDefinitions = require('./pgns')

const PLUGIN_ID = 'signalk-garmin-race-timer'
const debug = createDebugFn(PLUGIN_ID)
const debugN2k = createDebugFn(`${PLUGIN_ID}:n2k`)

// Garmin timer status codes
const STATUS_RACE_RUNNING = 0
const STATUS_COUNTDOWN_RUNNING = 1
const STATUS_RACE_PAUSED = 2
const STATUS_COUNTDOWN_PAUSED = 3

const STATUS_NAMES: Record<number, string> = {
  [STATUS_RACE_RUNNING]: 'racing',
  [STATUS_COUNTDOWN_RUNNING]: 'countdown',
  [STATUS_RACE_PAUSED]: 'raceFinished',
  [STATUS_COUNTDOWN_PAUSED]: 'countdownPaused'
}

function isCountdown(status: number): boolean {
  return status === STATUS_COUNTDOWN_RUNNING || status === STATUS_COUNTDOWN_PAUSED
}

export default function (app: any) {
  let lastStatus: number | null = null
  let lockedStartTime: string | null = null
  let lockedFinishTime: string | null = null
  let lastCountdownPausedValueMs: number | null = null
  let raceStartNotificationActive = false
  let raceFinishNotificationActive = false
  let n2kHandler: ((pgnData: any) => void) | null = null
  let currentState: TimerState = {
    timeToStart: null,
    elapsedTime: null,
    startTime: null,
    finishTime: null,
    status: null,
    lastUpdate: null
  }

  function publishMeta() {
    app.handleMessage(PLUGIN_ID, {
      updates: [{
        meta: [
          {
            path: 'navigation.racing.timeToStart',
            value: {
              description: 'Time left before race start (countdown). 0 after start.',
              units: 's'
            }
          },
          {
            path: 'navigation.racing.elapsedTime',
            value: {
              description: 'Elapsed race time since start',
              units: 's'
            }
          },
          {
            path: 'navigation.racing.startTime',
            value: {
              description: 'Race start time. Predicted during countdown, actual after start.'
            }
          },
          {
            path: 'navigation.racing.finishTime',
            value: {
              description: 'Time when race timer was stopped after start (finish time)'
            }
          },
          {
            path: 'navigation.racing.status',
            value: {
              description: 'Race timer status: countdown, racing, countdownPaused, raceFinished'
            }
          }
        ]
      }]
    })
    debug('Published path metadata')
  }

  function handleParsedPgn(pgnData: any) {
    if (pgnData.pgn !== 126720) return

    const f = pgnData.fields
    debugN2k('PGN 126720 received: %j', f)

    if (!f) {
      debugN2k('Skipping: no fields')
      return
    }

    // Filter for Garmin timer data messages
    if (f['Sub-command'] !== 254) {
      debugN2k('Skipping: Sub-command=%d (want 254)', f['Sub-command'])
      return
    }
    if (f['Message Type'] !== 2) {
      debugN2k('Skipping: Message Type=%d (want 2)', f['Message Type'])
      return
    }
    if (f['Timer Data Type'] !== 5) {
      debugN2k('Skipping: Timer Data Type=%d (want 5)', f['Timer Data Type'])
      return
    }

    const timerValueMs: number = f['Timer Value']
    const timerStatus: number = f['Timer Status']

    if (timerValueMs === undefined || timerStatus === undefined) {
      debugN2k('Skipping: Timer Value or Timer Status missing')
      return
    }

    const statusName = STATUS_NAMES[timerStatus]
    if (!statusName) {
      debug('Unknown timer status: %d', timerStatus)
      return
    }

    const timeSeconds = timerValueMs / 1000
    const now = Date.now()
    const values: Array<{ path: string; value: any }> = []

    if (isCountdown(timerStatus)) {
      // Countdown mode: timerValue is time until start — reset previous race state
      lockedStartTime = null
      lockedFinishTime = null
      clearNotification('raceStart')
      clearNotification('raceFinish')

      // Detect countdown reset: time increases while status stays countdownPaused
      const isReset = timerStatus === STATUS_COUNTDOWN_PAUSED &&
        lastCountdownPausedValueMs !== null &&
        timerValueMs > lastCountdownPausedValueMs
      if (isReset) {
        debug('Countdown reset detected: %dms → %dms', lastCountdownPausedValueMs, timerValueMs)
      }

      if (timerStatus === STATUS_COUNTDOWN_PAUSED) {
        lastCountdownPausedValueMs = timerValueMs
      } else {
        lastCountdownPausedValueMs = null
      }

      values.push(
        { path: 'navigation.racing.timeToStart', value: timeSeconds },
        { path: 'navigation.racing.elapsedTime', value: null },
        { path: 'navigation.racing.status', value: statusName },
        {
          path: 'navigation.racing.startTime',
          value: isReset ? null : new Date(now + timerValueMs).toISOString()
        },
        { path: 'navigation.racing.finishTime', value: null }
      )
    } else {
      // Race mode: timerValue is elapsed time since start

      // Detect countdown→race transition (race start)
      if (lastStatus !== null && isCountdown(lastStatus) && timerStatus === STATUS_RACE_RUNNING) {
        lockedStartTime = new Date(now - timerValueMs).toISOString()
        debug('Race started at %s', lockedStartTime)
        emitRaceStartNotification()
      }

      // Fallback if we missed the transition
      if (!lockedStartTime) {
        lockedStartTime = new Date(now - timerValueMs).toISOString()
      }

      // Detect race→raceFinished transition
      if (lastStatus === STATUS_RACE_RUNNING && timerStatus === STATUS_RACE_PAUSED) {
        lockedFinishTime = new Date(now).toISOString()
        debug('Race finished at %s (elapsed %ds)', lockedFinishTime, timeSeconds)
        clearNotification('raceStart')
        emitRaceFinishNotification(timeSeconds)
      }

      // Clear finishTime if race resumes
      if (lastStatus === STATUS_RACE_PAUSED && timerStatus === STATUS_RACE_RUNNING) {
        lockedFinishTime = null
        debug('Race resumed, clearing finishTime')
        clearNotification('raceFinish')
      }

      values.push(
        { path: 'navigation.racing.timeToStart', value: 0 },
        { path: 'navigation.racing.elapsedTime', value: timeSeconds },
        { path: 'navigation.racing.status', value: statusName },
        { path: 'navigation.racing.startTime', value: lockedStartTime },
        { path: 'navigation.racing.finishTime', value: lockedFinishTime }
      )
    }

    lastStatus = timerStatus
    currentState = {
      timeToStart: isCountdown(timerStatus) ? timeSeconds : 0,
      elapsedTime: isCountdown(timerStatus) ? null : timeSeconds,
      startTime: values.find(v => v.path === 'navigation.racing.startTime')!.value,
      finishTime: lockedFinishTime,
      status: statusName,
      lastUpdate: new Date(now).toISOString()
    }

    debug('Publishing: status=%s timerValue=%dms', statusName, timerValueMs)
    app.handleMessage(PLUGIN_ID, { updates: [{ values }] })
  }

  function clearNotification(name: 'raceStart' | 'raceFinish') {
    const flag = name === 'raceStart' ? raceStartNotificationActive : raceFinishNotificationActive
    if (!flag) return
    app.handleMessage(PLUGIN_ID, {
      updates: [{
        values: [{
          path: `notifications.navigation.racing.${name}`,
          value: { state: 'normal', method: [], message: '' }
        }]
      }]
    })
    if (name === 'raceStart') raceStartNotificationActive = false
    else raceFinishNotificationActive = false
  }

  function emitRaceStartNotification() {
    app.handleMessage(PLUGIN_ID, {
      updates: [{
        values: [{
          path: 'notifications.navigation.racing.raceStart',
          value: {
            state: 'alert',
            method: ['visual'],
            message: 'Race started!',
            timestamp: new Date().toISOString()
          }
        }]
      }]
    })
    raceStartNotificationActive = true
  }

  function emitRaceFinishNotification(elapsedSeconds: number) {
    const mins = Math.floor(elapsedSeconds / 60)
    const secs = Math.floor(elapsedSeconds % 60)
    app.handleMessage(PLUGIN_ID, {
      updates: [{
        values: [{
          path: 'notifications.navigation.racing.raceFinish',
          value: {
            state: 'alert',
            method: ['visual'],
            message: `Race finished! Elapsed time: ${mins}:${secs.toString().padStart(2, '0')}`,
            timestamp: new Date().toISOString()
          }
        }]
      }]
    })
    raceFinishNotificationActive = true
  }

  const plugin: Plugin = {
    start: function (_props: any) {
      lastStatus = null
      lockedStartTime = null
      lockedFinishTime = null
      lastCountdownPausedValueMs = null

      app.emitPropertyValue('canboat-custom-pgns', pgnDefinitions)
      debug('Registered Garmin Race Timer PGN definition')

      n2kHandler = handleParsedPgn
      app.on('N2KAnalyzerOut', n2kHandler)
      debug('Subscribed to N2KAnalyzerOut')

      publishMeta()
      debug('Plugin started')
    },

    stop: function () {
      if (n2kHandler) {
        app.off('N2KAnalyzerOut', n2kHandler)
        n2kHandler = null
      }
      lastStatus = null
      lockedStartTime = null
      lockedFinishTime = null
      lastCountdownPausedValueMs = null
      raceStartNotificationActive = false
      raceFinishNotificationActive = false
      currentState = {
        timeToStart: null,
        elapsedTime: null,
        startTime: null,
        finishTime: null,
        status: null,
        lastUpdate: null
      }
      debug('Plugin stopped')
    },

    registerWithRouter: function (router: any) {
      router.get('/state', (_req: any, res: any) => {
        res.json(currentState)
      })
    },

    id: PLUGIN_ID,
    name: 'Garmin Race Timer',
    description:
      'Converts Garmin Race Timer NMEA 2000 data to SignalK racing paths',
    schema: {
      type: 'object',
      properties: {}
    }
  }

  return plugin
}

interface TimerState {
  timeToStart: number | null
  elapsedTime: number | null
  startTime: string | null
  finishTime: string | null
  status: string | null
  lastUpdate: string | null
}

interface Plugin {
  start: (props: any) => void
  stop: () => void
  registerWithRouter: (router: any) => void
  id: string
  name: string
  description: string
  schema: any
}
