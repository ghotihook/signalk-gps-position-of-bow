'use strict'

const dgram    = require('dgram')
const net      = require('net')
const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

function nmeaChecksum(s) {
  let c = 0
  for (let i = 0; i < s.length; i++) c ^= s.charCodeAt(i)
  return c.toString(16).toUpperCase().padStart(2, '0')
}

// Degrees to the NMEA ddmm.mmmmm / dddmm.mmmmm form, with the hemisphere taken
// from the sign. Minutes are rounded before degrees are split off, so a value
// whose remainder rounds up to 60 carries into the degrees instead of emitting
// the illegal "3360.00000".
function ddmm(deg, isLat) {
  const width   = isLat ? 2 : 3
  const hem     = deg >= 0 ? (isLat ? 'N' : 'E') : (isLat ? 'S' : 'W')
  const abs     = Math.abs(deg)

  let d = Math.floor(abs)
  let m = Number(((abs - d) * 60).toFixed(5))
  if (m >= 60) { d += 1; m = 0 }

  return [`${String(d).padStart(width, '0')}${m.toFixed(5).padStart(8, '0')}`, hem]
}

function toGLL(lat, lon, now = new Date()) {
  const [latStr, latHem] = ddmm(lat, true)
  const [lonStr, lonHem] = ddmm(lon, false)

  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  const ss = String(now.getUTCSeconds()).padStart(2, '0')

  const body = `IIGLL,${latStr},${latHem},${lonStr},${lonHem},${hh}${mm}${ss}.00,A`
  return `$${body}*${nmeaChecksum(body)}`
}

// Projects the antenna's fix forward to the bow. Per the Signal K definition of
// sensors.*.fromCenter — "the distance from the centerline to the sensor
// location, -ve to starboard, +ve to port" — both offsets describe where the
// *antenna* sits relative to the bow and centreline.
//
// What comes back is the displacement from the antenna to the bow, which is the
// opposite sense: an antenna mounted to starboard (-ve fromCenter) means the
// bow, sitting on the centreline, lies to port of it. Heading north with
// fromBow=8, fromCenter=-0.3, the bow is 8 m north and 0.3 m west.
function bowPosition(lat, lon, heading, fromBow, fromCenter) {
  const eastM  = fromBow * Math.sin(heading) + fromCenter * Math.cos(heading)
  const northM = fromBow * Math.cos(heading) - fromCenter * Math.sin(heading)

  const R = 6371000
  return {
    latitude:  lat + (northM / R) * RAD_TO_DEG,
    longitude: lon + (eastM / (R * Math.cos(lat * DEG_TO_RAD))) * RAD_TO_DEG,
    eastM,
    northM
  }
}

// The projection rotates a boat-relative offset into an east/north frame, and
// that frame is TRUE north — so the heading has to be true. Magnetic heading
// rotates the whole correction by the local variation: around 12 degrees in
// Sydney, which on an 8 m offset misplaces the bow by ~1.7 m. That is the same
// order as the correction itself, so it is not a detail.
//
// Preference order: a real headingTrue, else headingMagnetic plus variation.
// Bare headingMagnetic is deliberately NOT used as a last resort — it would
// look like it was working while being quietly wrong by metres.
function trueHeading (app) {
  const hdgTrue = app.getSelfPath('navigation.headingTrue')?.value
  if (hdgTrue != null) return { heading: hdgTrue, from: 'headingTrue' }

  const hdgMag = app.getSelfPath('navigation.headingMagnetic')?.value
  const varn   = app.getSelfPath('navigation.magneticVariation')?.value
  if (hdgMag != null && varn != null) {
    // Variation is signed east-positive, and true = magnetic + variation.
    const h = hdgMag + varn
    const TWO_PI = Math.PI * 2
    return { heading: ((h % TWO_PI) + TWO_PI) % TWO_PI, from: 'headingMagnetic + magneticVariation' }
  }
  return null
}

module.exports = function (app) {
  const plugin = {
    id: 'signalk-gps-position-of-bow',
    name: 'gh - GPS Position of Bow',
    description: 'Calculates the GPS position of the bow from antenna placement and magnetic heading, outputs as an NMEA 0183 GLL sentence over TCP or UDP'
  }

  // A plain object, not a function: nothing here depends on live data, and the
  // input state it used to display is reported by the status line instead.
  plugin.schema = {
    type: 'object',
    properties: {
      transport: {
        type: 'string',
        title: 'Transport',
        description: 'UDP is fire-and-forget: nothing confirms the instrument received ' +
                     'anything, but it suits devices that only listen, and broadcast ' +
                     'addresses. TCP opens a client connection to the destination and ' +
                     'reports link state.',
        enum: ['udp', 'tcp'],
        enumNames: ['UDP (datagrams)', 'TCP (client connection)'],
        default: 'udp'
      },
      host:        { type: 'string', title: 'Destination address', default: '255.255.255.255' },
      port:        { type: 'number', title: 'Destination port',    default: 1183 },
      connectTimeout: {
        type: 'number',
        title: 'TCP connect timeout (s)',
        description: 'TCP only. Prevents a destination that silently drops packets from ' +
                     'stalling for the operating system timeout (around two minutes) ' +
                     'before retrying.',
        default: 5
      },
      outputPath: {
        type: 'string',
        title: 'Signal K output path',
        description: 'Where the bow position is published. The default sits alongside ' +
                     'navigation.position rather than competing with it.',
        default: 'navigation.bowPosition'
      }
    }
  }

  let unregisterHandler = null
  let socket    = null   // dgram.Socket (udp) or net.Socket (tcp)
  let connected = false  // tcp: link is up. udp: socket is open (delivery unknown)
  let reconnect = null
  let stopped   = true
  let lastDrop  = null   // last drop reason, so repeats aren't logged; null = never dropped

  plugin.start = function (options) {
    plugin.stop()
    stopped = false

    // host/port were udpAddress/udpPort before TCP was an option; fall back so
    // existing configurations keep working across the rename. Transport
    // defaults to udp for the same reason — that is what installs already do.
    const host       = options.host || options.udpAddress || '255.255.255.255'
    const port       = options.port || options.udpPort    || 1183
    const isUdp      = options.transport !== 'tcp'
    const outputPath = options.outputPath || 'navigation.bowPosition'
    const connTimeoutMs = (options.connectTimeout > 0 ? options.connectTimeout : 5) * 1000

    const dest = `${isUdp ? 'udp' : 'tcp'} ${host}:${port}`

    // --- UDP: connectionless, so there is nothing to connect or reconnect. The
    // socket is opened once and datagrams are fired at the destination. Errors
    // may surface asynchronously or not at all, so `connected` here only means
    // the socket is open, never that anything received the data.
    function openUdp() {
      socket = dgram.createSocket('udp4')
      socket.on('error', (err) => {
        if (lastDrop !== err.message) app.debug(`udp error: ${err.message}`)
        lastDrop = err.message
      })
      socket.bind(() => {
        try {
          // Harmless for unicast, and required for a broadcast destination.
          socket.setBroadcast(true)
        } catch (e) {
          app.debug(`could not enable broadcast: ${e.message}`)
        }
        connected = true
        app.debug(`udp socket open, sending to ${host}:${port}`)
      })
    }

    // --- TCP: client connection with retry.
    function connect() {
      if (stopped) return
      socket = new net.Socket()
      socket.setNoDelay(true)

      // Connect-phase timeout only: without it a host that blackholes packets
      // (rather than refusing them) sits in the OS SYN timeout for ~2 minutes
      // before erroring. Cleared once established so it can't kill an idle link.
      socket.setTimeout(connTimeoutMs)

      socket.on('connect', () => {
        socket.setTimeout(0)
        connected = true
        if (lastDrop !== null) app.debug(`connected to ${host}:${port}`)
        lastDrop = null
      })

      // One drop per socket: destroy() fires 'close' straight after 'error', and
      // the second call would otherwise overwrite the real reason with 'closed'.
      let dropped = false

      const drop = (why) => {
        if (dropped) return
        dropped = true
        // Log only on a change of state or reason, so a host that is down
        // doesn't flood the log every 5s — but the first failure always is.
        if (connected || lastDrop !== why) app.debug(`connection ${why}`)
        lastDrop = why
        connected = false
        if (socket) { socket.destroy(); socket = null }
        if (!stopped && !reconnect) {
          reconnect = setTimeout(() => { reconnect = null; connect() }, 5000)
        }
      }

      socket.on('timeout', () => drop(`connect timeout after ${connTimeoutMs / 1000}s`))
      socket.on('error',   (err) => drop(`error: ${err.message}`))
      socket.on('close',   () => drop('closed'))

      socket.connect(port, host)
    }

    function send(s) {
      if (!connected || !socket) return
      if (isUdp) {
        socket.send(s, port, host, (err) => {
          if (err) app.debug(`udp send error: ${err.message}`)
        })
      } else {
        socket.write(s, (err) => { if (err) app.debug(`tcp write error: ${err.message}`) })
      }
    }

    if (isUdp) openUdp()
    else connect()

    unregisterHandler = app.registerDeltaInputHandler((delta, next) => {
      for (const update of (delta.updates || [])) {
        // Skip our own output. Without this, setting the output path to
        // navigation.position feeds every emitted delta straight back into this
        // handler and recurses until the stack overflows. Check `label` — at
        // this point in the pipeline $source is not yet set on update.source,
        // so testing it silently matches nothing.
        if (update.source && update.source.label === plugin.id) continue

        const position = (update.values || []).find(v => v.path === 'navigation.position')?.value
        if (!position) continue

        const hdg        = trueHeading(app)
        const fromBow    = app.getSelfPath('sensors.gps.fromBow')?.value
        const fromCenter = app.getSelfPath('sensors.gps.fromCenter')?.value

        if (hdg == null || fromBow == null || fromCenter == null) {
          // The status line is the only place input state is reported, so name
          // exactly which paths are missing rather than dumping raw values.
          const missing = []
          if (hdg == null) {
            missing.push('a true heading (navigation.headingTrue, or headingMagnetic + magneticVariation)')
          }
          if (fromBow == null)    missing.push('sensors.gps.fromBow')
          if (fromCenter == null) missing.push('sensors.gps.fromCenter')

          const why = `waiting for ${missing.join(', ')}`
          app.debug(why)
          app.setPluginStatus(`Active →${dest} — ${why}`)
          continue
        }

        const heading = hdg.heading

        const { latitude: lat, longitude: lon } = position

        app.debug(`antenna: lat=${lat.toFixed(6)} lon=${lon.toFixed(6)} heading=${(heading * RAD_TO_DEG).toFixed(1)}°T (${hdg.from}) fromBow=${fromBow}m fromCenter=${fromCenter}m`)

        const bow = bowPosition(lat, lon, heading, fromBow, fromCenter)
        const bowLat = bow.latitude
        const bowLon = bow.longitude

        const sentence = toGLL(bowLat, bowLon)
        send(sentence + '\r\n')

        app.handleMessage(plugin.id, {
          context: 'vessels.' + app.selfId,
          updates: [{
            source: { label: plugin.id, type: 'plugin' },
            timestamp: new Date().toISOString(),
            values: [{ path: outputPath, value: { latitude: bowLat, longitude: bowLon } }]
          }]
        })

        app.debug(`bow: ${sentence}`)

        const centerLabel = fromCenter < 0 ? `${Math.abs(fromCenter)}m stbd` : `${fromCenter}m port`
        // TCP is the only transport that knows whether anything is listening, so
        // it is the only one that can honestly report a broken link.
        const link = isUdp ? '' : (connected ? '' : ` (no link${lastDrop ? `: ${lastDrop}` : ''})`)
        app.setPluginStatus(
          `Active →${dest}${link} — antenna ${fromBow}m fwd, ${centerLabel} | ` +
          `bow ${bowLat.toFixed(6)}, ${bowLon.toFixed(6)}`
        )
      }
      next(delta)
    })

    app.setPluginStatus(`Active →${dest} — waiting for position fix`)
  }

  plugin.stop = function () {
    stopped   = true
    connected = false
    lastDrop  = null
    if (unregisterHandler) { unregisterHandler(); unregisterHandler = null }
    if (reconnect) { clearTimeout(reconnect); reconnect = null }
    // dgram sockets close(), net sockets destroy().
    if (socket) { try { socket.close ? socket.close() : socket.destroy() } catch (e) {} socket = null }
    app.setPluginStatus('Stopped')
  }

  return plugin
}

// Exported for the test suite only — the server never looks at these. The
// coordinate formatting is where the field-width bugs live, so it is worth
// testing directly rather than only through emitted sentences.
module.exports._internal = { nmeaChecksum, ddmm, toGLL, bowPosition, trueHeading }
