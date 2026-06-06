'use strict'

const RAD_TO_DEG = 180 / Math.PI
const DEG_TO_RAD = Math.PI / 180

module.exports = function (app) {
  const plugin = {
    id: 'signalk-gps-position-of-bow',
    name: 'gh - GPS Position of Bow',
    description: 'Calculates the GPS position of the bow from antenna placement and magnetic heading'
  }

  plugin.schema = function () {
    const status = (path) => app.getSelfPath(path)?.value != null ? '✓  Available' : '✗  Not available'
    return {
      type: 'object',
      properties: {
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

  let unsubscribes = []

  plugin.start = function (options) {
    unsubscribes.forEach(f => f())
    unsubscribes = []

    const ownTimestamps = new Set()

    app.subscriptionmanager.subscribe(
      {
        context: 'vessels.self',
        sourcePolicy: 'all',
        subscribe: [{ path: 'navigation.position' }]
      },
      unsubscribes,
      (err) => app.setPluginError(err),
      (delta) => {
        for (const update of (delta.updates || [])) {
          if (update.timestamp && ownTimestamps.has(update.timestamp)) {
            ownTimestamps.delete(update.timestamp)
            continue
          }
          if (update.$source === plugin.id) continue

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

          app.debug(`bow: lat=${bowLat.toFixed(6)} lon=${bowLon.toFixed(6)} (east=${eastM.toFixed(2)}m north=${northM.toFixed(2)}m)`)

          const outTs = new Date().toISOString()
          ownTimestamps.add(outTs)
          app.handleMessage(plugin.id, {
            context: 'vessels.' + app.selfId,
            updates: [{
              timestamp: outTs,
              values: [{ path: 'navigation.position', value: { latitude: bowLat, longitude: bowLon } }]
            }]
          })

          const centerLabel = fromCenter < 0 ? `${Math.abs(fromCenter)}m stbd` : `${fromCenter}m port`
          app.setPluginStatus(`Active — antenna ${fromBow}m fwd, ${centerLabel} | bow ${bowLat.toFixed(6)}, ${bowLon.toFixed(6)}`)
        }
      }
    )

    app.setPluginStatus('Active — waiting for position fix')
  }

  plugin.stop = function () {
    unsubscribes.forEach(f => f())
    unsubscribes = []
    app.setPluginStatus('Stopped')
  }

  return plugin
}
