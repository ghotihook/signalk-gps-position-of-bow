module.exports = function (app) {
  const plugin = {
    id: 'signalk-gps-position-of-bow',
    name: 'GPS Position of Bow',
    description: 'Calculates the GPS position of the bow from antenna placement and magnetic heading'
  }

  plugin.schema = {
    type: 'object',
    properties: {
      interval: {
        type: 'number',
        title: 'Update interval (ms)',
        default: 1000
      }
    }
  }

  let timer = null

  plugin.start = function (options) {
    const interval = options.interval || 1000

    function calculate () {
      const position = app.getSelfPath('navigation.position')?.value
      const heading  = app.getSelfPath('navigation.headingMagnetic')?.value
      const fromBow  = app.getSelfPath('sensors.gps.fromBow')?.value
      const fromCenter = app.getSelfPath('sensors.gps.fromCenter')?.value

      if (position == null || heading == null || fromBow == null || fromCenter == null) {
        app.setPluginStatus('Waiting for data...')
        return
      }

      const lat = position.latitude
      const lon = position.longitude
      const h   = heading  // radians, magnetic (true heading TODO)

      // Forward unit vector (east, north): (sin h, cos h)
      // Port unit vector: (-cos h, sin h)
      // Bow = GPS + fromBow * forward + (-fromCenter) * port
      //   (GPS is fromCenter meters to port, bow is on centreline)
      const eastM  = fromBow * Math.sin(h) + fromCenter * Math.cos(h)
      const northM = fromBow * Math.cos(h) - fromCenter * Math.sin(h)

      const R = 6371000
      const bowLat = lat + (northM / R) * (180 / Math.PI)
      const bowLon = lon + (eastM  / (R * Math.cos(lat * Math.PI / 180))) * (180 / Math.PI)

      app.handleMessage(plugin.id, {
        context: 'vessels.' + app.selfId,
        updates: [{
          source: { label: plugin.id, type: 'plugin' },
          timestamp: new Date().toISOString(),
          values: [{ path: 'navigation.bowPosition', value: { latitude: bowLat, longitude: bowLon } }]
        }]
      })

      app.setPluginStatus(`Active — bow ${bowLat.toFixed(6)}, ${bowLon.toFixed(6)}`)
    }

    timer = setInterval(calculate, interval)
    app.setPluginStatus('Active')
  }

  plugin.stop = function () {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    app.setPluginStatus('Stopped')
  }

  return plugin
}
