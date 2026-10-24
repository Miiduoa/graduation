# Verified official public school entry points

Checked 2026-10-24 Asia/Taipei. These are external official public resources, not Campus One integrations, availability promises, verified accounts, or school rules. No authenticated operation was performed.

## Recommended UI links

| School | Category | Label | URL | Kind |
| --- | --- | --- | --- | --- |
| pu | courses | 靜宜課程綱要查詢入口 | https://alcat.pu.edu.tw/ | student-portal |
| pu | dormitory | 靜宜住宿服務組 | https://osadorm.pu.edu.tw/ | dedicated |
| pu | health | 靜宜諮商暨健康中心 | https://osachc.pu.edu.tw/ | dedicated |
| pu | career | 靜宜職涯發展暨產業促進處 | https://cdif.pu.edu.tw/ | dedicated |
| ncku | courses | 成大課程資訊及選課系統 | https://course.ncku.edu.tw/index.php?c=portal | dedicated |
| ncku | dormitory | 成大住宿服務組 | https://housing-osa.ncku.edu.tw/ | dedicated |
| ncku | health | 成大心理健康與諮商輔導組 | https://counseling-osa.ncku.edu.tw/ | dedicated |
| ncku | career | 成大生涯發展與就業輔導組 | https://grad-osa.ncku.edu.tw/ | dedicated |
| ntpu | courses | 北大課程查詢官方說明 | https://sfai.ntpu.edu.tw/web/information/information.jsp?cp_id=CP1603460657954 | official-guide |
| ntpu | dormitory | 北大住宿輔導組 | https://new.ntpu.edu.tw/osa/housing?lang=zh | dedicated |
| ntpu | health | 北大學生諮商中心 | https://new.ntpu.edu.tw/osa/counseling | dedicated |
| ntpu | career | 北大職涯發展中心 | https://career.ntpu.edu.tw/cht/index.php | dedicated |
| ntu | courses | 臺大課程網 | https://course.ntu.edu.tw/ | dedicated |
| ntu | dormitory | 臺大學生專區（住宿資訊入口） | https://www.ntu.edu.tw/student.html | student-portal-fallback |
| ntu | health | 臺大學生專區（諮商資訊入口） | https://www.ntu.edu.tw/student.html | student-portal-fallback |
| ntu | career | 臺大學生專區（職涯資訊入口） | https://www.ntu.edu.tw/student.html | student-portal-fallback |

## Verification evidence and limitations

- All recommended URLs above returned HTTP 200 through the system curl client with normal TLS verification. HTML titles matched the named school/unit. PU course portal exposes a public item named 課程綱要查詢系統 and its link was followed; it posts onward to another platform, so use the stable public portal rather than pretending direct API access.
- NCKU course URL is linked directly by https://cid-acad.ncku.edu.tw/index.php (official curriculum office) and was opened by web browsing and curl; it provides public course search entry points alongside authenticated enrollment. Linking is not authorization to automate enrollment.
- NTPU official course explanation was opened and curl verified. It publishes https://sea.cc.ntpu.edu.tw/pls/dev_stud/course_query_all.CHI_MAIN as the course query system. That legacy endpoint failed TLS handshake in Python and could not be fetched by the web tool; recommend the working official explanation until browser compatibility is established.
- NTU https://course.ntu.edu.tw/ was opened by web browsing and curl verified as 臺大課程網. Python urllib alone returned 403; this does not establish user browser failure.
- NTU student portal https://www.ntu.edu.tw/student.html was independently curl verified HTTP 200 with title 學生專區 - 國立臺灣大學. It contains course, accommodation, and career resource sections. Use truthful fallback labels, not dedicated-office claims.
- NTU https://career.ntu.edu.tw/ returned HTTP 200 containing only `page not found` in direct fetch. https://osa_dorm.ntu.edu.tw/ and https://scc_osa.ntu.edu.tw/ failed hostname verification in Python and returned 404 in web opening. They appear in official cached search results and official student-portal links; do not claim those cached results establish present availability.
- NTU https://osa.ntu.edu.tw/services/accommodation?locale=zh_tw, https://osa.ntu.edu.tw/services/campuslife, and https://osa.ntu.edu.tw/services/careers had rich cached web extracts, but direct current requests all redirected to https://osa.ntu.edu.tw/static.html, a 730-byte image-only page. Do not use them as currently available dedicated services.
- These checks verify public source provenance and basic retrieval only. They do not establish appointment availability, eligibility, deadlines, applications, enrollment, or any private data integration. Health links are general office links and carry no medical advice.

## Existing PU health detail links retained and rechecked

All four returned HTTP 200 through system curl with normal TLS verification, with matching official page titles:

- 學生個別諮商輔導: https://osachc.pu.edu.tw/p/412-1067-1754.php?Lang=zh-tw
- 特約醫院: https://osachc.pu.edu.tw/p/412-1067-1775.php?Lang=zh-tw
- 學生健康檢查: https://osachc.pu.edu.tw/p/412-1067-1787.php?Lang=zh-tw
- 114-1校園AED分布圖: https://osachc.pu.edu.tw/p/412-1067-1797.php?Lang=zh-tw (the title explicitly identifies 114-1, not a newly verified current equipment inventory)
