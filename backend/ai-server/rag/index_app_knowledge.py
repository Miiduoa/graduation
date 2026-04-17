"""Index static APP knowledge (screens, types, navigation) into ChromaDB.

Run once at startup or after each deployment.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

from config import APP_SRC_ROOT
from rag.indexer import index_documents, delete_by_source
from prompts.campus_knowledge import SCREEN_KNOWLEDGE

logger = logging.getLogger(__name__)


def _extract_type_definitions(types_path: Path) -> list[dict]:
    """Parse type definitions from types.ts into indexable documents."""
    if not types_path.exists():
        return []

    content = types_path.read_text(encoding="utf-8")
    docs: list[dict] = []

    type_blocks = re.findall(
        r"export\s+type\s+(\w+)\s*=\s*\{([^}]+)\}",
        content,
        re.DOTALL,
    )

    for name, body in type_blocks:
        fields = re.findall(r"(\w+)\??\s*:\s*([^;]+);", body)
        field_descs = [f"  - {fname}: {ftype.strip()}" for fname, ftype in fields]
        text = f"資料模型 {name}:\n" + "\n".join(field_descs)
        docs.append({
            "text": text,
            "source": "app:types",
            "metadata": {"type_name": name},
        })

    return docs


def _extract_screen_knowledge() -> list[dict]:
    """Convert screen knowledge dict into indexable documents."""
    docs: list[dict] = []
    for name, info in SCREEN_KNOWLEDGE.items():
        actions = "、".join(info["actions"])
        text = (
            f"APP 畫面：{name}\n"
            f"導航路徑：{info['path']}\n"
            f"功能說明：{info['description']}\n"
            f"可用操作：{actions}"
        )
        docs.append({
            "text": text,
            "source": "app:screens",
            "metadata": {"screen_name": name},
        })
    return docs


def _extract_navigation_structure() -> list[dict]:
    """Build a global navigation map document."""
    nav_text_parts = [
        "APP 導航結構（五個主要分頁）：",
        "",
        "1. Today（首頁）：今日摘要、公告列表、活動列表、AI 助理",
        "2. 課程（學生角色）/ 教學（教師）/ 服務（職員）：",
        "   - 課表、課程首頁、課程中樞、加選課程",
        "   - 成績、學分試算、AI 選課助理",
        "   - 教材、測驗中心、作業、出席、學習分析",
        "3. 校園：地圖、POI 詳情、AR 導航、餐廳、菜單",
        "   - 圖書館、公車、健康中心、宿舍、列印服務",
        "   - 失物招領、支付、商家中心",
        "4. 訊息：群組列表、群組詳情、私訊、作業討論",
        "5. 我的：個人資料、設定、通知設定、成就、資料匯出",
    ]

    return [{
        "text": "\n".join(nav_text_parts),
        "source": "app:navigation",
        "metadata": {"type": "navigation_structure"},
    }]


def index_all_app_knowledge() -> int:
    """Index all static APP knowledge into ChromaDB."""
    all_docs: list[dict] = []

    for source in ("app:types", "app:screens", "app:navigation"):
        delete_by_source(source)

    types_path = APP_SRC_ROOT / "data" / "types.ts"
    all_docs.extend(_extract_type_definitions(types_path))

    all_docs.extend(_extract_screen_knowledge())
    all_docs.extend(_extract_navigation_structure())

    if all_docs:
        count = index_documents(all_docs)
        logger.info("Indexed %d APP knowledge chunks", count)
        return count
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    n = index_all_app_knowledge()
    print(f"Indexed {n} chunks of APP knowledge")
