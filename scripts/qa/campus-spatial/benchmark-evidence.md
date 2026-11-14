# 靜宜 3D 導覽：同條件競品實測紀錄

這是 [既有比較基準](../../../docs/campus-spatial-benchmark.md) 的可執行資料完整性稽核工具，並非競品實測結果，不會自動宣布任何產品勝出。只接受靜宜 school_id=pu；尚未證明靜宜優勢前不擴校。

## 輸入

以合法來源及現地確認的學生任務製作 UTF-8 CSV。scenario_id 為同一學生任務，repeat 為獨立重測次數。五個產品都必須使用同一實體裝置、OS、網路、起始設定狀態、目的地與核對來源；交錯操作順序，記錄失敗及設定成本，不能只選成功樣本。

CSV 欄位（**只有欄名，沒有實測數據**）：

> scenario_id,repeat,product,task,school_id,device_id,os_version,network,setup_state,ground_truth_ref,ground_truth_date,tested_on,app_version,result,verified_target,steps,seconds,fps,visual_rating,evidence_ref

- product：nuni、google-maps、apple-maps、providence-official、unitable。
- task：building、classroom、route、accessibility、visual。
- result：success、failure、unverified。教室未核對門口前不得把建築辨識成功算作教室成功。
- verified_target：building、classroom、route、ui、not-verified。地點結果須有對應層級的合法來源／現地核對，visual 與 accessibility 需以 ui 表示已完成該任務的實機操作驗證；這項工具只能查完整性，無法替證據背書。
- steps、seconds：實際操作步數與秒數（包含失敗紀錄）；未知時可空白，但不可進入可比較結果。
- fps、visual_rating：選填，評分 1–5 須先定義共同標準；沒有量測不能宣稱效能優勢。
- evidence_ref：錄影、截圖或證據檔的可查位置，勿存放學生個資。ground_truth_ref 為合法來源 URL，並提供 ground_truth_date；來源本身不能代替現地查證。

## 執行

1. python3 scripts/qa/campus-spatial/compare_trials.py /path/to/actual-trials.csv --output /path/to/audit.json
2. python3 -m unittest discover -s scripts/qa/campus-spatial -p 'test_compare_trials.py' -v

要進入 ready，必須同一情境每輪五項產品齊全、同條件與相同核對來源、完整步數／秒數／證據，且同一條件至少重測三次。產生各產品成功數／樣本數、步數／秒數中位數；有提供才計算 FPS 或視覺評分。其他輪次列為 pending，非法資料列為 errors，不會默默刪除失敗紀錄。

退出碼 0：配對完整；1：資料無效；2：仍有待補紀錄或尚無完整情境。**0 僅表示記錄完整，不等於內容真實，更不等於 nuni 超越競品。**原始證據、靜宜實地路線、操作手法及校方來源仍須人工複核。單元測試全部為虛構資料，不能當成校園量測。
