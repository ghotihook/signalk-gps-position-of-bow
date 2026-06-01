# signalk-gps-position-of-bow

Signal K plugin that calculates the GPS position of the bow using the antenna's known placement on the vessel and the current magnetic heading.

Emits `navigation.bowPosition` with `latitude` and `longitude`.

## Configuration

| Field | Description |
|-------|-------------|
| `sensors.gps.fromBow` | Distance (m) from GPS antenna to bow along centreline |
| `sensors.gps.fromCenter` | Lateral offset (m) of GPS antenna from centreline — negative = starboard |
| Update interval (ms) | How often to recalculate (default 1000) |

The `fromBow` and `fromCenter` values are read from the Signal K data model (e.g. set by your GPS source or another plugin).

## Install on server

```bash
git clone git@github.com:ghotihook/signalk-gps-position-of-bow ~/signalk-gps-position-of-bow
cd ~/.signalk
npm install file:/home/alex060/signalk-gps-position-of-bow
sudo systemctl restart signalk
```

## Update

```bash
# Mac
git push

# Server
git -C ~/signalk-gps-position-of-bow pull && sudo systemctl restart signalk
```

## Notes

- Currently uses `navigation.headingMagnetic` — switch to `navigation.headingTrue` when magnetic variation is available.
- Negative `fromCenter` means the antenna is to starboard of centreline.
