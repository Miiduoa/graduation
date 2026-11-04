import Link from 'next/link';
import { inAppHref, pathButtonLabel } from './copy';
import { extractDueItems, parseBlocks, type Inline } from './markdown';
import styles from './AssistantReply.module.css';
import type { DueItem } from './types';

function InlineView({ nodes }: { nodes: Inline[] }) {
  return nodes.map((node, i) => {
    if (node.type === 'text') return <span key={i}>{node.value}</span>;
    if (node.type === 'strong')
      return (
        <strong key={i}>
          <InlineView nodes={node.children} />
        </strong>
      );
    if (node.type === 'em')
      return (
        <em key={i}>
          <InlineView nodes={node.children} />
        </em>
      );
    if (node.type === 'code') return <code key={i}>{node.value}</code>;
    const href = inAppHref(node.href);
    const label = node.label || (href ? pathButtonLabel(href) : node.href);
    if (href)
      return (
        <Link key={i} href={href} className={styles.path}>
          {label}
        </Link>
      );
    return <span key={i}>{label}</span>;
  });
}

function DueRows({ items }: { items: DueItem[] }) {
  if (!items.length) return null;
  return (
    <ul className={styles.dueList}>
      {items.map((item) => (
        <li key={item.title + item.dueLabel} className={styles.dueItem}>
          <strong>{item.title}</strong>
          <span className={styles.dueMeta}>
            {item.course ? `${item.course} · ` : ''}
            {item.dueLabel}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AssistantMarkdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  const listed = new Set(
    blocks.flatMap((block) =>
      block.type === 'ul' || block.type === 'ol'
        ? block.items.flatMap((item) => (item.due ? [item.due.title] : []))
        : [],
    ),
  );
  const extra = extractDueItems(text).filter((item) => !listed.has(item.title));
  return (
    <div className={styles.prose}>
      {blocks.map((block, i) => {
        if (block.type === 'h') {
          const Tag = block.level === 1 ? 'h2' : 'h3';
          return (
            <Tag key={i}>
              <InlineView nodes={block.children} />
            </Tag>
          );
        }
        if (block.type === 'quote')
          return (
            <blockquote key={i}>
              <InlineView nodes={block.children} />
            </blockquote>
          );
        if (block.type === 'ul' || block.type === 'ol') {
          const Tag = block.type === 'ul' ? 'ul' : 'ol';
          const dues = block.items.flatMap((item) => (item.due ? [item.due] : []));
          if (dues.length === block.items.length && dues.length)
            return <DueRows key={i} items={dues} />;
          return (
            <Tag key={i}>
              {block.items.map((item, j) => (
                <li key={j}>
                  {item.due ? (
                    <>
                      <strong>{item.due.title}</strong>
                      <span className={styles.dueMeta}>
                        {item.due.course ? ` ${item.due.course} · ` : ' '}
                        {item.due.dueLabel}
                      </span>
                    </>
                  ) : (
                    <InlineView nodes={item.children} />
                  )}
                </li>
              ))}
            </Tag>
          );
        }
        return (
          <p key={i}>
            <InlineView nodes={block.children} />
          </p>
        );
      })}
      {extra.length > 0 && listed.size === 0 ? <DueRows items={extra} /> : null}
    </div>
  );
}
