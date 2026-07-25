'use strict'

// End-to-end transport tests: drive the plugin with a fake Signal K app and a
// real loopback listener, and check the sentence actually arrives.
//
// These also cover the option fallback. Before TCP was an option the settings
// were named udpAddress/udpPort, and a config saved under the old names must
// keep working — a silent regression there would take the output off the air
// for anyone upgrading, with the plugin still reporting itself as active.

const { test } = require('node:test')
const assert   = require('node:assert')
const net      = require('net')
const dgram    = require('dgram')

const pluginFactory = require('..')

function makeApp (paths) {
  const handlers = []
  const app = {
    selfId: 'urn:mrn:signalk:uuid:test',
    statuses: [],
    debug: () => {},
    setPluginStatus: (s) => app.statuses.push(s),
    setPluginError: () => {},
    getSelfPath: (p) => (paths[p] !== undefined ? { value: paths[p] } : undefined),
    registerDeltaInputHandler: (h) => { handlers.push(h); return () => {} },
    fire: (delta) => handlers.forEach(h => h(delta, () => {}))
  }
  return app
}

const PATHS = {
  'navigation.headingTrue': 0,
  'sensors.gps.fromBow': 8,
  'sensors.gps.fromCenter': -0.3
}

const positionDelta = (label = 'gps') => ({
  updates: [{
    source: { label },
    values: [{ path: 'navigation.position', value: { latitude: -33.8568, longitude: 151.2153 } }]
  }]
})

// Starts a listener, runs the plugin against it, resolves with what arrived.
function receive (makeServer, startOptions) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('nothing received within 3s')), 3000)
    const done  = (data, server, p) => {
      clearTimeout(timer)
      p.stop()
      server.close()
      resolve(data.toString())
    }
    makeServer((server, port) => {
      const app = makeApp(PATHS)
      const p   = pluginFactory(app)
      p.start({ ...startOptions, port })
      // Let the socket open (both transports bind asynchronously) before firing.
      setTimeout(() => app.fire(positionDelta()), 150)
      server.once('__data', (d) => done(d, server, p))
    })
  })
}

const tcpServer = (ready) => {
  const server = net.createServer(sock => sock.on('data', d => server.emit('__data', d)))
  server.listen(0, '127.0.0.1', () => ready(server, server.address().port))
}

const udpServer = (ready) => {
  const server = dgram.createSocket('udp4')
  server.on('message', m => server.emit('__data', m))
  server.bind(0, '127.0.0.1', () => ready(server, server.address().port))
}

const GLL = /^\$IIGLL,\d{4}\.\d{5},[NS],\d{5}\.\d{5},[EW],\d{6}\.\d{2},A\*[0-9A-F]{2}\r\n$/

test('TCP delivers a well-formed GLL sentence', async () => {
  const got = await receive(tcpServer, { transport: 'tcp', host: '127.0.0.1' })
  assert.match(got, GLL)
})

test('UDP delivers a well-formed GLL sentence', async () => {
  const got = await receive(udpServer, { transport: 'udp', host: '127.0.0.1' })
  assert.match(got, GLL)
})

test('a config saved under the old udpAddress/udpPort names still transmits', async () => {
  // No transport and no host key — exactly what an existing install has stored.
  const got = await receive(
    (ready) => udpServer((server, port) => ready(server, port)),
    { udpAddress: '127.0.0.1' }
  )
  assert.match(got, GLL)
})

// The config screen no longer lists input availability, so the status line is
// the only place a missing input is reported. It has to name the actual path.
test('the status line names each missing input by path', () => {
  const cases = [
    [{ 'sensors.gps.fromBow': 8, 'sensors.gps.fromCenter': -0.3 }, /navigation\.headingTrue/],
    [{ 'navigation.headingTrue': 0, 'sensors.gps.fromCenter': -0.3 }, /sensors\.gps\.fromBow/],
    [{ 'navigation.headingTrue': 0, 'sensors.gps.fromBow': 8 }, /sensors\.gps\.fromCenter/]
  ]

  for (const [paths, expected] of cases) {
    const app = makeApp(paths)
    const p   = pluginFactory(app)
    p.start({ transport: 'udp', host: '127.0.0.1', port: 59999 })
    app.fire(positionDelta())

    const last = app.statuses[app.statuses.length - 1]
    assert.match(last, expected)
    p.stop()
  }
})

test('both missing offsets are reported together, not one at a time', () => {
  const app = makeApp({ 'navigation.headingTrue': 0 })
  const p   = pluginFactory(app)
  p.start({ transport: 'udp', host: '127.0.0.1', port: 59999 })
  app.fire(positionDelta())

  const last = app.statuses[app.statuses.length - 1]
  assert.match(last, /fromBow/)
  assert.match(last, /fromCenter/)
  p.stop()
})

test('the schema is a plain object the admin UI can render directly', () => {
  const p = pluginFactory(makeApp(PATHS))
  assert.equal(typeof p.schema, 'object', 'schema should not be a function')
  assert.deepEqual(
    Object.keys(p.schema.properties),
    ['transport', 'host', 'port', 'connectTimeout']
  )
  // The dependencies panel was removed; the status line covers it.
  assert.ok(!('dependencies' in p.schema.properties), 'dependencies panel should be gone')
  assert.ok(!p.uiSchema, 'uiSchema is only needed for the removed panel')
})
