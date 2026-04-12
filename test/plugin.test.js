const chai = require('chai')
const expect = chai.expect
chai.Should()
const EventEmitter = require('events')

const { FromPgn } = require('@canboat/canboatjs')
const PropertyValues = require('@signalk/server-api').PropertyValues

const pgnDefinitions = require('../dist/pgns')
const createPlugin = require('../dist/').default

// Actisense-format test messages (real captures / constructed from analysis)
const HEADER = '2025-05-01T09:06:46.430Z,7,126720,2,7,39'
const DATA_PREFIX = 'e5,98,fe,09,0b,0b,7e,ad,79,a3,06,00,00,00,02,00,16,5f,99,62,6f,fe,00,00,00,19,99,62,6f,ff,00,00,00'

// Timer data: timerDataType(05), time(4 bytes LE), status(1 byte)
const messages = {
  countdown10min: `${HEADER},${DATA_PREFIX},05,c0,27,09,00,01`,  // 600,000ms, status 1
  countdownPaused: `${HEADER},${DATA_PREFIX},05,30,51,06,00,03`, // 414,000ms, status 3
  raceStart:      `${HEADER},${DATA_PREFIX},05,00,00,00,00,00`,  // 0ms, status 0
  raceRunning60s: `${HEADER},${DATA_PREFIX},05,60,ea,00,00,00`,  // 60,000ms, status 0
  racePaused:     `${HEADER},${DATA_PREFIX},05,60,ea,00,00,02`,  // 60,000ms, status 2
}


describe('PGN parsing', function () {
  let fromPgn

  before(function () {
    const propertyValues = new PropertyValues()
    propertyValues.emitPropertyValue({
      timestamp: Date.now(),
      setter: 'test',
      name: 'canboat-custom-pgns',
      value: pgnDefinitions
    })
    fromPgn = new FromPgn({
      onPropertyValues: propertyValues.onPropertyValues.bind(propertyValues),
      useCamelCompat: true  // matches Signal K server default; exposes both Id and Name as field keys
    })
  })

  it('parses countdown 10:00 message', function () {
    const pgn = fromPgn.parseString(messages.countdown10min)
    expect(pgn).to.exist
    expect(pgn.pgn).to.equal(126720)
    expect(pgn.fields['Timer Data Type']).to.equal(5)
    expect(pgn.fields['Timer Value']).to.equal(600000)
    expect(pgn.fields['Timer Status']).to.equal(1)
    expect(pgn.fields['Sub-command']).to.equal(254)
    expect(pgn.fields['Message Type']).to.equal(2)
  })

  it('parses countdown paused message', function () {
    const pgn = fromPgn.parseString(messages.countdownPaused)
    expect(pgn.fields['Timer Value']).to.equal(414000)
    expect(pgn.fields['Timer Status']).to.equal(3)
  })

  it('parses race start message', function () {
    const pgn = fromPgn.parseString(messages.raceStart)
    expect(pgn.fields['Timer Value']).to.equal(0)
    expect(pgn.fields['Timer Status']).to.equal(0)
  })

  it('parses race running message', function () {
    const pgn = fromPgn.parseString(messages.raceRunning60s)
    expect(pgn.fields['Timer Value']).to.equal(60000)
    expect(pgn.fields['Timer Status']).to.equal(0)
  })

  it('parses race paused message', function () {
    const pgn = fromPgn.parseString(messages.racePaused)
    expect(pgn.fields['Timer Value']).to.equal(60000)
    expect(pgn.fields['Timer Status']).to.equal(2)
  })
})


// Helper: build a parsed PGN object as emitted by N2KAnalyzerOut
function makePgn(timerValueMs, timerStatus) {
  return {
    pgn: 126720,
    fields: {
      'Manufacturer Code': 229,
      'Sub-command': 254,
      'Message Type': 2,
      'Timer Data Type': 5,
      'Timer Value': timerValueMs,
      'Timer Status': timerStatus
    }
  }
}


describe('Plugin callback logic', function () {
  let plugin
  let deltas
  let mockApp

  beforeEach(function () {
    deltas = []
    mockApp = Object.assign(new EventEmitter(), {
      debug: function () {},
      error: function () {},
      emitPropertyValue: function () {},
      handleMessage: function (_id, delta) {
        deltas.push(delta)
      }
    })
    plugin = createPlugin(mockApp)
    plugin.start({})
    deltas = [] // clear metadata delta from start()
  })

  afterEach(function () {
    plugin.stop()
  })

  function simulateN2k(timerValueMs, timerStatus) {
    mockApp.emit('N2KAnalyzerOut', makePgn(timerValueMs, timerStatus))
  }

  function isClearedNotification(v) {
    return v.value && v.value.state === 'normal'
  }

  function getValues() {
    expect(deltas.length).to.be.greaterThan(0)
    const lastDelta = deltas[deltas.length - 1]
    const values = lastDelta.updates[0].values
    const map = {}
    values.forEach(v => { map[v.path] = v.value })
    return map
  }

  it('publishes metadata on start', function () {
    deltas = []
    plugin.stop()
    plugin = createPlugin(mockApp)
    plugin.start({})
    expect(deltas.length).to.equal(1)
    const meta = deltas[0].updates[0].meta
    expect(meta).to.have.lengthOf(5)
    expect(meta[0].path).to.equal('navigation.racing.timeToStart')
    expect(meta[0].value.units).to.equal('s')
  })

  it('handles countdown status', function () {
    simulateN2k(600000, 1) // 10 minutes
    const vals = getValues()
    expect(vals['navigation.racing.timeToStart']).to.equal(600)
    expect(vals['navigation.racing.elapsedTime']).to.be.null
    expect(vals['navigation.racing.status']).to.equal('countdown')
    expect(vals['navigation.racing.startTime']).to.be.a('string')
    expect(vals['navigation.racing.finishTime']).to.be.null
  })

  it('handles countdown paused status', function () {
    simulateN2k(414000, 3) // 6:54
    const vals = getValues()
    expect(vals['navigation.racing.timeToStart']).to.equal(414)
    expect(vals['navigation.racing.elapsedTime']).to.be.null
    expect(vals['navigation.racing.status']).to.equal('countdownPaused')
  })

  it('handles race running status', function () {
    simulateN2k(60000, 0) // 60s elapsed
    const vals = getValues()
    expect(vals['navigation.racing.timeToStart']).to.equal(0)
    expect(vals['navigation.racing.elapsedTime']).to.equal(60)
    expect(vals['navigation.racing.status']).to.equal('racing')
    expect(vals['navigation.racing.startTime']).to.be.a('string')
    expect(vals['navigation.racing.finishTime']).to.be.null
  })

  it('handles race finished status', function () {
    simulateN2k(60000, 2) // 60s elapsed, finished
    const vals = getValues()
    expect(vals['navigation.racing.timeToStart']).to.equal(0)
    expect(vals['navigation.racing.elapsedTime']).to.equal(60)
    expect(vals['navigation.racing.status']).to.equal('raceFinished')
  })

  it('emits race finish notification on transition', function () {
    simulateN2k(5000, 1)   // countdown
    simulateN2k(0, 0)      // race start
    simulateN2k(60000, 0)  // 60s racing
    deltas = []
    simulateN2k(60000, 2)  // race finished

    const notificationDelta = deltas.find(d =>
      d.updates[0].values &&
      d.updates[0].values.some(v => v.path.includes('raceFinish'))
    )
    expect(notificationDelta).to.exist
    const notifValue = notificationDelta.updates[0].values[0]
    expect(notifValue.path).to.equal('notifications.navigation.racing.raceFinish')
    expect(notifValue.value.state).to.equal('alert')
    expect(notifValue.value.message).to.include('1:00')
  })

  it('captures finishTime on race-to-raceFinished transition', function () {
    simulateN2k(5000, 1)   // countdown
    simulateN2k(0, 0)      // race start
    simulateN2k(60000, 0)  // 60s racing
    const before = Date.now()
    simulateN2k(100000, 2) // race finished
    const after = Date.now()

    const vals = getValues()
    expect(vals['navigation.racing.finishTime']).to.be.a('string')
    const finishTime = new Date(vals['navigation.racing.finishTime']).getTime()
    expect(finishTime).to.be.at.least(before)
    expect(finishTime).to.be.at.most(after)
  })

  it('clears finishTime if race resumes after finish', function () {
    simulateN2k(5000, 1)   // countdown
    simulateN2k(0, 0)      // race start
    simulateN2k(60000, 0)  // 60s racing
    simulateN2k(100000, 2) // race finished

    const vals1 = getValues()
    expect(vals1['navigation.racing.finishTime']).to.be.a('string')

    simulateN2k(100000, 0) // race resumed
    const vals2 = getValues()
    expect(vals2['navigation.racing.finishTime']).to.be.null
  })

  it('clears raceStart notification when race finishes', function () {
    simulateN2k(5000, 1)  // countdown
    simulateN2k(0, 0)     // race start
    simulateN2k(60000, 0) // 60s racing
    deltas = []
    simulateN2k(60000, 2) // race finished

    const clearDelta = deltas.find(d =>
      d.updates[0].values &&
      d.updates[0].values.some(v =>
        v.path === 'notifications.navigation.racing.raceStart' && isClearedNotification(v)
      )
    )
    expect(clearDelta).to.exist
  })

  it('clears raceFinish notification when race resumes', function () {
    simulateN2k(5000, 1)   // countdown
    simulateN2k(0, 0)      // race start
    simulateN2k(60000, 0)  // 60s racing
    simulateN2k(100000, 2) // race finished
    deltas = []
    simulateN2k(100000, 0) // race resumed

    const clearDelta = deltas.find(d =>
      d.updates[0].values &&
      d.updates[0].values.some(v =>
        v.path === 'notifications.navigation.racing.raceFinish' && isClearedNotification(v)
      )
    )
    expect(clearDelta).to.exist
  })

  it('clears raceFinish notification when new countdown starts after a race', function () {
    simulateN2k(5000, 1)   // countdown
    simulateN2k(0, 0)      // race start  → raceStart notification active
    simulateN2k(60000, 2)  // race finished → raceStart cleared, raceFinish active
    deltas = []
    simulateN2k(300000, 1) // new countdown → clears raceFinish (raceStart already cleared)

    const paths = deltas.flatMap(d =>
      (d.updates[0].values || [])
        .filter(v => isClearedNotification(v) && v.path.startsWith('notifications.'))
        .map(v => v.path)
    )
    expect(paths).to.include('notifications.navigation.racing.raceFinish')
    expect(paths).to.not.include('notifications.navigation.racing.raceStart')
  })

  it('clears raceStart notification when new countdown starts mid-race', function () {
    simulateN2k(5000, 1)   // countdown
    simulateN2k(0, 0)      // race start → raceStart notification active
    simulateN2k(30000, 0)  // 30s racing (no finish)
    deltas = []
    simulateN2k(300000, 1) // new countdown → clears raceStart

    const paths = deltas.flatMap(d =>
      (d.updates[0].values || [])
        .filter(v => isClearedNotification(v) && v.path.startsWith('notifications.'))
        .map(v => v.path)
    )
    expect(paths).to.include('notifications.navigation.racing.raceStart')
  })

  it('does not emit cleared notification deltas on first countdown', function () {
    simulateN2k(300000, 1) // first countdown, no notifications ever emitted

    const clearedNotifDeltas = deltas.filter(d =>
      d.updates[0].values &&
      d.updates[0].values.some(v => isClearedNotification(v) && v.path.startsWith('notifications.'))
    )
    expect(clearedNotifDeltas).to.have.lengthOf(0)
  })

  it('computes startTime on countdown-to-race transition', function () {
    simulateN2k(5000, 1) // 5s countdown
    simulateN2k(0, 0)    // race start

    const vals = getValues()
    expect(vals['navigation.racing.status']).to.equal('racing')
    expect(vals['navigation.racing.startTime']).to.be.a('string')

    const startTime = new Date(vals['navigation.racing.startTime'])
    const diff = Math.abs(Date.now() - startTime.getTime())
    expect(diff).to.be.lessThan(5000)
  })

  it('emits race start notification on transition', function () {
    simulateN2k(5000, 1) // countdown
    deltas = []
    simulateN2k(0, 0)    // race start

    expect(deltas.length).to.equal(2)
    const notificationDelta = deltas.find(d =>
      d.updates[0].values &&
      d.updates[0].values.some(v => v.path.includes('notifications'))
    )
    expect(notificationDelta).to.exist
    const notifValue = notificationDelta.updates[0].values[0]
    expect(notifValue.path).to.equal('notifications.navigation.racing.raceStart')
    expect(notifValue.value.state).to.equal('alert')
  })

  it('locks startTime after race starts', function () {
    simulateN2k(5000, 1)  // countdown
    simulateN2k(0, 0)     // race start
    const startVals = getValues()
    const lockedTime = startVals['navigation.racing.startTime']

    simulateN2k(10000, 0) // 10s elapsed
    const laterVals = getValues()
    expect(laterVals['navigation.racing.startTime']).to.equal(lockedTime)
  })

  it('predicts startTime during countdown', function () {
    const before = Date.now()
    simulateN2k(300000, 1) // 5 minutes countdown
    const after = Date.now()
    const vals = getValues()

    const predicted = new Date(vals['navigation.racing.startTime']).getTime()
    expect(predicted).to.be.at.least(before + 300000)
    expect(predicted).to.be.at.most(after + 300000)
  })

  it('clears notifications on countdown reset', function () {
    simulateN2k(5000, 1)   // countdown running
    simulateN2k(0, 0)      // race start → raceStart notification active
    simulateN2k(60000, 2)  // race finished → raceFinish notification active
    // Operator starts new countdown, stops it, then resets
    simulateN2k(300000, 1) // new countdown (clears raceFinish)
    simulateN2k(289000, 3) // stop (clears raceStart if still active)
    deltas = []
    simulateN2k(300000, 3) // reset

    const clearedNotifPaths = deltas.flatMap(d =>
      (d.updates[0].values || [])
        .filter(v => isClearedNotification(v) && v.path.startsWith('notifications.'))
        .map(v => v.path)
    )
    // Neither notification should be spuriously re-cleared
    // (they were already cleared before the reset message arrived)
    expect(clearedNotifPaths).to.not.include('notifications.navigation.racing.raceStart')
    expect(clearedNotifPaths).to.not.include('notifications.navigation.racing.raceFinish')
  })

  it('nulls startTime on countdown reset (time increases while countdownPaused)', function () {
    simulateN2k(289000, 3) // countdown paused at 4:49
    simulateN2k(300000, 3) // reset — time jumps back to 5:00

    const vals = getValues()
    expect(vals['navigation.racing.status']).to.equal('countdownPaused')
    expect(vals['navigation.racing.timeToStart']).to.equal(300)
    expect(vals['navigation.racing.startTime']).to.be.null
  })

  it('does not treat first countdownPaused message as reset', function () {
    simulateN2k(289000, 3) // first pause — not a reset

    const vals = getValues()
    expect(vals['navigation.racing.startTime']).to.be.a('string')
  })

  it('does not treat normal countdown as reset when time decreases', function () {
    simulateN2k(300000, 3) // paused at 5:00
    simulateN2k(299000, 3) // time decreases — not a reset (e.g. resumed then re-paused)

    const vals = getValues()
    expect(vals['navigation.racing.startTime']).to.be.a('string')
  })

  it('clears reset detection state when countdown resumes (status 0x01)', function () {
    simulateN2k(289000, 3) // paused
    simulateN2k(300000, 3) // reset
    simulateN2k(300000, 1) // new countdown started (operator pressed Start)

    const vals = getValues()
    expect(vals['navigation.racing.startTime']).to.be.a('string') // predicted, not null
  })

  it('resets state when new race countdown starts after a finished race', function () {
    simulateN2k(10000, 1)  // countdown 10s
    simulateN2k(0, 0)      // race start
    const race1Start = getValues()['navigation.racing.startTime']
    simulateN2k(60000, 0)  // 60s racing
    simulateN2k(60000, 2)  // race finished

    simulateN2k(300000, 1) // new countdown

    const race2Vals = getValues()
    expect(race2Vals['navigation.racing.status']).to.equal('countdown')
    expect(race2Vals['navigation.racing.timeToStart']).to.equal(300)
    expect(race2Vals['navigation.racing.elapsedTime']).to.be.null
    expect(race2Vals['navigation.racing.finishTime']).to.be.null
    expect(race2Vals['navigation.racing.startTime']).to.not.equal(race1Start)
  })

  it('computes fresh startTime for new race after previous race finished', function () {
    simulateN2k(10000, 1)  // countdown
    simulateN2k(5000, 0)   // race start with 5s elapsed (startTime = now - 5s)
    const race1Start = new Date(getValues()['navigation.racing.startTime']).getTime()
    simulateN2k(60000, 2)  // race finished

    simulateN2k(10000, 1)  // new countdown (resets state)
    const before = Date.now()
    simulateN2k(0, 0)      // new race start at t=0

    const race2Start = new Date(getValues()['navigation.racing.startTime']).getTime()
    expect(race2Start).to.be.greaterThan(race1Start)
    expect(race2Start).to.be.at.least(before)
  })

  it('emits race start notification for second race', function () {
    simulateN2k(10000, 1)
    simulateN2k(0, 0)
    simulateN2k(60000, 2)

    simulateN2k(10000, 1)
    deltas = []
    simulateN2k(0, 0)

    const notificationDelta = deltas.find(d =>
      d.updates[0].values &&
      d.updates[0].values.some(v => v.path.includes('notifications'))
    )
    expect(notificationDelta).to.exist
  })

  it('ignores non-126720 PGN events', function () {
    mockApp.emit('N2KAnalyzerOut', { pgn: 130306, fields: { 'Wind Speed': 5 } })
    expect(deltas).to.have.lengthOf(0)
  })

  it('ignores messages with wrong sub-command', function () {
    mockApp.emit('N2KAnalyzerOut', {
      pgn: 126720,
      fields: { 'Sub-command': 231, 'Message Type': 2, 'Timer Data Type': 5, 'Timer Value': 600000, 'Timer Status': 1 }
    })
    expect(deltas).to.have.lengthOf(0)
  })

  it('ignores messages with wrong message type', function () {
    mockApp.emit('N2KAnalyzerOut', {
      pgn: 126720,
      fields: { 'Sub-command': 254, 'Message Type': 3, 'Timer Data Type': 5, 'Timer Value': 600000, 'Timer Status': 1 }
    })
    expect(deltas).to.have.lengthOf(0)
  })

  it('ignores messages with wrong timer data type', function () {
    mockApp.emit('N2KAnalyzerOut', {
      pgn: 126720,
      fields: { 'Sub-command': 254, 'Message Type': 2, 'Timer Data Type': 3, 'Timer Value': 600000, 'Timer Status': 1 }
    })
    expect(deltas).to.have.lengthOf(0)
  })

  it('unsubscribes from N2KAnalyzerOut on stop', function () {
    simulateN2k(600000, 1)
    expect(deltas.length).to.be.greaterThan(0)

    plugin.stop()
    deltas = []

    simulateN2k(600000, 1)
    expect(deltas).to.have.lengthOf(0)
  })
})


describe('REST API', function () {
  let plugin
  let routes
  let mockApp

  before(function () {
    routes = {}
    mockApp = Object.assign(new EventEmitter(), {
      debug: function () {},
      error: function () {},
      emitPropertyValue: function () {},
      handleMessage: function () {}
    })
    plugin = createPlugin(mockApp)
    plugin.registerWithRouter({
      get: function (path, handler) {
        routes[path] = handler
      }
    })
  })

  it('registers /state endpoint', function () {
    expect(routes['/state']).to.be.a('function')
  })

  it('returns current state', function () {
    plugin.start({})

    mockApp.emit('N2KAnalyzerOut', {
      pgn: 126720,
      fields: {
        'Sub-command': 254,
        'Message Type': 2,
        'Timer Data Type': 5,
        'Timer Value': 600000,
        'Timer Status': 1
      }
    })

    let responseData
    routes['/state'](
      {},
      { json: function (data) { responseData = data } }
    )

    expect(responseData.timeToStart).to.equal(600)
    expect(responseData.elapsedTime).to.be.null
    expect(responseData.status).to.equal('countdown')
    expect(responseData.lastUpdate).to.be.a('string')
    expect(responseData.startTime).to.be.a('string')
  })
})
