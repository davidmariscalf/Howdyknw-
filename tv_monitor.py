#!/usr/bin/env python3
"""TV traffic metadata monitor. Requires TShark. Does not capture microphone audio."""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
import ipaddress
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

class TimeBounds:
    """Constant-memory observation range for long traffic captures."""

    def __init__(self):
        self.first = None
        self.last = None
        self.count = 0

    def append(self, value: float):
        if not math.isfinite(value) or value < 0:
            return
        self.first = value if self.first is None else min(self.first, value)
        self.last = value if self.last is None else max(self.last, value)
        self.count += 1


FIELDS = (
    "frame.time_epoch", "ip.src", "ip.dst", "ipv6.src", "ipv6.dst",
    "frame.len", "dns.qry.name", "dns.a", "dns.aaaa",
    "tls.handshake.extensions_server_name", "tcp.dstport", "udp.dstport",
)


def parse_line(raw: str, tv: str, stats: dict, dns_records: dict, times: list) -> bool:
    parts = raw.rstrip("\r\n").split("|")
    if len(parts) != len(FIELDS):
        return False
    (timestamp, src4, dst4, src6, dst6, length, dns_name, dns4,
     dns6, sni, tcp_port, udp_port) = parts
    source = (src4 or src6).split(",")[0]
    dest = (dst4 or dst6).split(",")[0]
    if source != tv and dest != tv:
        return False
    try:
        value = float(timestamp)
        if math.isfinite(value) and value >= 0:
            times.append(value)
    except ValueError:
        pass
    remote = dest if source == tv else source
    if not remote:
        return False
    item = stats[remote]
    item["packets"] += 1
    try:
        size = max(0, int(length))
    except ValueError:
        size = 0
    item["sent_bytes" if source == tv else "received_bytes"] += size
    if source == tv:
        port = (tcp_port or udp_port).split(",")[0]
        if port.isdigit():
            item["ports"].add(int(port))
        if sni:
            item["domains"].update(x.strip().lower() for x in sni.split(",") if x.strip())
    if dns_name and (dns4 or dns6):
        for raw_ip in (dns4 + "," + dns6).strip(",").split(","):
            try:
                resolved = str(ipaddress.ip_address(raw_ip.strip()))
            except ValueError:
                continue
            dns_records[resolved].update(
                x.strip().rstrip(".").lower() for x in dns_name.split(",") if x.strip()
            )
    return True


def make_report(tv: str, stats: dict, dns_records: dict, times: list,
                elapsed: float, from_pcap: bool) -> dict:
    destinations = []
    for ip, info in stats.items():
        destinations.append({
            "ip": ip,
            "domains": sorted(info["domains"] | dns_records.get(ip, set())),
            "sent_bytes": info["sent_bytes"],
            "received_bytes": info["received_bytes"],
            "packets": info["packets"],
            "ports": sorted(info["ports"]),
        })
    destinations.sort(
        key=lambda d: d["sent_bytes"] + d["received_bytes"], reverse=True
    )
    if isinstance(times, TimeBounds):
        first, last = times.first, times.last
    else:
        first = min(times) if times else None
        last = max(times) if times else None
    seconds = max(0, last - first) if from_pcap and times else elapsed
    return {
        "schema_version": 1,
        "source": "pcap" if from_pcap else "live_capture",
        "tv_ip": tv,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "first_observed_utc": (
            datetime.fromtimestamp(first, timezone.utc).isoformat() if first else None
        ),
        "last_observed_utc": (
            datetime.fromtimestamp(last, timezone.utc).isoformat() if last else None
        ),
        "seconds": round(seconds, 2),
        "destinations": destinations,
        "note": "Solo metadatos visibles en el punto de captura; no audio ni contenido HTTPS.",
    }


def write_report(path: Path, data: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Monitor de metadatos de Smart TV")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--interface", help="Interfaz con visibilidad de tráfico: tshark -D")
    group.add_argument("--pcap", help="Ruta de captura .pcap/.pcapng")
    parser.add_argument("--tv-ip", required=True, help="IP IPv4 o IPv6 de tu televisión")
    parser.add_argument("--output", default="data/report.json")
    parser.add_argument("--duration", type=int, default=0,
                        help="Segundos de captura (0: hasta Ctrl+C)")
    args = parser.parse_args(argv)
    try:
        tv = str(ipaddress.ip_address(args.tv_ip))
    except ValueError:
        parser.error("--tv-ip debe ser una dirección IPv4 o IPv6 válida")
    if args.duration < 0 or args.duration > 86400:
        parser.error("--duration debe estar entre 0 y 86400")
    if args.pcap and not Path(args.pcap).is_file():
        parser.error("No existe el archivo PCAP")
    tshark = shutil.which("tshark")
    if not tshark:
        parser.error("Instala TShark/Wireshark y añade tshark al PATH")

    command = [tshark, "-l", "-n"]
    if args.pcap:
        display_filter = ("ipv6.addr==" if ":" in tv else "ip.addr==") + tv
        command += ["-r", args.pcap, "-Y", display_filter]
    else:
        command += ["-i", args.interface, "-f", "host " + tv]
        if args.duration:
            command += ["-a", "duration:" + str(args.duration)]
    command += [
        "-T", "fields", "-E", "separator=|",
        "-E", "occurrence=a", "-E", "aggregator=,"
    ]
    for field in FIELDS:
        command.extend(["-e", field])

    stats = defaultdict(lambda: {
        "packets": 0, "sent_bytes": 0, "received_bytes": 0,
        "domains": set(), "ports": set()
    })
    dns_records = defaultdict(set)
    times = TimeBounds()
    started = time.monotonic()
    last_saved = started
    output = Path(args.output)
    write_report(output, make_report(tv, stats, dns_records, times, 0, bool(args.pcap)))

    print("Iniciando captura para", tv, "→", output, flush=True)
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as errorfile:
        try:
            proc = subprocess.Popen(
                command, stdout=subprocess.PIPE, stderr=errorfile,
                text=True, bufsize=1
            )
        except OSError as exc:
            print("No se pudo ejecutar TShark:", exc, file=sys.stderr)
            return 1
        interrupted = False
        try:
            for line in proc.stdout:
                parse_line(line, tv, stats, dns_records, times)
                now = time.monotonic()
                if now - last_saved >= 1:
                    write_report(output, make_report(
                        tv, stats, dns_records, times, now-started, bool(args.pcap)
                    ))
                    last_saved = now
        except KeyboardInterrupt:
            interrupted = True
            print("Deteniendo captura…", flush=True)
        finally:
            if proc.poll() is None:
                proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
            elapsed = time.monotonic() - started
            write_report(output, make_report(
                tv, stats, dns_records, times, elapsed, bool(args.pcap)
            ))
        if proc.returncode not in (0, -15, -2) and not interrupted:
            errorfile.seek(0)
            print("Error de TShark:", errorfile.read().strip(), file=sys.stderr)
            return 1
    print("Informe guardado:", output.resolve(), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
