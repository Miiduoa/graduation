import Link from 'next/link';
import { SiteShell } from '@/components/SiteShell';
import styles from '@/components/academic/academic.module.css';

const ITEMS = [
  { href: '/map', title: '校園地圖', text: '找教室、行政單位和地點。' },
  { href: '/bus', title: '公車', text: '查路線與站牌。' },
  { href: '/cafeteria', title: '餐廳', text: '看今天開的店和菜單。' },
  { href: '/orders', title: '我的訂單', text: '看訂單狀態和取餐號碼。' },
  { href: '/community', title: '校園交流', text: '看同學在討論什麼。' },
  { href: '/friends', title: '找人', text: '用找人代號加好友。' },
  { href: '/timetable', title: '共同空堂', text: '選一位好友，找兩個人都沒課的時段。' },
];

export default function LifePage() {
  return (
    <SiteShell title="生活" subtitle="地圖、公車、餐廳、找人，都從這裡進。">
      <ul className={styles.list}>
        {ITEMS.map((item) => (
          <li key={item.href + item.title}>
            <div>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
            <Link className="btn" href={item.href}>
              打開 →
            </Link>
          </li>
        ))}
        <li>
          <div>
            <h3>報修</h3>
            <p>報修還沒開，有問題先找系辦或總務處。</p>
          </div>
        </li>
      </ul>
    </SiteShell>
  );
}
