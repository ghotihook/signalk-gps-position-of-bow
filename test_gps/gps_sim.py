#!/usr/bin/env python3
"""
Simulated high-speed GPS position sensor.

Encodes PGN 129025 (Position, Rapid Update) using the nmea2000 library and
broadcasts YDWG RAW format UDP frames at the configured rate.

Default location: Sydney Cove / Circular Quay (-33.8568°, 151.2153°)
"""

import argparse
import socket
import time
from datetime import datetime

from nmea2000 import NMEA2000Message, NMEA2000Field, NMEA2000Encoder
from nmea2000.consts import FieldTypes, PhysicalQuantities
from nmea2000.input_formats import N2KFormat

# Sydney Cove / Circular Quay — close to the Opera House
DEFAULT_LAT = -33.8568
DEFAULT_LON = 151.2153

DEFAULT_HZ = 10
DEFAULT_SRC = 209
DEFAULT_PRIORITY = 2
DEFAULT_PORT = 2000
DEFAULT_BROADCAST = "255.255.255.255"


def make_frame(encoder: NMEA2000Encoder, lat: float, lon: float, src: int, priority: int) -> str:
    """Build one YDWG RAW text frame for PGN 129025."""
    msg = NMEA2000Message(
        PGN=129025,
        id="positionRapidUpdate",
        description="Position, Rapid Update",
        priority=priority,
        source=src,
        destination=255,
    )
    msg.timestamp = datetime.now()
    msg.fields = [
        NMEA2000Field(id="latitude", name="Latitude", unit_of_measurement="deg",
                      value=lat, physical_quantities=PhysicalQuantities.GEOGRAPHICAL_LATITUDE,
                      type=FieldTypes.NUMBER),
        NMEA2000Field(id="longitude", name="Longitude", unit_of_measurement="deg",
                      value=lon, physical_quantities=PhysicalQuantities.GEOGRAPHICAL_LONGITUDE,
                      type=FieldTypes.NUMBER),
    ]
    # CAN_FRAME_ASCII_RAW produces: "HH:MM:SS.mmm R XXXXXXXX XX XX XX XX XX XX XX XX"
    return encoder.encode(msg)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Broadcast simulated GPS position as YDWG RAW UDP (PGN 129025)"
    )
    parser.add_argument("--lat", type=float, default=DEFAULT_LAT,
                        help=f"Latitude in degrees (default: {DEFAULT_LAT})")
    parser.add_argument("--lon", type=float, default=DEFAULT_LON,
                        help=f"Longitude in degrees (default: {DEFAULT_LON})")
    parser.add_argument("--hz", type=float, default=DEFAULT_HZ,
                        help=f"Transmit rate in Hz (default: {DEFAULT_HZ})")
    parser.add_argument("--src", type=int, default=DEFAULT_SRC,
                        help=f"NMEA 2000 source address (default: {DEFAULT_SRC})")
    parser.add_argument("--priority", type=int, default=DEFAULT_PRIORITY,
                        help=f"NMEA 2000 priority 0-7 (default: {DEFAULT_PRIORITY})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"UDP destination port (default: {DEFAULT_PORT})")
    parser.add_argument("--broadcast", default=DEFAULT_BROADCAST,
                        help=f"Broadcast address (default: {DEFAULT_BROADCAST})")
    args = parser.parse_args()

    interval = 1.0 / args.hz

    # Encoder instance is reusable; timestamp is taken from each NMEA2000Message.
    encoder = NMEA2000Encoder(output_format=N2KFormat.CAN_FRAME_ASCII_RAW)

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)

        print(f"PGN 129025 Position Rapid Update  →  {args.broadcast}:{args.port}")
        print(f"  lat={args.lat:.6f}  lon={args.lon:.6f}  "
              f"rate={args.hz} Hz  src={args.src}  priority={args.priority}")
        print("Ctrl-C to stop\n")

        next_tx = time.monotonic()
        while True:
            frame = make_frame(encoder, args.lat, args.lon, args.src, args.priority)
            sock.sendto((frame + "\r\n").encode("ascii"), (args.broadcast, args.port))
            print(frame)

            next_tx += interval
            delay = next_tx - time.monotonic()
            if delay > 0:
                time.sleep(delay)


if __name__ == "__main__":
    main()
