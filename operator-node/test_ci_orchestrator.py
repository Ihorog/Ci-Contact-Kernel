#!/usr/bin/env python3
import unittest
from unittest.mock import patch

import ci_orchestrator
import evidence_aggregator

class OrchestratorTests(unittest.TestCase):
    def test_rejects_cycle(self):
        graph=[{'id':'a','capability':'operator.health','depends':['b']},
               {'id':'b','capability':'vault.status','depends':['a']}]
        with self.assertRaises(ValueError): ci_orchestrator._validate(graph)

    def test_rejects_unknown_capability(self):
        graph=[{'id':'x','capability':'shell.exec','depends':[]}]
        with self.assertRaises(ValueError): ci_orchestrator._validate(graph)

    def test_template_is_distributed_shape(self):
        graph=ci_orchestrator.TEMPLATES['distributed_acceptance']
        self.assertTrue(ci_orchestrator._validate(graph))
        self.assertIn('ci.link.contact',[x['capability'] for x in graph])

    def test_evidence_envelope_requires_all_steps(self):
        graph=[{'id':'a','capability':'operator.health','depends':[]}]
        env=evidence_aggregator.aggregate('r1',graph,{'a':{'ok':True,'executor':'orange.local','evidence':{'ok':True}}})
        self.assertTrue(env['complete'])
        self.assertFalse(env['distributed'])
