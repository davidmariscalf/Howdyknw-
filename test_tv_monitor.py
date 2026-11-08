"""Unit tests for the TShark report parser, without network access."""
import unittest
from collections import defaultdict

from tv_monitor import FIELDS, TimeBounds, make_report, parse_line


def make_fields(**values):
    fields = {name: "" for name in FIELDS}
    fields.update(values)
    return "|".join(fields[name] for name in FIELDS) + "\n"


def stats_factory():
    return defaultdict(lambda: {
        "packets": 0, "sent_bytes": 0, "received_bytes": 0,
        "domains": set(), "ports": set()
    })


class TvMonitorTests(unittest.TestCase):
    def setUp(self):
        self.tv = "2001:db8::50"
        self.stats = stats_factory()
        self.dns = defaultdict(set)
        self.times = []

    def test_ipv6_outbound_and_inbound(self):
        self.assertTrue(parse_line(make_fields(**{
            "frame.time_epoch": "1794000000",
            "ipv6.src": self.tv,
            "ipv6.dst": "2001:db8::100",
            "frame.len": "150",
            "tls.handshake.extensions_server_name": "EXAMPLE.org",
            "tcp.dstport": "443",
        }), self.tv, self.stats, self.dns, self.times))
        self.assertTrue(parse_line(make_fields(**{
            "frame.time_epoch": "1794000180",
            "ipv6.src": "2001:db8::100",
            "ipv6.dst": self.tv,
            "frame.len": "120",
        }), self.tv, self.stats, self.dns, self.times))
        report = make_report(self.tv, self.stats, self.dns, self.times, 1.0, True)
        self.assertEqual(report["destinations"][0]["sent_bytes"], 150)
        self.assertEqual(report["destinations"][0]["received_bytes"], 120)
        self.assertEqual(report["destinations"][0]["ports"], [443])
        self.assertEqual(report["destinations"][0]["domains"], ["example.org"])
        self.assertEqual(report["seconds"], 180)

    def test_large_capture_uses_constant_memory(self):
        times = TimeBounds()
        for timestamp in range(100000):
            times.append(float(1794000000 + timestamp))
        self.assertEqual(times.count, 100000)
        self.assertEqual(times.first, 1794000000)
        self.assertEqual(times.last, 1794099999)
        report = make_report(self.tv, self.stats, self.dns, times, 0, True)
        self.assertEqual(report["seconds"], 99999)
        times.append(float("nan"))
        self.assertEqual(times.count, 100000)

    def test_dns_aaaa_mapping(self):
        parse_line(make_fields(**{
            "frame.time_epoch": "1794000020",
            "ipv6.src": "2001:db8::1",
            "ipv6.dst": self.tv,
            "frame.len": "90",
            "dns.qry.name": "Video.EXAMPLE.",
            "dns.aaaa": "2001:db8::100"
        }), self.tv, self.stats, self.dns, self.times)
        self.assertIn("video.example", self.dns["2001:db8::100"])

    def test_irrelevant_traffic_and_empty_capture(self):
        self.assertFalse(parse_line(make_fields(**{
            "frame.time_epoch": "1794000040",
            "ipv6.src": "2001:db8::1",
            "ipv6.dst": "2001:db8::2",
            "frame.len": "80",
        }), self.tv, self.stats, self.dns, self.times))
        report = make_report(self.tv, self.stats, self.dns, self.times, 30.0, True)
        self.assertEqual(report["seconds"], 30.0)
        self.assertEqual(report["destinations"], [])


if __name__ == "__main__":
    unittest.main()
