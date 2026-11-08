"""Unit tests with synthetic, non-sensitive traffic metadata."""
import unittest

from howdyknw import analyze, compare, valid_ip


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

    def test_ip_validation(self):
        self.assertEqual(valid_ip("2001:db8::1"), "2001:db8::1")
        with self.assertRaises(Exception):
            valid_ip("not-an-ip")


if __name__ == "__main__":
    unittest.main()
