"""宿舍報修文案：只存個人備忘，不把內部 repairId 說成校方單號。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

AI_SERVER_ROOT = Path(__file__).resolve().parents[1]
if str(AI_SERVER_ROOT) not in sys.path:
    sys.path.insert(0, str(AI_SERVER_ROOT))

from tools.actions import register_default_tools
from tools.registry import _REGISTRY, get_tool

PLANNER_SOURCE = (AI_SERVER_ROOT / "tool_planner.py").read_text(encoding="utf-8")


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

    def test_planner_success_copy_is_memo_not_ticket(self) -> None:
        self.assertIn("已幫你存成報修備忘", PLANNER_SOURCE)
        self.assertIn("不會產生校方單號", PLANNER_SOURCE)
        self.assertNotIn("報修編號", PLANNER_SOURCE)
        self.assertNotIn("追蹤後續進度", PLANNER_SOURCE)
        self.assertNotIn("已幫你建立宿舍報修", PLANNER_SOURCE)

    def test_planner_list_copy_does_not_show_hash_ids(self) -> None:
        self.assertIn("宿舍報修備忘", PLANNER_SOURCE)
        self.assertNotIn("#{rid}", PLANNER_SOURCE)
        self.assertNotIn("，#{rid}", PLANNER_SOURCE)


if __name__ == "__main__":
    unittest.main()
