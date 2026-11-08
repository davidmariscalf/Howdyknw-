#!/usr/bin/env python3
"""Howdyknw - audit network metadata from a TV you own.

Requires TShark (Wireshark). This tool cannot access the TV microphone
or read encrypted voice content.
"""
from __future__ import annotations

import argparse
import csv
import ipaddress
import json
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path

FIELDS = (
    "frame.time_epoch",
    "ip.src",
    "ipv6.src",
    "ip.dst",
    "ipv6.dst",
    "frame.len",
    "_ws.col.Protocol",
    "dns.qry.name",
    "tls.handshake.extensions_server_name",
    "tcp.dstport",
    "udp.dstport",
)


def valid_ip(text: str) -> str:
    try:
        return str(ipaddress.ip_address(text))
    except ValueError as exc:
        raise argparse.ArgumentTypeError("Expected an IPv4 or IPv6 address") from exc


def tshark_exe(name: str) -> str:
    result = shutil.which(name)
    if not result:
        raise RuntimeError(
            f"TShark not found: {name}. Install Wireshark with TShark, "
            "and put tshark in PATH, or specify --tshark."
        )
    return result


def read_capture(path: Path, executable: str) -> list[dict[str, str]]:
    if not path.is_file():
        raise FileNotFoundError(path)
    cmd = [executable, "-r", str(path), "-T", "fields"]
    for field in FIELDS:
        cmd.extend(("-e", field))
    cmd.extend(("-E", "separator=,", "-E", "quote=d", "-E", "occurrence=f"))
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    rows = csv.reader(StringIO(result.stdout))
    return [
        dict(zip(FIELDS, (part.strip() for part in row)))
        for row in rows if len(row) == len(FIELDS)
    ]


def _timestamp(seconds: float | None) -> str | None:
    if seconds is None:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat()


def analyze(rows: list[dict[str, str]], tv_ip: str, label: str = "") -> dict:
    """Only attribute outgoing packets with source equal to tv_ip."""
    destinations = defaultdict(lambda: {
        "packets": 0, "bytes": 0, "tls_sni": set()
    })
    dns_queries: set[str] = set()
    all_times: list[float] = []
    outbound = 0
    total_bytes = 0
    inbound = 0

    for packet in rows:
        src = packet.get("ip.src") or packet.get("ipv6.src") or ""
        dst = packet.get("ip.dst") or packet.get("ipv6.dst") or ""
        if not src or not dst:
            continue
        if dst == tv_ip:
            inbound += 1
        if src != tv_ip:
            continue
        try:
            all_times.append(float(packet["frame.time_epoch"]))
        except (KeyError, ValueError):
            pass
        try:
            frame_size = max(0, int(packet.get("frame.len") or 0))
        except ValueError:
            frame_size = 0
        port = packet.get("tcp.dstport") or packet.get("udp.dstport") or ""
        record = destinations[(dst, port)]
        record["packets"] += 1
        record["bytes"] += frame_size
        if packet.get("tls.handshake.extensions_server_name"):
            record["tls_sni"].add(
                packet["tls.handshake.extensions_server_name"].lower()
            )
        if packet.get("dns.qry.name"):
            dns_queries.add(packet["dns.qry.name"].rstrip(".").lower())
        outbound += 1
        total_bytes += frame_size

    formatted = []
    for (dst, port), record in destinations.items():
        address = ipaddress.ip_address(dst)
        formatted.append({
            "ip": dst,
            "port": port or None,
            "scope": "local_or_special" if not address.is_global else "public",
            "packets": record["packets"],
            "bytes": record["bytes"],
            "tls_sni": sorted(record["tls_sni"]),
        })
    formatted.sort(key=lambda r: (-r["bytes"], -r["packets"], r["ip"]))

    return {
        "schema": 1,
        "source": "tshark_capture",
        "tv_ip": tv_ip,
        "label": label,
        "first_outbound_utc": _timestamp(min(all_times)) if all_times else None,
        "last_outbound_utc": _timestamp(max(all_times)) if all_times else None,
        "outbound_packets": outbound,
        "inbound_packets": inbound,
        "outbound_frame_bytes": total_bytes,
        "dns_queries": sorted(dns_queries),
        "destinations": formatted,
        "limits": [
            "Capture must be made at a point that actually sees TV network packets.",
            "DNS queries are separate from destination attribution.",
            "TLS SNI is visible only for some encrypted connections.",
            "The network metadata does not reveal encrypted content or prove audio uploads.",
            "No packets observed cannot rule out local microphone processing.",
        ],
    }


def compare(a: dict, b: dict) -> dict:
    if a.get("tv_ip") != b.get("tv_ip"):
        raise ValueError("Reports must contain the same TV IP")
    def get_map(report: dict) -> dict:
        return {
            (item["ip"], str(item.get("port") or "")): item
            for item in report.get("destinations", [])
        }
    before = get_map(a)
    after = get_map(b)
    newly_seen = sorted(after.keys() - before.keys())
    no_longer_seen = sorted(before.keys() - after.keys())
    result = {
        "schema": 1,
        "source": "comparison",
        "tv_ip": a["tv_ip"],
        "before_label": a.get("label", ""),
        "after_label": b.get("label", ""),
        "before_outbound_packets": a.get("outbound_packets", 0),
        "after_outbound_packets": b.get("outbound_packets", 0),
        "before_outbound_frame_bytes": a.get("outbound_frame_bytes", 0),
        "after_outbound_frame_bytes": b.get("outbound_frame_bytes", 0),
        "new_destinations": [after[k] for k in newly_seen],
        "disappeared_destinations": [before[k] for k in no_longer_seen],
        "common_destinations": len(before.keys() & after.keys()),
        "limits": [
            "Different capture durations can distort packet and byte comparisons.",
            "New destinations do not prove voice recording or data exfiltration.",
        ],
    }
    return result


def write_report(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Howdyknw: monitor outbound TV network metadata."
    )
    parser.add_argument("--tshark", default="tshark", help="TShark executable path")
    actions = parser.add_subparsers(dest="command", required=True)

    capture = actions.add_parser("capture", help="Capture packets at a router/mirror")
    capture.add_argument("--tv-ip", type=valid_ip, required=True)
    capture.add_argument("--interface", required=True, help="From 'tshark -D'")
    capture.add_argument("--seconds", type=int, default=120)
    capture.add_argument("--out", type=Path, required=True)

    report = actions.add_parser("analyze", help="Analyze a TV pcap/pcapng file")
    report.add_argument("--tv-ip", type=valid_ip, required=True)
    report.add_argument("--pcap", type=Path, required=True)
    report.add_argument("--label", default="")
    report.add_argument("--out", type=Path, required=True)

    diff = actions.add_parser("compare", help="Compare two JSON reports")
    diff.add_argument("--before", type=Path, required=True)
    diff.add_argument("--after", type=Path, required=True)
    diff.add_argument("--out", type=Path, required=True)

    args = parser.parse_args(argv)
    try:
        if args.command == "capture":
            if not 1 <= args.seconds <= 86400:
                parser.error("--seconds must be between 1 and 86400")
            args.out.parent.mkdir(parents=True, exist_ok=True)
            cmd = [
                tshark_exe(args.tshark), "-i", args.interface,
                "-f", f"host {args.tv_ip}", "-a", f"duration:{args.seconds}",
                "-w", str(args.out)
            ]
            subprocess.run(cmd, check=True)
            print(f"Capture saved to {args.out}")
        elif args.command == "analyze":
            data = analyze(
                read_capture(args.pcap, tshark_exe(args.tshark)),
                args.tv_ip,
                args.label,
            )
            write_report(args.out, data)
            print(
                f"Outgoing: {data['outbound_packets']} packets, "
                f"{len(data['destinations'])} destinations. Report: {args.out}"
            )
        else:
            a = json.loads(args.before.read_text(encoding="utf-8"))
            b = json.loads(args.after.read_text(encoding="utf-8"))
            data = compare(a, b)
            write_report(args.out, data)
            print(
                f"New destinations: {len(data['new_destinations'])}. "
                f"Comparison: {args.out}"
            )
    except (OSError, RuntimeError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
