module.exports = function (app) {
  const plugin = {
    id: 'signalk-gps-position-of-bow',
    name: 'gh - GPS Position Of Bow',
    description: 'Calculates the GPS position of the bow from antenna placement and magnetic heading'
  }

  plugin.schema = {
    type: 'object',
    description: [
      'Reads antenna placement from Signal K paths:',
      '  sensors.gps.fromBow    — metres from antenna to bow along centreline',
      '  sensors.gps.fromCenter — metres from centreline (-ve = starboard)',
      'Heading source: navigation.headingMagnetic',
      'Outputs: navigation.bowPosition'
    ].join('\n'),
    properties: {}
  }

  let unsubscribe = null

  plugin.start = function (options) {
    unsubscribe = app.registerDeltaInputHandler((delta, next) => {
      const position = (delta.updates || [])
        .flatMap(u => u.values || [])
        .find(v => v.path === 'navigation.position')?.value

      if (!position) {
        next(delta)
        return
      }

      const heading    = app.getSelfPath('navigation.headingMagnetic')?.value
      const fromBow    = app.getSelfPath('sensors.gps.fromBow')?.value
      const fromCenter = app.getSelfPath('sensors.gps.fromCenter')?.value

      if (heading == null || fromBow == null || fromCenter == null) {
        app.debug(`Missing data — heading: ${heading}, fromBow: ${fromBow}, fromCenter: ${fromCenter}`)
        app.setPluginStatus('Waiting for heading / antenna data...')
        next(delta)
        return
      }

      const { latitude: lat, longitude: lon } = position

      app.debug(`Antenna: lat=${lat.toFixed(6)} lon=${lon.toFixed(6)} heading=${(heading * 180 / Math.PI).toFixed(1)}° fromBow=${fromBow}m fromCenter=${fromCenter}m`)

      // GPS is fromCenter metres to port of centreline; negative = starboard
      const eastM  = fromBow * Math.sin(heading) + fromCenter * Math.cos(heading)
      const northM = fromBow * Math.cos(heading) - fromCenter * Math.sin(heading)

      const R = 6371000
      const bowLat = lat + (northM / R) * (180 / Math.PI)
      const bowLon = lon + (eastM  / (R * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI)

      app.debug(`Bow: lat=${bowLat.toFixed(6)} lon=${bowLon.toFixed(6)} (offset east=${eastM.toFixed(2)}m north=${northM.toFixed(2)}m)`)

      app.handleMessage(plugin.id, {
        context: 'vessels.' + app.selfId,
        updates: [{
          source: { label: plugin.id, type: 'plugin' },
          timestamp: new Date().toISOString(),
          values: [{ path: 'navigation.bowPosition', value: { latitude: bowLat, longitude: bowLon } }]
        }]
      })

      const centerLabel = fromCenter < 0 ? `${Math.abs(fromCenter)}m stbd` : `${fromCenter}m port`
      app.setPluginStatus(`Active — antenna: ${fromBow}m fwd, ${centerLabel} | bow ${bowLat.toFixed(6)}, ${bowLon.toFixed(6)}`)
      next(delta)
    })

    app.setPluginStatus('Active — waiting for position fix')
  }

  plugin.stop = function () {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    app.setPluginStatus('Stopped')
  }

  return plugin
}
