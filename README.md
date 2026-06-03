# signalk-gps-position-of-bow

Signal K plugin that calculates the GPS position of the bow from the antenna's known placement on the vessel and the current magnetic heading.

Reads `navigation.position` (GPS antenna position) and `navigation.headingMagnetic`, and emits `navigation.bowPosition`.

---

## Installation (server — once)

```bash
git clone git@github.com:ghotihook/signalk-gps-position-of-bow ~/signalk-gps-position-of-bow
cd ~/.signalk
npm install ~/signalk-gps-position-of-bow
sudo systemctl restart signalk
```

Then enable the plugin in the Signal K plugin config UI.

---

## Development workflow

```bash
# Mac — after making changes
git add -p && git commit -m "describe change" && git push

# Server
git -C ~/signalk-gps-position-of-bow pull && sudo systemctl restart signalk
```

Enable debug logging in the Signal K admin UI to see per-update log lines:
```
antenna: lat=-33.865143 lon=151.209900 heading=45.2° fromBow=8.5m fromCenter=-0.3m
bow: lat=-33.864982 lon=151.210034 (east=6.23m north=17.89m)
```

---

## Configuration

Antenna placement is read from the Signal K data model — set these paths via your GPS source or another plugin:

| Path | Description |
|------|-------------|
| `sensors.gps.fromBow` | Distance in metres from the GPS antenna to the bow along the centreline |
| `sensors.gps.fromCenter` | Lateral offset in metres from the centreline — negative = starboard |

---

## How it works

The plugin uses `subscriptionmanager.subscribe` with `sourcePolicy: 'all'`, which delivers every incoming position delta from every source at full rate. On each update:

1. `navigation.headingMagnetic`, `sensors.gps.fromBow`, and `sensors.gps.fromCenter` are read from the data model
2. The antenna offset is projected forward and sideways using the heading to compute the bow's lat/lon
3. The result is emitted to `navigation.bowPosition` via `handleMessage`

Since the plugin reads from `navigation.position` and writes to `navigation.bowPosition`, there is no source priority conflict and no loop guard is required.

**Note:** currently uses `navigation.headingMagnetic` — switch to `navigation.headingTrue` once magnetic variation is available.
