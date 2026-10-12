export type AnnouncementCatalogLink = {
  sourceId: string;
  office: string;
  listUrl: string;
};

const ANNOUNCEMENT_CATALOG_LINKS: Record<string, readonly AnnouncementCatalogLink[]> = {
  'tw-nchu': [
    { sourceId: 'tw-nchu-campus', office: '全校最新消息', listUrl: 'https://www.nchu.edu.tw/news' },
    { sourceId: 'tw-nchu-aca', office: '教務處', listUrl: 'https://www.oaa.nchu.edu.tw/' },
  ],
  'ntu': [
    { sourceId: 'ntu-campus', office: '全校最新消息', listUrl: 'https://www.ntu.edu.tw/spotlight/index.html' },
    { sourceId: 'ntu-aca', office: '教務處', listUrl: 'https://www.aca.ntu.edu.tw/' },
  ],
  'nthu': [
    { sourceId: 'nthu-campus', office: '全校最新消息', listUrl: 'https://www.nthu.edu.tw/news' },
    { sourceId: 'nthu-aca', office: '教務處', listUrl: 'https://academic.site.nthu.edu.tw/' },
  ],
  'ncku': [
    { sourceId: 'ncku-campus', office: '全校最新消息', listUrl: 'https://web.ncku.edu.tw/p/403-1000-14-1.php' },
    { sourceId: 'ncku-aca', office: '教務處', listUrl: 'https://www.acad.ncku.edu.tw/' },
  ],
  'nycu': [
    { sourceId: 'nycu-campus', office: '全校最新消息', listUrl: 'https://www.nycu.edu.tw/nycu/news' },
    { sourceId: 'nycu-aca', office: '教務處', listUrl: 'https://aa.nycu.edu.tw/' },
  ],
  'ncu': [
    { sourceId: 'ncu-campus', office: '全校最新消息', listUrl: 'https://www.ncu.edu.tw/tw/news/index.php' },
    { sourceId: 'ncu-aca', office: '教務處', listUrl: 'https://aca.ncu.edu.tw/' },
  ],
  'nsysu': [
    { sourceId: 'nsysu-campus', office: '全校最新消息', listUrl: 'https://www.nsysu.edu.tw/p/403-1000-14-1.php' },
    { sourceId: 'nsysu-aca', office: '教務處', listUrl: 'https://oaa.nsysu.edu.tw/' },
  ],
  'ntnu': [
    { sourceId: 'ntnu-campus', office: '全校最新消息', listUrl: 'https://pr.ntnu.edu.tw/news/index.php' },
    { sourceId: 'ntnu-aca', office: '教務處', listUrl: 'https://www.aa.ntnu.edu.tw/' },
  ],
  'ntust': [
    { sourceId: 'ntust-campus', office: '全校最新消息', listUrl: 'https://www.ntust.edu.tw/p/403-1000-14-1.php' },
    { sourceId: 'ntust-aca', office: '教務處', listUrl: 'https://www.academic.ntust.edu.tw/' },
  ],
  'nccu': [
    { sourceId: 'nccu-campus', office: '全校最新消息', listUrl: 'https://www.nccu.edu.tw/p/403-1000-14-1.php' },
    { sourceId: 'nccu-aca', office: '教務處', listUrl: 'https://aca.nccu.edu.tw/' },
  ],
  'ncyu': [
    { sourceId: 'ncyu-campus', office: '全校最新消息', listUrl: 'https://www.ncyu.edu.tw/news' },
    { sourceId: 'ncyu-aca', office: '教務處', listUrl: 'https://www.ncyu.edu.tw/aca/' },
  ],
  'ncue': [
    { sourceId: 'ncue-campus', office: '全校最新消息', listUrl: 'https://www.ncue.edu.tw/' },
    { sourceId: 'ncue-aca', office: '教務處', listUrl: 'https://acadoff.ncue.edu.tw/' },
  ],
  'ntpu': [
    { sourceId: 'ntpu-campus', office: '全校最新消息', listUrl: 'https://new.ntpu.edu.tw/news' },
    { sourceId: 'ntpu-aca', office: '教務處', listUrl: 'https://www.aa.ntpu.edu.tw/' },
  ],
  'tmu': [
    { sourceId: 'tmu-campus', office: '全校最新消息', listUrl: 'https://www.tmu.edu.tw/news' },
    { sourceId: 'tmu-aca', office: '教務處', listUrl: 'https://oga.tmu.edu.tw/' },
  ],
  'fju': [
    { sourceId: 'fju-campus', office: '全校最新消息', listUrl: 'https://www.fju.edu.tw/' },
    { sourceId: 'fju-aca', office: '教務處', listUrl: 'https://www.academic.fju.edu.tw/' },
  ],
  'thu': [
    { sourceId: 'thu-campus', office: '全校最新消息', listUrl: 'https://www.thu.edu.tw/' },
    { sourceId: 'thu-aca', office: '教務處', listUrl: 'https://acad.thu.edu.tw/' },
  ],
  'cgu': [
    { sourceId: 'cgu-campus', office: '全校最新消息', listUrl: 'https://www.cgu.edu.tw/' },
    { sourceId: 'cgu-aca', office: '教務處', listUrl: 'https://academic.cgu.edu.tw/' },
  ],
  'cycu': [
    { sourceId: 'cycu-campus', office: '全校最新消息', listUrl: 'https://www.cycu.edu.tw/' },
    { sourceId: 'cycu-aca', office: '教務處', listUrl: 'https://aca.cycu.edu.tw/' },
  ],
  'pu': [
    { sourceId: 'pu-dorac', office: '綜合業務組', listUrl: 'https://dorac.pu.edu.tw/p/403-1059-719-1.php' },
    { sourceId: 'pu-acd', office: '教務處', listUrl: 'https://acd.pu.edu.tw/p/403-1042-885-1.php' },
    { sourceId: 'pu-osa', office: '學務處', listUrl: 'https://osa.pu.edu.tw/' },
    { sourceId: 'pu-dbs', office: '事務組', listUrl: 'https://dbs.pu.edu.tw/p/403-1069-783-1.php' },
    { sourceId: 'pu-oits', office: '資訊處', listUrl: 'https://oits.pu.edu.tw/' },
    { sourceId: 'pu-csp', office: '校警', listUrl: 'https://csp.pu.edu.tw/' },
    { sourceId: 'pu-dorm', office: '住宿', listUrl: 'https://osadorm.pu.edu.tw/' },
  ],
  'scu': [
    { sourceId: 'scu-campus', office: '全校最新消息', listUrl: 'https://www.scu.edu.tw/' },
    { sourceId: 'scu-aca', office: '教務處', listUrl: 'https://www.scu.edu.tw/acade/' },
  ],
  'ntub': [
    { sourceId: 'ntub-campus', office: '全校最新消息', listUrl: 'https://www.ntub.edu.tw/' },
    { sourceId: 'ntub-aca', office: '教務處', listUrl: 'https://aca.ntub.edu.tw/' },
  ],
};

export function listAnnouncementCatalogLinks(schoolId: string): AnnouncementCatalogLink[] {
  return [...(ANNOUNCEMENT_CATALOG_LINKS[schoolId] ?? [])];
}
