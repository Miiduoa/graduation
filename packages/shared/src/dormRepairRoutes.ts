import type { DormRepairCategory } from './dormitory';
import { getPublicSchoolInfo, getSafePublicSchoolWebsiteUrl } from './publicSchoolInfo';
import { resolveSchoolPublicServices } from './schoolPublicServices';

export type DormRepairRoute = {
  label: string;
  detail: string;
  url: string;
  trackingUrl?: string;
  trackingLabel?: string;
};

// Official resident instructions, checked 2026-11-06. Destinations are fixed:
// opening one never puts the resident's room, issue or case number in a URL.
const puGuide = 'https://c061.pu.edu.tw/p/404-1118-9935.php?Lang=zh-tw';
const puDesks = [
  { hall: '希嘉', extension: '11245' },
  { hall: '思高', extension: '11254' },
  { hall: '善牧', extension: '11255' },
];
const nthuForm = 'https://sthousing.nthu.edu.tw/DormRF/fillup';
const ntouPortal = 'https://ais.ntou.edu.tw/Default.aspx';
const nsysuPortal = 'https://sis.nsysu.edu.tw/';
const nchuGuide = 'https://www.osa.nchu.edu.tw/osa/dorm/qanda.html';

export function resolveDormRepairRoute(
  schoolId: string | null | undefined,
  category: DormRepairCategory,
  location = '',
): DormRepairRoute | null {
  const network = category === 'network';
  const id = (schoolId ?? '').trim().toLowerCase();
  switch (id) {
    case 'tw-pu':
    case 'pu': {
      const desks = puDesks.filter(({ hall }) => location.includes(hall));
      const detail = network ? '請到該棟服務台登記宿網故障。' : '請到該棟服務台填修繕單，寫下設備、位置和故障情形。';
      if (desks.length !== 1) return { label: '查看靜宜各棟服務台', detail, url: puGuide };
      const { hall, extension } = desks[0]!;
      return {
        label: '致電' + hall + '學苑服務台',
        detail: detail + '可先撥 04-2632-8001 轉 ' + extension + ' 詢問。',
        url: 'tel:0426328001',
      };
    }
    // 海大學務處 stu.ntou.edu.tw/p/404-1023-48230.php
    case 'tw-ntou':
    case 'ntou':
      return network ? {
        label: '致電海大宿網客服', detail: '宿網由中華電信受理，請撥 0800-080-412。', url: 'tel:0800080412',
      } : {
        label: '開啟海大教學務系統', detail: '登入後選「學生宿舍修繕系統」。可填寫寢室或公共區的位置、狀況並附照片。', url: ntouPortal,
        trackingLabel: '查海大修繕處理狀況', trackingUrl: ntouPortal,
      };
    // 中山宿服組 housing-osa.nsysu.edu.tw/p/412-1092-3593.php
    case 'tw-nsysu':
    case 'nsysu':
      return network ? {
        label: '查看中山宿網報修說明與表單', detail: '先以有線連線測試，再備妥 IP 資訊和故障說明填表。',
        url: 'https://dormnet-lis.nsysu.edu.tw/p/406-1052-242095,r4161.php?Lang=zh-tw',
      } : {
        label: '開啟中山宿舍修繕', detail: '以個人帳號登入學生綜合資訊平台，選「宿舍修繕」。', url: nsysuPortal,
        trackingLabel: '查中山宿舍修繕進度', trackingUrl: nsysuPortal,
      };
    // 清大住宿組 sthousing.site.nthu.edu.tw/p/412-1254-15568.php
    case 'tw-nthu':
    case 'nthu':
      return network ? {
        label: '查看清大宿網報修分機', detail: '宿網和網路孔由計通中心受理。校本部分機 31000，南大校區分機 76405。',
        url: 'https://sthousing.site.nthu.edu.tw/p/412-1254-15568.php?Lang=zh-tw',
      } : {
        label: '填寫清大宿舍修繕單', detail: '選擇齋別和維修項目。補充說明限 100 字，請省略個資。頁面下方可用修繕編號查進度。',
        url: nthuForm, trackingLabel: '到清大查修繕編號', trackingUrl: nthuForm,
      };
    // 成大住宿 e 網 dorm.osa.ncku.edu.tw/index_app.php · 計網中心 cc.ncku.edu.tw/p/412-1213-3316.php
    case 'tw-ncku':
    case 'ncku':
      if (location.includes('太子')) return network ? {
        label: '聯絡成大太子學舍服務台', detail: '請向太子學舍櫃檯說明房號與斷線情形，確認宿網報修窗口。',
        url: 'https://nckudorm.prince.com.tw/',
      } : {
        label: '開啟成大太子學舍修繕報修', detail: '登入太子學舍會員服務，選「修繕報修」登記寢室或公共設備故障。',
        url: 'https://nckudorm.prince.com.tw/Member_Repair.aspx',
      };
      return network ? {
        label: '開啟成大宿網服務說明', detail: '可寄信給 dormnet@ncku.edu.tw，附上姓名、宿舍、房號、網孔位置和故障情形。',
        url: 'https://cc.ncku.edu.tw/p/412-1213-3316.php?Lang=zh-tw',
      } : {
        label: '開啟成大宿舍修繕通報', detail: '校方宿舍請到住宿 e 網登記。太子學舍請在位置填入學舍名稱，前往專屬報修。',
        url: 'https://dorm.osa.ncku.edu.tw/index_mrf.php',
      };
    // 臺大住宿組 osa_dorm.ntu.edu.tw/DormitoryMaintainanceOnlineRequestSystem
    case 'tw-ntu':
    case 'ntu':
      if (network) return {
        label: '查看臺大宿網報修窗口', detail: '自建宿舍先找該舍網管。太子學舍請洽一樓服務台資訊工讀生。',
        url: 'https://ccnet.ntu.edu.tw/ccnet/dorm.php?page=responsibility',
      };
      if (/太子|(?:長興|水源)(?:舍區|學舍|宿舍|[ABC]棟)/i.test(location)) return {
        label: '開啟臺大太子學舍修繕報修', detail: '登入太子學舍會員服務，登記寢室或公共設備故障。可在同頁查看最近報修紀錄。',
        url: 'https://ntudorm.prince.com.tw/Member_Repair.aspx', trackingLabel: '查太子學舍報修紀錄', trackingUrl: 'https://ntudorm.prince.com.tw/Member_Repair.aspx',
      };
      return {
        label: '開啟臺大宿舍修繕系統', detail: '自建宿舍請登入住宿管理系統。太子學舍請在位置填入「太子學舍」以開啟該舍報修。',
        url: 'https://housing.ntu.edu.tw/',
      };
    case 'tw-ncu':
    case 'ncu':
      return network ? {
        label: '查看中央宿網報修方式', detail: '宿網與書桌網路孔請選「電算中心網站」或洽校內分機 57555。',
        url: 'https://repair.ncu.edu.tw/RepairSystem/',
      } : {
        label: '開啟中央宿舍修繕通報', detail: '用 Portal 帳號登入，寢室內設備需註明床位。洗烘衣機請依機身廠商電話通報。',
        url: 'https://repair.ncu.edu.tw/RepairSystem/', trackingLabel: '查中央尚未完成的報修', trackingUrl: 'https://repair.ncu.edu.tw/RepairSystem/report',
      };
    case 'tw-nchu':
    case 'nchu':
      if (location.includes('南投')) return {
        label: '致電興大南投宿舍服務中心', detail: '南投宿舍的設備和網路問題都可撥 049-231-7574 聯絡服務中心。',
        url: 'tel:0492317574',
      };
      return network ? {
        label: '查看興大各宿舍網路窗口', detail: '台中宿舍請洽所屬舍區網路管理員。南投宿舍請洽南投宿舍服務中心。', url: nchuGuide,
      } : {
        label: '開啟興大入口報修', detail: '台中宿舍請依序選「學務資訊系統」、「學生宿舍」、「宿舍報修系統」。南投宿舍請洽 049-231-7574。',
        url: 'https://cportal.nchu.edu.tw/',
      };
    // 政大營繕組 mend.nccu.edu.tw/PageDoc/Detail?fid=8384&id=3480
    case 'nccu':
    case 'tw-nccu':
      return network ? {
        label: '查看政大宿網聯絡方式', detail: '宿網故障請洽電算中心，校內分機 67343，信箱 ccnet@nccu.edu.tw。',
        url: 'https://support.video.nccu.edu.tw/media/623',
      } : {
        label: '開啟政大宿舍請修', detail: '登入 iNCCU 後，在學生資訊系統依序選「住宿服務」、「宿舍請修」。',
        url: 'https://i.nccu.edu.tw/', trackingLabel: '到政大查請修紀錄', trackingUrl: 'https://i.nccu.edu.tw/',
      };
    default: {
      const housing = resolveSchoolPublicServices(id)?.services.dormitory;
      if (housing) return { label: housing.label, detail: '請從住宿服務單位網站確認這項設備的報修方式。', url: housing.url };
      const school = getPublicSchoolInfo(id);
      const url = getSafePublicSchoolWebsiteUrl(school?.websiteUrl);
      if (!school || !url) return null;
      return { label: '前往' + school.name + '官網', detail: '可從學校官網尋找學務處的住宿服務單位，確認報修方式。', url };
    }
  }
}
