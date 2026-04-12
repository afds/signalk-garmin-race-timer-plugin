"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const debug_1 = require("debug");
const pgnDefinitions = require('./pgns');
const PLUGIN_ID = 'signalk-garmin-race-timer';
const debug = (0, debug_1.default)(PLUGIN_ID);
const debugN2k = (0, debug_1.default)(`${PLUGIN_ID}:n2k`);
// Garmin timer status codes
const STATUS_RACE_RUNNING = 0;
const STATUS_COUNTDOWN_RUNNING = 1;
const STATUS_RACE_PAUSED = 2;
const STATUS_COUNTDOWN_PAUSED = 3;
const STATUS_NAMES = {
    [STATUS_RACE_RUNNING]: 'racing',
    [STATUS_COUNTDOWN_RUNNING]: 'countdown',
    [STATUS_RACE_PAUSED]: 'raceFinished',
    [STATUS_COUNTDOWN_PAUSED]: 'countdownPaused'
};
function isCountdown(status) {
    return status === STATUS_COUNTDOWN_RUNNING || status === STATUS_COUNTDOWN_PAUSED;
}
function default_1(app) {
    let lastStatus = null;
    let lockedStartTime = null;
    let lockedFinishTime = null;
    let lastCountdownPausedValueMs = null;
    let raceStartNotificationActive = false;
    let raceFinishNotificationActive = false;
    let n2kHandler = null;
    let currentState = {
        timeToStart: null,
        elapsedTime: null,
        startTime: null,
        finishTime: null,
        status: null,
        lastUpdate: null
    };
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
        });
        debug('Published path metadata');
    }
    function handleParsedPgn(pgnData) {
        if (pgnData.pgn !== 126720)
            return;
        const f = pgnData.fields;
        debugN2k('PGN 126720 received: %j', f);
        if (!f) {
            debugN2k('Skipping: no fields');
            return;
        }
        // Filter for Garmin timer data messages
        if (f['Sub-command'] !== 254) {
            debugN2k('Skipping: Sub-command=%d (want 254)', f['Sub-command']);
            return;
        }
        if (f['Message Type'] !== 2) {
            debugN2k('Skipping: Message Type=%d (want 2)', f['Message Type']);
            return;
        }
        if (f['Timer Data Type'] !== 5) {
            debugN2k('Skipping: Timer Data Type=%d (want 5)', f['Timer Data Type']);
            return;
        }
        const timerValueMs = f['Timer Value'];
        const timerStatus = f['Timer Status'];
        if (timerValueMs === undefined || timerStatus === undefined) {
            debugN2k('Skipping: Timer Value or Timer Status missing');
            return;
        }
        const statusName = STATUS_NAMES[timerStatus];
        if (!statusName) {
            debug('Unknown timer status: %d', timerStatus);
            return;
        }
        const timeSeconds = timerValueMs / 1000;
        const now = Date.now();
        const values = [];
        if (isCountdown(timerStatus)) {
            // Countdown mode: timerValue is time until start — reset previous race state
            lockedStartTime = null;
            lockedFinishTime = null;
            clearNotification('raceStart');
            clearNotification('raceFinish');
            // Detect countdown reset: time increases while status stays countdownPaused
            const isReset = timerStatus === STATUS_COUNTDOWN_PAUSED &&
                lastCountdownPausedValueMs !== null &&
                timerValueMs > lastCountdownPausedValueMs;
            if (isReset) {
                debug('Countdown reset detected: %dms → %dms', lastCountdownPausedValueMs, timerValueMs);
            }
            if (timerStatus === STATUS_COUNTDOWN_PAUSED) {
                lastCountdownPausedValueMs = timerValueMs;
            }
            else {
                lastCountdownPausedValueMs = null;
            }
            values.push({ path: 'navigation.racing.timeToStart', value: timeSeconds }, { path: 'navigation.racing.elapsedTime', value: null }, { path: 'navigation.racing.status', value: statusName }, {
                path: 'navigation.racing.startTime',
                value: isReset ? null : new Date(now + timerValueMs).toISOString()
            }, { path: 'navigation.racing.finishTime', value: null });
        }
        else {
            // Race mode: timerValue is elapsed time since start
            // Detect countdown→race transition (race start)
            if (lastStatus !== null && isCountdown(lastStatus) && timerStatus === STATUS_RACE_RUNNING) {
                lockedStartTime = new Date(now - timerValueMs).toISOString();
                debug('Race started at %s', lockedStartTime);
                emitRaceStartNotification();
            }
            // Fallback if we missed the transition
            if (!lockedStartTime) {
                lockedStartTime = new Date(now - timerValueMs).toISOString();
            }
            // Detect race→raceFinished transition
            if (lastStatus === STATUS_RACE_RUNNING && timerStatus === STATUS_RACE_PAUSED) {
                lockedFinishTime = new Date(now).toISOString();
                debug('Race finished at %s (elapsed %ds)', lockedFinishTime, timeSeconds);
                clearNotification('raceStart');
                emitRaceFinishNotification(timeSeconds);
            }
            // Clear finishTime if race resumes
            if (lastStatus === STATUS_RACE_PAUSED && timerStatus === STATUS_RACE_RUNNING) {
                lockedFinishTime = null;
                debug('Race resumed, clearing finishTime');
                clearNotification('raceFinish');
            }
            values.push({ path: 'navigation.racing.timeToStart', value: 0 }, { path: 'navigation.racing.elapsedTime', value: timeSeconds }, { path: 'navigation.racing.status', value: statusName }, { path: 'navigation.racing.startTime', value: lockedStartTime }, { path: 'navigation.racing.finishTime', value: lockedFinishTime });
        }
        lastStatus = timerStatus;
        currentState = {
            timeToStart: isCountdown(timerStatus) ? timeSeconds : 0,
            elapsedTime: isCountdown(timerStatus) ? null : timeSeconds,
            startTime: values.find(v => v.path === 'navigation.racing.startTime').value,
            finishTime: lockedFinishTime,
            status: statusName,
            lastUpdate: new Date(now).toISOString()
        };
        debug('Publishing: status=%s timerValue=%dms', statusName, timerValueMs);
        app.handleMessage(PLUGIN_ID, { updates: [{ values }] });
    }
    function clearNotification(name) {
        const flag = name === 'raceStart' ? raceStartNotificationActive : raceFinishNotificationActive;
        if (!flag)
            return;
        app.handleMessage(PLUGIN_ID, {
            updates: [{
                    values: [{
                            path: `notifications.navigation.racing.${name}`,
                            value: { state: 'normal', method: [], message: '' }
                        }]
                }]
        });
        if (name === 'raceStart')
            raceStartNotificationActive = false;
        else
            raceFinishNotificationActive = false;
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
        });
        raceStartNotificationActive = true;
    }
    function emitRaceFinishNotification(elapsedSeconds) {
        const mins = Math.floor(elapsedSeconds / 60);
        const secs = Math.floor(elapsedSeconds % 60);
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
        });
        raceFinishNotificationActive = true;
    }
    const plugin = {
        start: function (_props) {
            lastStatus = null;
            lockedStartTime = null;
            lockedFinishTime = null;
            lastCountdownPausedValueMs = null;
            app.emitPropertyValue('canboat-custom-pgns', pgnDefinitions);
            debug('Registered Garmin Race Timer PGN definition');
            n2kHandler = handleParsedPgn;
            app.on('N2KAnalyzerOut', n2kHandler);
            debug('Subscribed to N2KAnalyzerOut');
            publishMeta();
            debug('Plugin started');
        },
        stop: function () {
            if (n2kHandler) {
                app.off('N2KAnalyzerOut', n2kHandler);
                n2kHandler = null;
            }
            lastStatus = null;
            lockedStartTime = null;
            lockedFinishTime = null;
            lastCountdownPausedValueMs = null;
            raceStartNotificationActive = false;
            raceFinishNotificationActive = false;
            currentState = {
                timeToStart: null,
                elapsedTime: null,
                startTime: null,
                finishTime: null,
                status: null,
                lastUpdate: null
            };
            debug('Plugin stopped');
        },
        registerWithRouter: function (router) {
            router.get('/state', (_req, res) => {
                res.json(currentState);
            });
        },
        id: PLUGIN_ID,
        name: 'Garmin Race Timer',
        description: 'Converts Garmin Race Timer NMEA 2000 data to Signal K racing paths',
        schema: {
            type: 'object',
            properties: {}
        }
    };
    return plugin;
}
exports.default = default_1;
