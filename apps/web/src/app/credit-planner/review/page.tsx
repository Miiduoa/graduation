'use client';

import { AcademicPage } from '@/components/academic/AcademicPage';
import { CreditTranscriptReview } from '@/components/academic/CreditTranscriptReview';

export default function CreditTranscriptReviewPage() {
  return <AcademicPage kind="grades" title="已修學分核對"
    subtitle="從已有成績核對重修與分類，預覽後再帶入個人規劃。"
    closedAlternative="請先連線目前學校的本人帳號，或返回學分規劃手動核對；沒有資料不會清零原規劃。">
    {(snapshot) => <CreditTranscriptReview snapshot={snapshot} />}
  </AcademicPage>;
}
