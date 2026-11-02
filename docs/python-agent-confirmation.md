# Python Agent 工具執行邊界

`POST /api/agent/chat` 尚未提供可核對本人、參數與有效期限的操作確認流程。因此報修、訂餐、建立提醒不開放由這條路徑執行；使用者仍可到對應功能頁操作。

## 執行契約

- `register_tool` 預設需要確認。只有明確設為 `requires_confirmation=False` 的工具才會提供給模型；現有六項查詢／導航工具維持此設定。
- 每輪在等待模型前固定工具名稱集合。模型回傳其他名稱、新增工具或偽造 `confirmed`、角色等欄位，都不能擴大當輪權限。
- Dispatcher 再檢查目前的確認設定。即使工具原先公開，等待期間改為需要確認，也不能執行。
- 被拒絕操作回傳 `success: false`，不呼叫 handler；未接受的 arguments 不放進回傳 trace。這不會刪除原有使用者訊息或操作紀錄。
- Handler 的 `success` 必須是 boolean；字串、數字不能變成成功回執。沒有工具執行時使用固定文案，不顯示模型自行聲稱的提交成功；失敗文案也不直接插入模型提供的未知工具名稱。
- 保留既有 HTTP 200＋`tool_failed` 卡片契約。不能把拒絕改成 HTTP 錯誤而觸發舊客戶端的供應商 fallback。

這不是完整的確認功能。未來開放寫入前，需要另做經服務端驗證的提案、本人確認、參數綁定、去重與結果核對，不能只把工具旗標改成 `False`。

## 驗證

在只安裝 `requirements-cloud.txt` 的隔離 Python 3.12 環境執行：

```sh
cd backend/ai-server
PYTHON_DOTENV_DISABLED=1 ENABLE_RAG=false ENABLE_WEB_SEARCH=false \
ENABLE_SELF_TRAIN_LOOP=false ENABLE_REFLEXION=false LLM_PROVIDER=groq \
GROQ_API_KEY='' OPENAI_COMPAT_API_KEY='' TOGETHER_API_KEY='' \
python -m unittest discover -s tests -v
```

`test_agent_confirmation_boundary.py` 驗證 registry、當輪工具範圍、偽確認、等待期間變更、取消與回執；`test_agent_confirmation_http.py` 使用真 FastAPI endpoint／planner／registry 及導航 handler，隔離 auth、provider、Firestore 與紀錄。測試資料皆為合成資料，沒有真雲端或資料庫操作。

## 未涵蓋範圍

目前 Mobile 的 `CampusAssistantScreen` 使用 JS Firebase callable；`services/ai.ts` 仍保留 Python 呼叫路徑。本修補不代表 Mobile 已有操作確認 UI，也沒有完成 Python 的會員／學校範圍檢查、provider 同意、免費雲端政策或其他供應商 fallback 修正。既有 Python 的姓名、校園與角色上下文傳送政策也未變更。

未做真供應商、原生裝置或正式部署驗收；雲端依賴稽核範圍見 [Python AI Server 安全邊界](security/python-ai-server.md)。
