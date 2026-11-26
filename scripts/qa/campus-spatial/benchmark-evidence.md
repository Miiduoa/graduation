# 靜宜 3D 導覽：同條件競品實測紀錄

這是 [既有比較基準](../../../docs/campus-spatial-benchmark.md) 的可執行資料完整性稽核工具，並非競品實測結果，不會自動宣布任何產品勝出。只接受靜宜 school_id=pu；尚未證明靜宜優勢前不擴校。

## 輸入

以合法來源及現地確認的學生任務製作 UTF-8 CSV。scenario_id 為同一學生任務，repeat 為獨立重測次數。五個產品在同一 repeat 內都必須使用同一實體裝置、OS、網路、起始設定狀態、**測試日期**、目的地與核對來源；交錯操作順序，記錄失敗及設定成本，不能只選成功樣本。核對來源日期不得晚於實測日期，以免把事後才存在的來源當成當時的驗證依據。不同 repeat 可以在不同日期進行，但同一 scenario_id 的任務、裝置、OS、網路、起始狀態與核對來源（含來源日期）必須保持一致。若條件改變，整個情境列為 pending，不得只挑選其中三次完整重測；另建情境保留紀錄。此外，同一組重測中每款產品的 app_version 必須保持一致（不同產品可以使用各自的版本）。若其中一款在重測期間更新，該組列為 pending，不挑選舊版子集計算中位數；請另建情境重測，保留原始紀錄。ready 結果包含 app_versions，供人工核對版本。

CSV 欄位（**只有欄名，沒有實測數據**）：

> scenario_id,repeat,product,task,school_id,device_id,os_version,network,setup_state,ground_truth_ref,ground_truth_date,tested_on,app_version,result,verified_target,steps,seconds,fps,visual_rating,evidence_ref

- CSV 標題列須**恰好包含每個規定欄位一次**，不得重複欄名、插入未定義欄位，或在資料列末尾多塞儲存格；多出的值不得由 CSV 讀取器默默忽略。
- repeat、steps、visual_rating 採**十進位整數字串**（例如 `1`、`4`），不接受 `1.0`、`1e0` 等易混淆寫法。大型重測編號保留整數精度，不會經過浮點數四捨五入而合併不同重測。
- product：nuni、google-maps、apple-maps、providence-official、unitable。
- task：building、classroom、route、accessibility、visual。
- result：success、failure、unverified。教室未核對門口前不得把建築辨識成功算作教室成功。
- verified_target：building、classroom、route、ui、not-verified。地點結果須有對應層級的合法來源／現地核對，visual 與 accessibility 需以 ui 表示已完成該任務的實機操作驗證；這項工具只能查完整性，無法替證據背書。
- steps、seconds：實際操作步數與秒數（包含失敗紀錄）；未知時可空白，但不可進入可比較結果。
- fps、visual_rating：選填，評分 1–5 須先定義共同標準。**只有同一組完整重測的所有五項產品、每一輪都具備該項量測**，才會提供跨產品可比較的 FPS 或視覺分數中位數；有任一缺漏則全組該指標皆為 null，並在 paired_optional_metrics 明示缺少配對，不以局部樣本製造優勢。
- seconds：有紀錄時必須大於 0，避免零秒操作造成不可能的最快成績；未知可留空，但該輪不能進入 ready。
- evidence_ref：錄影、截圖或證據檔的可查位置，勿存放學生個資。ground_truth_ref 為合法來源 URL，並提供 ground_truth_date；來源本身不能代替現地查證。

## 執行

1. python3 scripts/qa/campus-spatial/compare_trials.py /path/to/actual-trials.csv --output /path/to/audit.json
2. python3 -m unittest discover -s scripts/qa/campus-spatial -p 'test_compare_trials.py' -v

要進入 ready，必須同一情境每輪五項產品齊全、同條件與相同核對來源、完整步數／秒數／證據，且同一條件至少重測三次。**同一情境只要有一輪不完整或無效，就不輸出其他輪次的 ready 中位數**：前三輪完整、第四輪競品缺席時，不得略過第四輪只展示前三輪數字；無關情境仍可獨立比較。產生各產品成功數／樣本數，並將 **median_steps／median_seconds 僅以成功完成的任務計算**，避免競品一秒失敗反而顯得「比完整導航更快」；若該產品全部失敗，成功耗時與步數為 null，絕不填入虛構完成時間。失敗試驗**不會被刪掉**，仍計入總樣本與成功率；另有 median_attempt_steps／median_attempt_seconds 明確表示「所有嘗試（含失敗）」的診斷中位數，不可當作完成速度排名。必須先比較成功率及任務正確率，不能只看成功者的耗時中位數。有完整配對才可計算 FPS 或視覺評分。其他輪次列為 pending，非法資料列為 errors。

退出碼 0：配對完整；1：資料無效；2：仍有待補紀錄或尚無完整情境。**0 僅表示記錄完整，不等於內容真實，更不等於 nuni 超越競品。**原始證據、靜宜實地路線、操作手法及校方來源仍須人工複核。單元測試全部為虛構資料，不能當成校園量測。
