#!/usr/bin/env python3
import unittest

import ci_orchestrator
import evidence_aggregator

class ControlPlaneContractTests(unittest.TestCase):
    def test_orange_allowlist_contains_only_control_plane_capabilities(self):
        forbidden={'shell.exec','repo.write','repo.build','android.build','browser.run','media.process'}
        self.assertTrue(forbidden.isdisjoint(ci_orchestrator.READ_CAPS))

    def test_all_template_steps_are_allowlisted(self):
        for graph in ci_orchestrator.TEMPLATES.values():
            self.assertTrue(ci_orchestrator._validate(graph))
            for step in graph:
                self.assertIn(step['capability'],ci_orchestrator.READ_CAPS)

    def test_done_requires_evidence(self):
        graph=[{'id':'a','capability':'operator.health','depends':[]}]
        env=evidence_aggregator.aggregate('r1',graph,{
            'a':{'ok':True,'executor':'orange.local','evidence':{}}
        })
        self.assertFalse(env['complete'])

    def test_done_accepts_nonempty_evidence(self):
        graph=[{'id':'a','capability':'operator.health','depends':[]}]
        env=evidence_aggregator.aggregate('r1',graph,{
            'a':{'ok':True,'executor':'orange.local','evidence':{'node':'orangepi3-lts'}}
        })
        self.assertTrue(env['complete'])

if __name__ == '__main__':
    unittest.main()
