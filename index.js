module.exports = function (app) {
  const plugin = {
    id: 'signalk-gps-position-of-bow',
    name: 'gh - GPS Position to Bow',
    description: 'Calculates the GPS position of the bow from antenna placement and magnetic heading'
  }

  plugin.schema = {
    type: 'object',
    description: [
      'Reads antenna placement from Signal K paths:',
      '  sensors.gps.fromBow    — metres from antenna to bow along centreline',
      '  sensors.gps.fromCenter — metres from centreline (-ve = starboard)',
      'Heading source: navigation.headingMagnetic',
      'Outputs: navigation.position (bow), navigation.positionAntennaLocation (raw GPS)'
    ].join('\n'),
    properties: {}
  }

  let unsubscribe = null

  plugin.start = function (options) {
    unsubscribe = app.registerDeltaInputHandler((delta, next) => {
      // Ignore our own output
      for (const update of (delta.updates || [])) {
        if (update.source && update.source.label === plugin.id) {
          next(delta)
          return
        }
      }

      // Only act when a position fix arrives — extract it from the delta directly
      // (data model not yet updated at this point)
      let position = null
      for (const update of (delta.updates || [])) {
        for (const v of (update.values || [])) {
          if (v.path === 'navigation.position') position = v.value
        }
      }

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

      const lat = position.latitude
      const lon = position.longitude
      const h   = heading  // radians, magnetic (switch to headingTrue when available)

      app.debug(`Antenna: lat=${lat.toFixed(6)} lon=${lon.toFixed(6)} heading=${(h * 180 / Math.PI).toFixed(1)}° fromBow=${fromBow}m fromCenter=${fromCenter}m`)

      // Forward unit vector (east, north): (sin h, cos h)
      // Port unit vector: (-cos h, sin h)
      // Bow = GPS + fromBow * forward + (-fromCenter) * port
      //   GPS is fromCenter metres to port (negative = starboard), bow is on centreline
      const eastM  = fromBow * Math.sin(h) + fromCenter * Math.cos(h)
      const northM = fromBow * Math.cos(h) - fromCenter * Math.sin(h)

      const R = 6371000
      const bowLat = lat + (northM / R) * (180 / Math.PI)
      const bowLon = lon + (eastM  / (R * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI)

      app.debug(`Bow: lat=${bowLat.toFixed(6)} lon=${bowLon.toFixed(6)} (offset east=${eastM.toFixed(2)}m north=${northM.toFixed(2)}m)`)

      // Strip raw GPS position so downstream sees only the bow-corrected value
      for (const update of (delta.updates || [])) {
        update.values = (update.values || []).filter(v => v.path !== 'navigation.position')
      }

      app.handleMessage(plugin.id, {
        context: 'vessels.' + app.selfId,
        updates: [{
          source: { label: plugin.id, type: 'plugin' },
          timestamp: new Date().toISOString(),
          values: [
            { path: 'navigation.position',             value: { latitude: bowLat, longitude: bowLon } },
            { path: 'navigation.positionAntennaLocation', value: { latitude: lat, longitude: lon } }
          ]
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
