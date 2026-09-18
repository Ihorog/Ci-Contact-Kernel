import unittest

from ci_context_runtime import (
    execute_context_card,
    fallback_cards,
    normalize_card,
)


class ContextRuntimeTest(unittest.TestCase):
    def test_fallback_materializes_three_cards(self):
        cards = fallback_cards({"gesture": "swipe_left", "context": {}})
        self.assertEqual(len(cards), 3)
        self.assertTrue(any(c["context"]["state"] == "predicted" for c in cards))
        self.assertTrue(all(0 <= c["context"]["relevance"] <= 1 for c in cards))

    def test_predicted_card_is_explicit(self):
        card = normalize_card({"label": "Наступний крок", "context": {"state": "predicted"}})
        self.assertTrue(card["label"].startswith("Ймовірно:"))

    def test_fallback_context_newer_is_explicit(self):
        cards = fallback_cards({"gesture": "context_newer", "context": {}})
        self.assertEqual(cards[0]["routing"]["action"], "context_newer")
        self.assertEqual(cards[0]["context"]["state"], "predicted")

    def test_fallback_context_older_is_explicit(self):
        cards = fallback_cards({"gesture": "context_older", "context": {}})
        self.assertEqual(cards[0]["routing"]["action"], "context_older")
        self.assertEqual(cards[0]["context"]["state"], "past")

    def test_fallback_next_stage_is_explicit(self):
        cards = fallback_cards({"gesture": "next_stage", "context": {}})
        self.assertEqual(cards[0]["routing"]["action"], "next_stage")
        self.assertEqual(cards[0]["context"]["state"], "predicted")

    def test_fallback_previous_state_is_explicit(self):
        cards = fallback_cards({"gesture": "previous_state", "context": {}})
        self.assertEqual(cards[0]["routing"]["action"], "previous_state")
        self.assertEqual(cards[0]["context"]["state"], "past")

    def test_materialize_has_actual_current_card(self):
        cards = fallback_cards({"gesture": "materialize_context", "context": {}})
        self.assertEqual(cards[0]["context"]["state"], "actual")
        self.assertEqual(cards[0]["routing"]["capability"], "materialize_context")

    def test_action_evolves_to_next_cards(self):
        card = fallback_cards({"gesture": "tap", "context": {}})[0]

        def process_intent(intent, context):
            return {
                "action": "answer",
                "query": intent,
                "answer": "ok",
                "requires_confirmation": False,
            }

        def finalize(result, context):
            result["evidence"] = {"verified": True}
            return result

        def resolve(payload):
            return fallback_cards(payload)

        result, next_cards = execute_context_card(
            {"card": card, "context": {}}, process_intent, finalize, resolve
        )
        self.assertEqual(result["selected_card_id"], card["id"])
        self.assertEqual(len(next_cards), 3)


if __name__ == "__main__":
    unittest.main()
