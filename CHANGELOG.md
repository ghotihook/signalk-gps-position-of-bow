# Changelog

## Unreleased

- **Output can now go over TCP as well as UDP.** A new *Transport* setting selects between them;
  TCP opens a client connection, retries every 5 s if it drops, and reports link state in the
  status line. UDP remains the default and existing `udpAddress`/`udpPort` settings are still
  honoured, so upgrades need no reconfiguration.
- **True heading is now required, and magnetic heading alone is refused.** The projection rotates
  into an east/north frame, so magnetic heading rotated the whole correction by the local
  variation — about 1.7 m of error on an 8 m offset in Sydney, the same order as the correction
  itself. True heading is taken from `navigation.headingTrue`, or derived from
  `navigation.headingMagnetic` + `navigation.magneticVariation`. With only magnetic heading
  available the plugin now emits nothing and says why, rather than being quietly wrong.
- The Dependencies panel shows the heading inputs separately and which route is in use.

- Packaged for the Signal K App Store: full package metadata, Apache-2.0 licence file,
  App Store category keywords, and a Node 20.10 floor matching the ecosystem.
- Added a test suite (`npm test`) covering coordinate formatting and projection geometry.
- Fixed coordinate minutes below ten losing their leading zero — `ddmm.mmmmm` was emitted
  one character short, shifting every field after it in the sentence.
- Fixed minutes rounding up to `60.00000` instead of carrying into the degrees.
- Added a self-source guard to the delta handler. Setting the output path to
  `navigation.position` previously fed the plugin's own output back into its handler and
  recursed until the stack overflowed.
- Plugin description corrected — it advertised XDR output, but GLL is what is sent.
- Documented the `fromCenter` sign convention against the Signal K definition ("-ve to
  starboard, +ve to port") and covered it with tests. No behaviour change — the projection
  was already correct.
- README rewritten to describe what the plugin currently does — the previous version predated
  the GLL output and the configurable output path.

## 0.1.0

First release. Projects the GPS antenna's fix forward to the bow using the antenna offsets and
magnetic heading, publishes the result to Signal K, and broadcasts it as an NMEA 0183 GLL
sentence over UDP.
