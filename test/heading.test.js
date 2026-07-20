'use strict'

// Heading selection.
//
// The projection rotates a boat-relative offset into an east/north frame, which
// is TRUE north. Magnetic heading rotates the whole correction by the local
// variation — ~12 degrees in Sydney, which on an 8 m offset misplaces the bow by
// ~1.7 m, the same order as the correction itself. So true heading is required,
// and bare magnetic must never be silently substituted for it.

const { test } = require('node:test')
const assert   = require('node:assert')

const { trueHeading } = require('..')._internal

const DEG = Math.PI / 180
const appWith = (paths) => ({
  getSelfPath: (p) => (paths[p] !== undefined ? { value: paths[p] } : undefined)
})

test('headingTrue is used directly when present', () => {
  const got = trueHeading(appWith({ 'navigation.headingTrue': 1.234 }))
  assert.equal(got.heading, 1.234)
  assert.equal(got.from, 'headingTrue')
})

test('headingTrue wins over magnetic even when both are present', () => {
  const got = trueHeading(appWith({
    'navigation.headingTrue': 1.0,
    'navigation.headingMagnetic': 2.0,
    'navigation.magneticVariation': 0.5
  }))
  assert.equal(got.heading, 1.0)
})

test('magnetic plus variation is derived when headingTrue is absent', () => {
  // Sydney: ~12.5 degrees east variation. True = magnetic + variation.
  const got = trueHeading(appWith({
    'navigation.headingMagnetic': 45 * DEG,
    'navigation.magneticVariation': 12.5 * DEG
  }))
  assert.ok(Math.abs(got.heading - 57.5 * DEG) < 1e-12, `got ${got.heading / DEG}`)
  assert.match(got.from, /magneticVariation/)
})

test('a westerly (negative) variation subtracts', () => {
  const got = trueHeading(appWith({
    'navigation.headingMagnetic': 45 * DEG,
    'navigation.magneticVariation': -10 * DEG
  }))
  assert.ok(Math.abs(got.heading - 35 * DEG) < 1e-12, `got ${got.heading / DEG}`)
})

test('the derived heading is normalised into 0..2pi', () => {
  const over = trueHeading(appWith({
    'navigation.headingMagnetic': 355 * DEG,
    'navigation.magneticVariation': 20 * DEG
  }))
  assert.ok(Math.abs(over.heading - 15 * DEG) < 1e-12, `wrap past 360: ${over.heading / DEG}`)

  const under = trueHeading(appWith({
    'navigation.headingMagnetic': 5 * DEG,
    'navigation.magneticVariation': -20 * DEG
  }))
  assert.ok(Math.abs(under.heading - 345 * DEG) < 1e-12, `wrap below 0: ${under.heading / DEG}`)
})

test('magnetic heading alone is refused rather than used as-is', () => {
  // The dangerous case: it would look like it was working while being wrong by
  // metres. Better to emit nothing and say why.
  assert.equal(trueHeading(appWith({ 'navigation.headingMagnetic': 45 * DEG })), null)
})

test('no heading at all is refused', () => {
  assert.equal(trueHeading(appWith({})), null)
})

test('a zero variation is honoured, not treated as missing', () => {
  // Guards against a truthiness check: variation is legitimately 0 in places.
  const got = trueHeading(appWith({
    'navigation.headingMagnetic': 45 * DEG,
    'navigation.magneticVariation': 0
  }))
  assert.ok(got !== null, 'zero variation should still yield a heading')
  assert.ok(Math.abs(got.heading - 45 * DEG) < 1e-12)
})

test('a zero heading is honoured, not treated as missing', () => {
  const got = trueHeading(appWith({ 'navigation.headingTrue': 0 }))
  assert.ok(got !== null, 'due north should not be mistaken for no data')
  assert.equal(got.heading, 0)
})
