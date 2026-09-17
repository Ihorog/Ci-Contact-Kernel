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

    def test_action_evolves_to_next_cards(self):
        card = fallback_cards({"gesture": "tap", "context": {}})[0]

        def process_intent(intent, context):
            return {"action": "answer", "query": intent, "answer": "ok", "requires_confirmation": False}

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
