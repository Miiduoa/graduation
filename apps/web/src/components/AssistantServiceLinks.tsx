import Link from 'next/link';
import {
  assistantServiceHref,
  ASSISTANT_SERVICE_CATEGORY_LABELS,
  getAssistantService,
  type AssistantServiceId,
} from '@campus/shared/src/assistantServices';
import styles from './AssistantServiceLinks.module.css';

export function AssistantServiceLinks({
  serviceIds,
  schoolId,
  audience = 'school',
}: {
  serviceIds: readonly AssistantServiceId[];
  schoolId: string;
  audience?: 'school' | 'platform';
}) {
  const services = [...new Set(serviceIds)].flatMap((id) => {
    const service = getAssistantService(id);
    const href = assistantServiceHref(id, schoolId, audience);
    return service && href ? [{ ...service, href }] : [];
  });
  if (!services.length) return null;
  const links = (items: typeof services) => (
    <nav className={styles.grid} aria-label="接續服務">
      {items.map((service) => (
        <Link className={styles.link} href={service.href} key={service.id}>
          <strong>開啟{service.label}</strong>
          <span>{service.summary}</span>
        </Link>
      ))}
    </nav>
  );
  return services.length > 6 ? (
    <details className={styles.catalog} open>
      <summary>服務總覽 · {services.length} 項</summary>
      <p>入口會保留目前選擇的學校；需要登入或角色權限的服務，會在該頁確認。</p>
      {Object.entries(ASSISTANT_SERVICE_CATEGORY_LABELS).map(([id, label], index) => {
        const group = services.filter((service) => service.category === id);
        return group.length ? (
          <details className={styles.category} key={id} open={index === 0}>
            <summary>{label} · {group.length} 項</summary>
            {links(group)}
          </details>
        ) : null;
      })}
    </details>
  ) : links(services);
}
