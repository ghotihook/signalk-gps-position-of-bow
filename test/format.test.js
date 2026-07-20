'use strict'

// Coordinate formatting. This is where the field-width bugs live: minutes below
// ten losing their leading zero, and a remainder that rounds up to 60 minutes.

const { test } = require('node:test')
const assert   = require('node:assert')

const { nmeaChecksum, ddmm, toGLL } = require('..')._internal

test('checksum matches the canonical NMEA example', () => {
  // The $GPGGA sample published with the 0183 standard, checksum 47.
  assert.equal(nmeaChecksum('GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,'), '47')
})

test('checksum is always two uppercase hex digits', () => {
  for (const body of ['A', 'IIGLL,3352.08000,S,15112.54000,E,010203.00,A', 'x'.repeat(70), '']) {
    assert.match(nmeaChecksum(body), /^[0-9A-F]{2}$/)
  }
})

test('ddmm formats to the NMEA widths', () => {
  assert.deepEqual(ddmm(-33.868, true),  ['3352.08000', 'S'])
  assert.deepEqual(ddmm(151.209, false), ['15112.54000', 'E'])
  assert.deepEqual(ddmm(0, true),        ['0000.00000', 'N'])
  assert.deepEqual(ddmm(-0.004, false),  ['00000.24000', 'W'])
})

test('ddmm pads minutes below ten with a leading zero', () => {
  // Regression: toFixed(5) on a minute value under 10 produced "5.30000",
  // one character short, shifting every field after it in the sentence.
  assert.deepEqual(ddmm(33.05, true),   ['3303.00000', 'N'])
  assert.deepEqual(ddmm(151.0, false),  ['15100.00000', 'E'])
  assert.deepEqual(ddmm(-33.1, true),   ['3306.00000', 'S'])
})

test('ddmm never emits 60 minutes', () => {
  // Splitting degrees from minutes and then rounding the remainder turned 33
  // degrees into "3360.00000" whenever the fractional minutes rounded up.
  assert.deepEqual(ddmm(33.999999999, true),   ['3400.00000', 'N'])
  assert.deepEqual(ddmm(-33.999999999, true),  ['3400.00000', 'S'])
  assert.deepEqual(ddmm(151.999999999, false), ['15200.00000', 'E'])

  // Just below the rounding threshold it must stay at 59.99999 minutes.
  assert.deepEqual(ddmm(33.99999916, true),    ['3359.99995', 'N'])
})

test('ddmm holds its width and minute range across the whole globe', () => {
  for (let i = 0; i < 200000; i++) {
    const [lat] = ddmm(Math.random() * 180 - 90, true)
    assert.equal(lat.length, 10, `bad latitude width: ${lat}`)
    assert.ok(Number(lat.slice(2)) < 60, `latitude minutes >= 60: ${lat}`)

    const [lon] = ddmm(Math.random() * 360 - 180, false)
    assert.equal(lon.length, 11, `bad longitude width: ${lon}`)
    assert.ok(Number(lon.slice(3)) < 60, `longitude minutes >= 60: ${lon}`)
  }
})

test('ddmm picks the hemisphere from the sign', () => {
  assert.equal(ddmm(1, true)[1], 'N')
  assert.equal(ddmm(-1, true)[1], 'S')
  assert.equal(ddmm(1, false)[1], 'E')
  assert.equal(ddmm(-1, false)[1], 'W')
})

test('GLL framing is $body*CS with a valid checksum', () => {
  const at = new Date(Date.UTC(2026, 0, 2, 3, 4, 5))
  const s  = toGLL(-33.868, 151.209, at)

  assert.equal(s, '$IIGLL,3352.08000,S,15112.54000,E,030405.00,A*04')

  const [body, cs] = s.slice(1).split('*')
  assert.equal(nmeaChecksum(body), cs)
})

test('GLL timestamp is UTC and zero padded', () => {
  const at = new Date(Date.UTC(2026, 0, 2, 7, 8, 9))
  assert.match(toGLL(0, 0, at), /,070809\.00,A\*/)
})
