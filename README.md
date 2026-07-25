# signalk-gps-position-of-bow

[![CI](https://github.com/ghotihook/signalk-gps-position-of-bow/actions/workflows/signalk-ci.yml/badge.svg)](https://github.com/ghotihook/signalk-gps-position-of-bow/actions/workflows/signalk-ci.yml)

Reports the position of your **bow** rather than the position of your **GPS antenna**.

**Who it's for.** Racing sailors working start lines and marks, where the few metres between a
transom-mounted antenna and the bow decide whether you are over early.

**What it does.** Takes the antenna's fix, its known offset on the vessel, and the current
heading, and projects the fix forward to the bow. The result is sent out on the network as an
NMEA 0183 GLL sentence for instruments and tactical software that want it in that form.

## Quick start

1. **Install.** Not yet published to the Signal K App Store — install from source for now
   (Node 20.10 or later):

   ```bash
   git clone https://github.com/ghotihook/signalk-gps-position-of-bow ~/signalk-gps-position-of-bow
   cd ~/.signalk && npm install ~/signalk-gps-position-of-bow
   sudo systemctl restart signalk
   ```

   Then enable it in **Server → Plugin Config**.
2. **Set the transport and destination** for the GLL sentence, or leave the defaults to broadcast
   over UDP.
3. **Check the status line** in the plugin list. It should read
   `Active →udp 255.255.255.255:1183 — antenna 8.5m fwd, 0.3m stbd | bow -33.864982, 151.210034`
   (that `stbd` comes from a `fromCenter` of −0.3).

   If an input is missing it says so and names the path, e.g.
   `Active →udp 255.255.255.255:1183 — waiting for sensors.gps.fromBow`. See
   [Inputs](#inputs).

---

## Inputs

The plugin reads these from the Signal K data model. It emits nothing until all of them are
present.

| Path | What it is |
|------|------------|
| `navigation.position` | The GPS antenna's fix — supplied by your GPS |
| `navigation.headingTrue` | Vessel heading, radians. Or `navigation.headingMagnetic` **plus** `navigation.magneticVariation`, from which true heading is derived |
| `sensors.gps.fromBow` | Metres from the antenna to the bow, along the centreline |
| `sensors.gps.fromCenter` | Metres from the antenna to the centreline — **negative to starboard, positive to port** |

The two `sensors.gps.*` offsets are fixed properties of your installation. Measure them once and
set them from your GPS source or another plugin — they are not plugin settings.

> **Sign convention.** `fromCenter` follows the Signal K definition: *"the distance from the
> centerline to the sensor location, -ve to starboard, +ve to port"*. So a starboard-mounted
> antenna takes a **negative** value. If your bow position appears mirrored across the
> centreline, this is the sign to check first.

### Heading, not course

The projection uses **heading** — where the bow points — not course over ground. A boat making
leeway is not travelling the way it is pointing, and it is the pointing that puts the bow over
the line.

### It must be *true* heading

The projection rotates the antenna offset into an east/north frame, and that frame is true north.
Magnetic heading rotates the entire correction by the local magnetic variation:

| Variation | Error on an 8 m offset |
|-----------|------------------------|
| 5° | 0.7 m |
| 12.5° (Sydney) | **1.7 m** |
| 20° | 2.7 m |

That is the same order as the correction itself — enough to undo the point of the plugin. So the
plugin requires true heading, and takes it from either:

1. `navigation.headingTrue` directly, or
2. `navigation.headingMagnetic` + `navigation.magneticVariation`, combined as `true = magnetic +
   variation`.

**Magnetic heading on its own is refused.** If it is all that is available, the plugin emits
nothing and says so in the status line rather than producing a position that looks right and is
quietly out by metres. Debug logging shows which route is being used.

If you only have magnetic heading, the usual fix is a plugin that supplies
`navigation.magneticVariation` from the WMM model and your position — after which the second
route above works automatically.

---

## Settings

| Setting | Default | What it does |
|---------|---------|--------------|
| Transport | `UDP` | `UDP` for datagrams, `TCP` for a client connection — see below |
| Destination address | `255.255.255.255` | Where the GLL sentence is sent. The default broadcasts to the local network |
| Destination port | `1183` | Destination port |
| TCP connect timeout (s) | `5` | TCP only. Stops a host that silently drops packets from stalling for the OS timeout (~2 min) before retrying |

### TCP or UDP?

**UDP** is fire-and-forget. Nothing confirms the instrument received anything, but it suits
devices that only listen, and it is the only option that can broadcast — the default
`255.255.255.255` reaches everything on the local network without knowing any addresses.

**TCP** opens a client connection to the destination and retries every 5 s if it drops. Because
the link has state, the plugin can tell you when it is broken: the status line reads
`Active →tcp 192.168.0.2:1183 (no link: error: ECONNREFUSED)`. UDP can never report this — a
misconfigured port looks identical to a working one.

Use TCP when the destination is a specific device that accepts connections and you want to know
the link is up. Use UDP for broadcast, or for devices that only listen.

> Settings saved before TCP was an option used the names `udpAddress` and `udpPort`. Those are
> still read as a fallback, so existing installs keep working untouched and stay on UDP.

---

## What is sent

One GLL sentence per incoming position fix, at whatever rate your GPS updates:

```
$IIGLL,3352.08000,S,15112.54000,E,030405.00,A*04
```

| Field | Value |
|-------|-------|
| Talker | `II` — integrated instrumentation |
| Latitude | `ddmm.mmmmm` + `N`/`S` |
| Longitude | `dddmm.mmmmm` + `E`/`W` |
| Time | UTC `hhmmss.00` at the moment of sending |
| Status | `A` — valid |

The five decimal places on minutes give roughly 2 cm of resolution, which is finer than the
underlying fix but avoids rounding away any of it.

**The sentence goes out over the network.** If your instrument has a serial NMEA 0183 input,
something has to bridge the two — a serial device server, or `socat` on any Linux box with a
USB-to-serial adapter:

```bash
socat UDP-RECV:1183 /dev/ttyUSB0,b4800,raw          # transport = udp
socat TCP-LISTEN:1183,reuseaddr,fork /dev/ttyUSB0,b4800,raw   # transport = tcp
```

Note the plugin sends one sentence per position fix, at whatever rate your GPS updates. A GLL
sentence is ~48 characters, and a 4800-baud link carries about 480 characters per second — so a
10 Hz GPS uses roughly the whole link. If you are bridging to 4800 baud from a high-rate source,
watch for dropped or corrupted sentences.

---

## How the projection works

On each `navigation.position` delta:

1. True heading and the two antenna offsets are read from the data model.
2. The offset vector is rotated from boat-relative into north/east metres:

   ```
   east  = fromBow·sin(heading) + fromCenter·cos(heading)
   north = fromBow·cos(heading) − fromCenter·sin(heading)
   ```

   Note the offsets describe where the *antenna* sits, so the correction runs the other way: an
   antenna mounted to starboard means the bow, on the centreline, lies to port of it. Heading
   north with `fromBow = 8` and `fromCenter = −0.3`, the bow is 8 m north and 0.3 m west.

3. Those metres are converted to degrees on a spherical earth (R = 6 371 000 m), with the
   longitude step scaled by `cos(latitude)` for meridian convergence.
4. The result is sent as a GLL sentence.

A spherical earth is used rather than the WGS-84 ellipsoid. Over offsets of a few metres the
difference is well under a millimetre — far below GPS noise.

---

## Development

```bash
npm test          # node --test — coordinate formatting and projection geometry
```

`test_gps/gps_sim.py` feeds synthetic position and heading data into a local Signal K server for
testing without being on the water.

Install from a working copy on the server:

```bash
cd ~/.signalk && npm install file:/home/alex060/signalk-gps-position-of-bow
sudo systemctl restart signalk
```

Enable debug logging in the admin UI to see per-update lines:

```
antenna: lat=-33.865143 lon=151.209900 heading=45.2°T (headingTrue) fromBow=8.5m fromCenter=-0.3m
bow: $IIGLL,3351.89892,S,15112.60204,E,030405.00,A*0C
```

---

## Licence

Apache-2.0. See [LICENSE](LICENSE).
