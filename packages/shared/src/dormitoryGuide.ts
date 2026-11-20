/**
 * Public residence guide for supported campuses. This is reference information,
 * not live availability, a room assignment, a payment record or an application.
 */
export type DormRoomGuide = {
  name: string;
  semesterFee: number;
  deposit: number;
  note?: string;
};

export type DormHallGuide = {
  id: string;
  name: string;
  summary: string;
  roomTypes: readonly DormRoomGuide[];
};

export type DormitoryPublicGuide = {
  title: string;
  officialWebsite: string;
  feeSource: string;
  checkedAt: string;
  officePhone: string;
  officeExtensions: string;
  serviceHours: string;
  emergencyPhone: string;
  halls: readonly DormHallGuide[];
};

/** Checked against the university's public room and fee table on 2026-10-25. */
export const PU_DORMITORY_GUIDE: DormitoryPublicGuide = {
  title: '靜宜大學學生宿舍',
  officialWebsite: 'https://osadorm.pu.edu.tw/',
  feeSource: 'https://c032.pu.edu.tw/p/412-1065-1970.php?Lang=zh-tw',
  checkedAt: '2026-10-25',
  officePhone: '04-26328001',
  officeExtensions: '11241–11248、11250–11255',
  serviceHours: '週一至週五 08:30–22:00；週六、日 09:00–18:00',
  emergencyPhone: '0921-382470',
  halls: [
    {
      id: 'schultz',
      name: '希嘉學苑',
      summary: '有不同人數房型；實際開放對象與分配方式依校方公告。',
      roomTypes: [
        { name: '四人房', semesterFee: 10500, deposit: 550 },
        { name: '一樓三人房', semesterFee: 10000, deposit: 550 },
        { name: '二人房', semesterFee: 14500, deposit: 550, note: '特殊房型，優先安排符合校方資格者' },
        { name: '樑位三人房', semesterFee: 11000, deposit: 550, note: '限二年級以上申請' },
      ],
    },
    {
      id: 'bosco',
      name: '思高學苑',
      summary: '男生住宿房型；特殊房型依校方分配資格辦理。',
      roomTypes: [
        { name: '三人房', semesterFee: 10500, deposit: 550 },
        { name: '二人房', semesterFee: 13500, deposit: 550, note: '特殊房型，優先安排符合校方資格者' },
      ],
    },
    {
      id: 'shepherd',
      name: '善牧學苑',
      summary: '男女住宿皆有四人房，依學校分配安排。',
      roomTypes: [
        { name: '四人房', semesterFee: 15500, deposit: 1000 },
      ],
    },
  ],
};

export function resolveDormitoryPublicGuide(schoolId: string | null | undefined): DormitoryPublicGuide | null {
  const normalized = (schoolId ?? '').trim().toLowerCase();
  return normalized === 'pu' || normalized === 'tw-pu' ? PU_DORMITORY_GUIDE : null;
}
