import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import operator_telemetry as telemetry


class TelemetryTests(unittest.TestCase):
    def test_summary_rates_and_latency(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "metrics.jsonl"
            with patch.object(telemetry, "METRICS_PATH", path):
                telemetry.record("resolve", "CI.GITHUB", "DELEGATE_CONNECTOR", "ok", 10, False, False, True)
                telemetry.record("dispatch", "CI.LINK", "CI.LINK", "ok", 20, True, True, False)
                telemetry.record("provider_read", "CI.GITHUB", "ORANGE_PROVIDER_READ", "error", 30, True, False, False, "boom")
                result = telemetry.summary(100)
            self.assertEqual(result["window"], 3)
            self.assertEqual(result["kpi"]["successRate"], 0.6667)
            self.assertEqual(result["kpi"]["evidenceCompleteness"], 0.5)
            self.assertEqual(result["kpi"]["fallbackRate"], 0.3333)
            self.assertEqual(result["kpi"]["latencyMs"]["p50"], 20.0)

    def test_record_contains_no_freeform_payload_fields(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / "metrics.jsonl"
            with patch.object(telemetry, "METRICS_PATH", path):
                telemetry.record("dispatch", "CI.LINK", "CI.LINK", "ok", 1, True, True)
            row = json.loads(path.read_text().strip())
            forbidden = {"intent", "payload", "stdout", "stderr", "token", "authorization", "providerOutput"}
            self.assertTrue(forbidden.isdisjoint(row.keys()))


if __name__ == "__main__":
    unittest.main()
