'use strict'

// The bow projection. Headings are radians, offsets are metres.
//
// Signal K defines sensors.*.fromCenter as "the distance from the centerline to
// the sensor location, -ve to starboard, +ve to port", and fromBow as the
// distance from the bow to the sensor. Both describe where the ANTENNA sits.
//
// bowPosition returns the displacement from the antenna TO the bow, which runs
// the other way, and that inversion is easy to get backwards — it has been,
// once. An antenna mounted to starboard (-ve fromCenter) means the bow, which
// sits on the centreline, lies to PORT of it. Getting this wrong mirrors the
// bow across the centreline and puts it out by twice the offset.

const { test } = require('node:test')
const assert   = require('node:assert')

const { bowPosition } = require('..')._internal

const DEG = Math.PI / 180
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`)

test('heading north puts the whole offset into northing', () => {
  const bow = bowPosition(-33.868, 151.209, 0, 10, 0)
  near(bow.northM, 10, 1e-9, 'northM')
  near(bow.eastM,   0, 1e-9, 'eastM')
  assert.ok(bow.latitude > -33.868, 'latitude should increase heading north')
})

test('heading east puts the whole offset into easting', () => {
  const bow = bowPosition(-33.868, 151.209, 90 * DEG, 10, 0)
  near(bow.eastM,  10, 1e-9, 'eastM')
  near(bow.northM,  0, 1e-9, 'northM')
  assert.ok(bow.longitude > 151.209, 'longitude should increase heading east')
})

test('a starboard-mounted antenna puts the bow to port of it', () => {
  // Antenna 8 m aft of the bow and 0.3 m to starboard, heading north. The bow is
  // 8 m north, and 0.3 m WEST because the centreline is to port of the antenna.
  const bow = bowPosition(0, 0, 0, 8, -0.3)
  near(bow.northM,  8,   1e-9, 'northM')
  near(bow.eastM,  -0.3, 1e-9, 'eastM')
  assert.ok(bow.longitude < 0, 'bow should be west of a starboard-mounted antenna heading north')
})

test('the same antenna heading east puts the bow to the north', () => {
  // Heading east, starboard is due south, so the centreline is 0.3 m north.
  const bow = bowPosition(0, 0, 90 * DEG, 8, -0.3)
  near(bow.eastM,  8,   1e-9, 'eastM')
  near(bow.northM, 0.3, 1e-9, 'northM')
})

test('a port-mounted antenna puts the bow to starboard of it', () => {
  const bow = bowPosition(0, 0, 0, 0, 5)
  near(bow.eastM, 5, 1e-9, 'eastM')
  assert.ok(bow.longitude > 0, 'bow should be east of a port-mounted antenna heading north')
})

test('the lateral correction tracks the heading all the way round', () => {
  // A starboard-mounted antenna must place the bow 90 degrees ANTICLOCKWISE of
  // the heading at every bearing, not just at north — this is what catches a
  // sign error that happens to look right on one heading.
  for (let h = 0; h < 360; h += 15) {
    const bow = bowPosition(0, 0, h * DEG, 0, -5)
    near(bow.eastM,  -5 * Math.cos(h * DEG), 1e-9, `eastM at ${h}°`)
    near(bow.northM,  5 * Math.sin(h * DEG), 1e-9, `northM at ${h}°`)
  }
})

test('the offset distance is preserved through any heading', () => {
  const expected = Math.hypot(8.5, 0.3)
  for (let h = 0; h < 360; h += 7) {
    const bow = bowPosition(-33.868, 151.209, h * DEG, 8.5, -0.3)
    near(Math.hypot(bow.eastM, bow.northM), expected, 1e-9, `magnitude at ${h}°`)
  }
})

test('longitude offset scales with latitude', () => {
  // The same eastward metres are more degrees of longitude nearer the pole.
  const atEquator = bowPosition(0,  0, 90 * DEG, 100, 0)
  const atSixty   = bowPosition(60, 0, 90 * DEG, 100, 0)
  near(atSixty.longitude / atEquator.longitude, 2, 1e-3, 'convergence factor at 60N')
})

test('a zero offset leaves the fix untouched', () => {
  const bow = bowPosition(-33.868, 151.209, 45 * DEG, 0, 0)
  near(bow.latitude,  -33.868,  1e-12, 'latitude')
  near(bow.longitude, 151.209, 1e-12, 'longitude')
})
