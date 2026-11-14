import {
  formatPublicSchoolAddress,
  getPublicSchoolInfo,
  getSafePublicSchoolWebsiteUrl,
  PUBLIC_SCHOOL_INFO_CATALOG_URL,
} from './publicSchoolInfo';
import { toPublicSchoolId } from './schoolIds';

type ContactField = 'address' | 'phone' | 'website';

function contactField(text: string): ContactField | null {
  if (/^(地址|校址|聯絡地址|在哪裡|在哪裏|在哪邊|在哪|位在哪裡|位於哪裡)$/.test(text)) return 'address';
  if (/^(總機|電話總機|總機號碼|總機電話|總機電話號碼|電話|電話號碼|聯絡電話)$/.test(text)) return 'phone';
  if (/^(官網|官網網址|官方網站|官方網站網址|官方網址|網站|網址)$/.test(text)) return 'website';
  return null;
}

/** Match complete institution-level contact requests. Never substitute a switchboard for a unit or emergency line. */
export function getSchoolContactAnswer(
  schoolId: string | null | undefined,
  question: string,
  schoolName?: string | null,
): string | null {
  const school = getPublicSchoolInfo(toPublicSchoolId(schoolId), schoolName);
  if (!school || !question || question.length > 160) return null;
  const normalize = (value: string) => value.normalize('NFKC').replace(/\s/g, '').replace(/臺/g, '台');
  let text = normalize(question)
    .replace(/^(?:請問|想請問|我想知道|請告訴我|請提供|幫我查一下|幫我查)[,，]?/, '')
    .replace(/[?？!！。]+$/, '')
    .replace(/(?:呢|嗎)$/, '');
  const asksHowToContact = /^(?:如何|怎麼)聯絡/.test(text);
  if (asksHowToContact) text = text.replace(/^(?:如何|怎麼)聯絡/, '');
  const name = normalize(school.name);
  const subjects = [name, name.replace(/^(國立|市立|私立)/, ''), '我們學校', '我的學校', '這間學校', '這所學校', '目前選擇的學校', '學校', '本校', '校方'];
  const subject = subjects.find((prefix) => prefix && text.startsWith(prefix));
  if (subject) text = text.slice(subject.length).replace(/^的/, '');
  else if (!/^(校址|總機)/.test(text)) return null;

  if (asksHowToContact) {
    if (!subject || text) return null;
    text = '聯絡資訊';
  }
  const fields = new Set<ContactField>();
  if (/^(聯絡資訊|聯絡方式|聯絡資料)$/.test(text)) {
    fields.add('address').add('phone').add('website');
  } else {
    for (const part of text.split(/、|,|與|和|以及|及/)) {
      // Match the field before stripping a question suffix so "學校在哪裡" also works.
      const field = contactField(part) ?? contactField(part.replace(/(?:是什麼|是多少|多少|幾號|在哪裡|在哪裏|在哪|為何|是幾號|是幾碼)$/, ''));
      if (!field) return null;
      fields.add(field);
    }
  }

  const lines = [school.name];
  for (const field of fields) {
    if (field === 'address') lines.push(`名錄地址：${formatPublicSchoolAddress(school)}`);
    else if (field === 'phone') lines.push(`學校總機：${school.telephone}`);
    else {
      const url = getSafePublicSchoolWebsiteUrl(school.websiteUrl);
      if (!url) return null;
      lines.push(`學校官網：${url}`);
    }
  }
  lines.push(`來源：教育部 ${school.academicYear} 學年度大專校院名錄（${PUBLIC_SCHOOL_INFO_CATALOG_URL}）`);
  return lines.join('\n');
}
