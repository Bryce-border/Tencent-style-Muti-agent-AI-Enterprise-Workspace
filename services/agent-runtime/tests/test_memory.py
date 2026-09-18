import unittest
from app.memory import memory_context


class MemoryTests(unittest.TestCase):
    def test_context_is_bounded_and_has_provenance(self):
        context = {"turns": [{"task_id": f"T-{n}", "user": "u"*5000, "assistant": "a"*10000} for n in range(50)],
                   "memories": [{"id": f"M-{n}", "content": "m"*5000} for n in range(100)]}
        result = memory_context(context, "请继续上次的工作")
        self.assertLess(len(result), 30000)
        self.assertIn('"T-49"', result)
        self.assertNotIn('"T-0"', result)
        self.assertIn('"M-7"', result)
        self.assertNotIn('"M-8"', result)
        self.assertIn("不可信资料", result)

    def test_empty_history_adds_no_prompt(self):
        self.assertEqual(memory_context({}, "继续"), "")

    def test_input_only_does_not_import_history(self):
        self.assertEqual(memory_context({"memories": [{"content": "旧事实"}]}, "仅使用以下信息生成摘要：销售额100元"), "")
