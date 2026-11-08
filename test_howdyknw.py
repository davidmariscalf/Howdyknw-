"""Unit tests with synthetic, non-sensitive traffic metadata."""
import unittest
import csv
import io
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

from howdyknw import FIELDS, analyze, compare, read_capture, valid_ip


def packet(src="192.168.1.30", dst="1.2.3.4", length="100",
           dns="", sni="", port="443", time="1783526400.125"):
    return {
        "frame.time_epoch": time,
        "ip.src": src,
        "ipv6.src": "",
        "ip.dst": dst,
        "ipv6.dst": "",
        "frame.len": length,
        "_ws.col.Protocol": "TLSv1.3",
        "dns.qry.name": dns,
        "tls.handshake.extensions_server_name": sni,
        "tcp.dstport": port,
        "udp.dstport": "",
    }


class HowdyknwTests(unittest.TestCase):
    def test_outbound_counters_exclude_inbound(self):
        report = analyze([
            packet(),
            packet(length="200", sni="Example.org"),
            packet(src="1.2.3.4", dst="192.168.1.30", length="900"),
            packet(dst="8.8.8.8", dns="Example.org.", port="53"),
        ], "192.168.1.30", "on")
        self.assertEqual(report["outbound_packets"], 3)
        self.assertEqual(report["inbound_packets"], 1)
        self.assertEqual(report["outbound_frame_bytes"], 400)
        self.assertEqual(report["dns_queries"], ["example.org"])
        self.assertEqual(report["destinations"][0]["tls_sni"], ["example.org"])
        self.assertEqual(report["label"], "on")

    def test_destination_diff(self):
        first = analyze([packet()], "192.168.1.30", "on")
        second = analyze([packet(dst="4.3.2.1")], "192.168.1.30", "standby")
        report = compare(first, second)
        self.assertEqual(report["new_destinations"][0]["ip"], "4.3.2.1")
        self.assertEqual(report["disappeared_destinations"][0]["ip"], "1.2.3.4")

    def test_empty_and_scope(self):
        report = analyze([], "192.168.1.30")
        self.assertEqual(report["outbound_packets"], 0)
        self.assertIsNone(report["first_outbound_utc"])
        record = analyze([packet(dst="192.168.1.1")], "192.168.1.30")
        self.assertEqual(record["destinations"][0]["scope"], "local_or_special")

    def test_requires_same_tv(self):
        a = analyze([], "192.168.1.1")
        b = analyze([], "192.168.1.2")
        with self.assertRaises(ValueError):
            compare(a, b)

    def test_analyzer_accepts_streaming_generator_and_nan_timestamp(self):
        rows = (packet(time="nan" if i == 2 else str(1000 + i))
                for i in range(100))
        result = analyze(rows, "192.168.1.30")
        self.assertEqual(result["outbound_packets"], 100)
        self.assertEqual(result["first_outbound_utc"], "1970-01-01T00:16:40+00:00")
        self.assertEqual(result["last_outbound_utc"], "1970-01-01T00:18:19+00:00")

    def test_pcap_reader_yields_csv_rows_without_buffering_all_packets(self):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([str(i) for i in range(len(FIELDS))])
        fake = MagicMock()
        fake.stdout = io.StringIO(output.getvalue())
        fake.wait.return_value = 0
        fake.poll.return_value = 0
        with tempfile.TemporaryDirectory() as directory:
            pcap = Path(directory) / "sample.pcapng"
            pcap.write_bytes(b"not a real pcap, mocked TShark output")
            with patch("howdyknw.subprocess.Popen", return_value=fake):
                stream = read_capture(pcap, "tshark")
                row = next(stream)
                self.assertEqual(row[FIELDS[0]], "0")
                self.assertEqual(row[FIELDS[-1]], str(len(FIELDS) - 1))
                with self.assertRaises(StopIteration):
                    next(stream)

    def test_ip_validation(self):
        self.assertEqual(valid_ip("2001:db8::1"), "2001:db8::1")
        with self.assertRaises(Exception):
            valid_ip("not-an-ip")


if __name__ == "__main__":
    unittest.main()
