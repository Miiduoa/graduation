"""宿舍報修文案：只存個人備忘，不把內部 repairId 說成校方單號。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock

AI_SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_ROOT))

sys.modules.setdefault("httpx", MagicMock())
sys.modules.setdefault("llm_client", MagicMock())

from tool_planner import _format_list_repairs_success, _format_repair_success
from tools.actions import register_default_tools
from tools.registry import _REGISTRY, get_tool


class RepairCopyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._saved = dict(_REGISTRY)
        _REGISTRY.clear()
        register_default_tools()

    @classmethod
    def tearDownClass(cls) -> None:
        _REGISTRY.clear()
        _REGISTRY.update(cls._saved)

    def test_create_tool_describes_a_memo_not_a_school_ticket(self) -> None:
        tool = get_tool("createDormRepairRequest")
        assert tool is not None
        desc = tool.description
        self.assertIn("個人備忘", desc)
        self.assertIn("不會送到學校", desc)
        self.assertIn("repairId", desc)
        self.assertIn("不是校方單號", desc)
        self.assertNotIn("幫使用者提交宿舍報修", desc)
        self.assertNotIn("成功時回 success=True 與 repairId", desc)

    def test_list_tool_does_not_treat_repair_id_as_a_ticket(self) -> None:
        tool = get_tool("listMyDormRepairs")
        assert tool is not None
        desc = tool.description
        self.assertIn("報修備忘", desc)
        self.assertIn("不是校方單號", desc)
        self.assertNotIn("提交報修", desc)

    def test_success_text_does_not_echo_repair_id_as_a_ticket(self) -> None:
        text = _format_repair_success(
            {
                "repairId": "should-not-appear",
                "location": "靜園 311B",
                "category": "air_conditioning",
                "urgency": "high",
            }
        )
        self.assertIn("報修備忘", text)
        self.assertIn("靜園 311B", text)
        self.assertIn("不會產生校方單號", text)
        self.assertNotIn("should-not-appear", text)
        self.assertNotIn("報修編號", text)
        self.assertNotIn("追蹤後續進度", text)

    def test_list_text_does_not_show_hash_ids(self) -> None:
        text = _format_list_repairs_success(
            {
                "items": [
                    {"repairId": "hidden-id", "location": "伯鐸樓 504", "status": "pending"},
                ]
            }
        )
        self.assertIn("報修備忘", text)
        self.assertIn("伯鐸樓 504", text)
        self.assertNotIn("hidden-id", text)
        self.assertNotIn("#", text)


if __name__ == "__main__":
    unittest.main()
