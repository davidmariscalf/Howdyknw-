#!/usr/bin/env python3
"""Captura metadatos de red de una TV propia; no descifra contenido ni captura audio."""
import argparse
import collections
from datetime import datetime, timezone
import ipaddress
import json
from pathlib import Path
import shutil
import subprocess
import sys
import time


def main():
    p = argparse.ArgumentParser(description="Inspección de destinos de tráfico de Smart TV")
    group = p.add_mutually_exclusive_group(required=True)
    group.add_argument("--interface", help="Interfaz que ve el tráfico (tshark -D)")
    group.add_argument("--pcap", help="Captura .pcap/.pcapng existente")
    p.add_argument("--tv-ip", required=True, help="Dirección IPv4 de TU televisión")
    p.add_argument("--output", default="data/report.json")
    p.add_argument("--duration", type=int, default=0, help="Duración de captura en segundos (0: Ctrl+C)")
    args = p.parse_args()
    try:
        tv = str(ipaddress.IPv4Address(args.tv_ip))
    except ipaddress.AddressValueError:
        p.error("TV IP debe ser IPv4")
    if not shutil.which("tshark"):
        p.error("Falta tshark. Instala Wireshark/TShark y añade tshark al PATH.")
    if args.duration < 0:
        p.error("duration debe ser >= 0")
    if args.pcap and not Path(args.pcap).is_file():
        p.error("No existe el fichero de captura")
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    fields = ["ip.src", "ip.dst", "frame.len", "dns.qry.name", "dns.a",
              "tls.handshake.extensions_server_name", "tcp.dstport", "udp.dstport"]
    cmd = ["tshark", "-l", "-n"]
    if args.pcap:
        cmd += ["-r", args.pcap, "-Y", "ip.addr==" + tv]
    else:
        cmd += ["-i", args.interface, "-f", "host " + tv]
        if args.duration:
            cmd += ["-a", "duration:" + str(args.duration)]
    cmd += ["-T", "fields", "-E", "separator=|", "-E", "occurrence=a", "-E", "aggregator=,"]
    for field in fields:
        cmd += ["-e", field]

    stats = collections.defaultdict(lambda: {"sent_bytes":0,"received_bytes":0,"packets":0,"domains":set(),"ports":set()})
    dns_records = collections.defaultdict(set)
    last_save = 0
    start = time.monotonic()

    def save():
        destinations = []
        for ip, v in stats.items():
            destinations.append({
                "ip":ip, "domains":sorted(v["domains"] | dns_records.get(ip, set())),
                "sent_bytes":v["sent_bytes"], "received_bytes":v["received_bytes"],
                "packets":v["packets"], "ports":sorted(v["ports"])
            })
        destinations.sort(key=lambda d: d["sent_bytes"]+d["received_bytes"], reverse=True)
        report = {"schema_version":1, "tv_ip":tv, "updated_at":datetime.now(timezone.utc).isoformat(),
                  "seconds":round(time.monotonic()-start,1), "destinations":destinations,
                  "note":"Metadatos visibles en la captura, no todo el tráfico ni el contenido cifrado."}
        temp = output.with_suffix(output.suffix + ".tmp")
        temp.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(output)

    save()
    print("Monitorizando TV", tv, "| salida", output, flush=True)
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
    try:
        for raw in proc.stdout:
            parts = raw.rstrip("\r\n").split("|")
            if len(parts) != len(fields):
                continue
            source, dest, length, dns_name, dns_ips, sni, tcp_port, udp_port = parts
            if source != tv and dest != tv:
                continue
            remote = dest if source == tv else source
            if not remote:
                continue
            item = stats[remote]
            item["packets"] += 1
            try: size = int(length)
            except ValueError: size = 0
            item["sent_bytes" if source == tv else "received_bytes"] += size
            if source == tv:
                port = tcp_port or udp_port
                if port.isdigit():
                    item["ports"].add(int(port))
                if sni:
                    item["domains"].update(x.strip() for x in sni.split(",") if x.strip())
            if dns_name and dns_ips:
                for response_ip in dns_ips.split(","):
                    try: resolved = str(ipaddress.IPv4Address(response_ip.strip()))
                    except ipaddress.AddressValueError: continue
                    dns_records[resolved].update(x.strip() for x in dns_name.split(",") if x.strip())
            now = time.monotonic()
            if now - last_save >= 1:
                save()
                last_save = now
    except KeyboardInterrupt:
        print("Deteniendo...", flush=True)
    finally:
        if proc.poll() is None:
            proc.terminate()
        try:
            _, errors = proc.communicate(timeout=4)
        except subprocess.TimeoutExpired:
            proc.kill()
            _, errors = proc.communicate()
        save()
        if proc.returncode not in (0, -15, -2, None):
            print("TShark:", errors.strip(), file=sys.stderr)
        print("Informe:", output.resolve(), flush=True)


if __name__ == "__main__":
    main()
