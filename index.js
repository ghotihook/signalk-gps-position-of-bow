'use strict'

const dgram    = require('dgram')
const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

function nmeaChecksum(s) {
  let c = 0
  for (let i = 0; i < s.length; i++) c ^= s.charCodeAt(i)
  return c.toString(16).toUpperCase().padStart(2, '0')
}

function toGLL(lat, lon) {
  const latAbs = Math.abs(lat)
  const latDeg = Math.floor(latAbs)
  const latMin = (latAbs - latDeg) * 60
  const latHem = lat >= 0 ? 'N' : 'S'

  const lonAbs = Math.abs(lon)
  const lonDeg = Math.floor(lonAbs)
  const lonMin = (lonAbs - lonDeg) * 60
  const lonHem = lon >= 0 ? 'E' : 'W'

  const now = new Date()
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  const ss = String(now.getUTCSeconds()).padStart(2, '0')

  const body = `IIGLL,${String(latDeg).padStart(2, '0')}${latMin.toFixed(5)},${latHem},${String(lonDeg).padStart(3, '0')}${lonMin.toFixed(5)},${lonHem},${hh}${mm}${ss}.00,A`
  return `$${body}*${nmeaChecksum(body)}`
}

module.exports = function (app) {
  const plugin = {
    id: 'signalk-gps-position-of-bow',
    name: 'gh - GPS Position of Bow',
    description: 'Calculates the GPS position of the bow from antenna placement and magnetic heading, outputs as NMEA 0183 XDR over UDP'
  }

  plugin.schema = function () {
    const status = (path) => app.getSelfPath(path)?.value != null ? '✓  Available' : '✗  Not available'
    return {
      type: 'object',
      properties: {
        udpAddress:  { type: 'string', title: 'UDP destination address',      default: '255.255.255.255' },
        udpPort:     { type: 'number', title: 'UDP destination port',         default: 1183 },
        outputPath:  { type: 'string', title: 'Signal K output path',         default: 'navigation.bowPosition' },
        dependencies: {
          type: 'object',
          title: 'Dependencies',
          properties: {
            pos:        { type: 'string', title: 'navigation.position',        default: status('navigation.position') },
            hdg:        { type: 'string', title: 'navigation.headingMagnetic', default: status('navigation.headingMagnetic') },
            fromBow:    { type: 'string', title: 'sensors.gps.fromBow',        default: status('sensors.gps.fromBow') },
            fromCenter: { type: 'string', title: 'sensors.gps.fromCenter',     default: status('sensors.gps.fromCenter') }
          }
        }
      }
    }
  }

  plugin.uiSchema = {
    dependencies: {
      pos:        { 'ui:readonly': true },
      hdg:        { 'ui:readonly': true },
      fromBow:    { 'ui:readonly': true },
      fromCenter: { 'ui:readonly': true }
    }
  }

  let unregisterHandler = null
  let socket = null

  plugin.start = function (options) {
    if (unregisterHandler) { unregisterHandler(); unregisterHandler = null }
    if (socket) { try { socket.close() } catch (e) {} }

    const udpAddress = options.udpAddress || '255.255.255.255'
    const udpPort    = options.udpPort    || 1183
    const outputPath = options.outputPath || 'navigation.bowPosition'

    socket = dgram.createSocket('udp4')
    socket.bind(0, () => socket.setBroadcast(true))

    unregisterHandler = app.registerDeltaInputHandler((delta, next) => {
      for (const update of (delta.updates || [])) {
        const position = (update.values || []).find(v => v.path === 'navigation.position')?.value
        if (!position) continue

        const heading    = app.getSelfPath('navigation.headingMagnetic')?.value
        const fromBow    = app.getSelfPath('sensors.gps.fromBow')?.value
        const fromCenter = app.getSelfPath('sensors.gps.fromCenter')?.value

        if (heading == null || fromBow == null || fromCenter == null) {
          app.debug(`missing data — heading: ${heading}, fromBow: ${fromBow}, fromCenter: ${fromCenter}`)
          app.setPluginStatus('Waiting for heading / antenna data...')
          continue
        }

        const { latitude: lat, longitude: lon } = position

        app.debug(`antenna: lat=${lat.toFixed(6)} lon=${lon.toFixed(6)} heading=${(heading * RAD_TO_DEG).toFixed(1)}° fromBow=${fromBow}m fromCenter=${fromCenter}m`)

        // fromCenter is metres to port of centreline; negative = starboard
        const eastM  = fromBow * Math.sin(heading) + fromCenter * Math.cos(heading)
        const northM = fromBow * Math.cos(heading) - fromCenter * Math.sin(heading)

        const R = 6371000
        const bowLat = lat + (northM / R) * RAD_TO_DEG
        const bowLon = lon + (eastM / (R * Math.cos(lat * DEG_TO_RAD))) * RAD_TO_DEG

        const sentence = toGLL(bowLat, bowLon)
        const buf = Buffer.from(sentence + '\r\n')
        socket.send(buf, 0, buf.length, udpPort, udpAddress, (err) => {
          if (err) app.debug(`UDP send error: ${err.message}`)
        })

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
        app.setPluginStatus(`Active — antenna ${fromBow}m fwd, ${centerLabel} | bow ${bowLat.toFixed(6)}, ${bowLon.toFixed(6)}`)
      }
      next(delta)
    })

    app.setPluginStatus('Active — waiting for position fix')
  }

  plugin.stop = function () {
    if (unregisterHandler) { unregisterHandler(); unregisterHandler = null }
    if (socket) { try { socket.close() } catch (e) {} socket = null }
    app.setPluginStatus('Stopped')
  }

  return plugin
}
