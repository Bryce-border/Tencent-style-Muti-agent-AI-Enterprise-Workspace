import unittest
from unittest.mock import patch
from app.config import Settings
from app.output_preview import OutputPreview, generate_preview


class PreviewTests(unittest.IsolatedAsyncioTestCase):
    async def test_real_planner_contract_and_input_only_scope(self):
        draft = OutputPreview(title="测试方案", output_type="工作方案", length="约300字", style="中文", sections=["目标", "验收"])
        settings = Settings(llm_api_key="test-key", llm_model="test-model", _env_file=None)
        with patch("app.output_preview.call_preview", return_value=draft) as call:
            result = await generate_preview(settings, {"goal": "仅使用本次资料：代号星舟", "history": ["SECRET_HISTORY"], "memories": ["SECRET_MEMORY"]})
        self.assertEqual(result["format"], "Markdown")
        self.assertNotIn("SECRET_HISTORY", call.call_args.args[1])
        self.assertNotIn("SECRET_MEMORY", call.call_args.args[1])
        self.assertIn("代号星舟", call.call_args.args[1])

    async def test_missing_model_fails_instead_of_returning_template(self):
        with self.assertRaises(ValueError):
            await generate_preview(Settings(llm_api_key="", llm_model="", _env_file=None), {"goal":"创建方案"})

    async def test_invalid_model_output_does_not_create_a_fallback_draft(self):
        with patch("app.output_preview.call_preview", side_effect=ValueError("invalid JSON")):
            with self.assertRaises(ValueError):
                await generate_preview(Settings(llm_api_key="test-key", llm_model="test-model", _env_file=None), {"goal": "创建方案"})

    async def test_configuration_and_edit_context_are_passed_to_preview(self):
        draft = OutputPreview(title="工作方案", output_type="方案", length="300字", style="中文", sections=["验收"])
        with patch("app.output_preview.call_preview", return_value=draft) as call:
            await generate_preview(Settings(llm_api_key="deployment-key", llm_model="default", _env_file=None),
                {"goal": "创建方案", "changes": "补充验收", "previous": {"sections": ["目标"]},
                 "configuration": {"model": "kimi-k3", "api_key": "workspace-key"}})
        self.assertEqual(call.call_args.args[0].llm_model, "kimi-k3")
        self.assertEqual(call.call_args.args[0].llm_api_key, "workspace-key")
        self.assertIn("补充验收", call.call_args.args[1])
        self.assertIn("目标", call.call_args.args[1])
