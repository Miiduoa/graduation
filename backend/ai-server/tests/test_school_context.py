"""A school switch must not carry Providence prompt or route defaults across requests."""

import unittest
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit

from prompts.campus_knowledge import get_full_knowledge_text
from web_search import _fetch_weather, _route_answer


class SchoolContextTests(unittest.IsolatedAsyncioTestCase):
    def test_knowledge_switches_with_each_request(self):
        for school_id in ("pu", "nthu", "tw-pu", "nkust", None):
            knowledge = get_full_knowledge_text(school_id)
            self.assertIn("APP 功能與操作指南", knowledge)
            self.assertEqual("蓋夏圖書館" in knowledge, school_id in ("pu", "tw-pu"))

    async def test_request_school_reaches_the_prompt_and_both_retrieval_paths(self):
        import server

        with (
            patch.object(server, "ENABLE_RAG", True),
            patch.object(server, "ENABLE_WEB_SEARCH", True),
            patch.object(server, "retrieve", create=True, return_value=[]) as retrieve,
            patch.object(server, "format_context", create=True, return_value=""),
            patch.object(server, "search_public_web", AsyncMock(return_value=("", []))) as search,
        ):
            for school_id in ("pu", "yuntech", None):
                req = server.ChatRequest(message="怎麼去車站", context={"schoolId": school_id})
                messages = await server._build_messages(req)
                retrieve.assert_called_with(req.message, school_id=school_id)
                search.assert_awaited_with(req.message, school_id=school_id)
                self.assertEqual("蓋夏圖書館" in messages[0]["content"], school_id == "pu")

    def test_route_with_no_origin_leaves_it_to_maps(self):
        content, sources = _route_answer("怎麼去臺北車站")
        params = parse_qs(urlsplit(sources[0].url).query)
        self.assertNotIn("origin", params)
        self.assertEqual(params["destination"], ["臺北車站"])
        self.assertNotIn("靜宜", content)

    def test_explicit_origin_is_preserved_without_irrelevant_bus(self):
        content, sources = _route_answer("從雲林科技大學怎麼去斗六車站")
        params = parse_qs(urlsplit(sources[0].url).query)
        self.assertEqual(params["origin"], ["雲林科技大學"])
        self.assertNotIn("300", content)
        self.assertEqual(len(sources), 1)

    def test_providence_bus_source_only_for_matching_route(self):
        _, sources = _route_answer("從靜宜大學怎麼去臺中車站")
        self.assertIn("route=300", sources[0].url)

    async def test_missing_or_unsupported_weather_location_never_fetches_taichung(self):
        client = AsyncMock()
        for query in ("高雄今天天氣", "天氣如何", "臺北今天會下雨嗎"):
            content, sources = await _fetch_weather(query, client)
            self.assertEqual(sources, [])
            self.assertNotIn("台中", content)
        client.get.assert_not_awaited()
