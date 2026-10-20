import {
  campusEtaView, directionLabel, waitingStopLabel,
  type CampusNextRow,
} from '@/lib/transit';
import css from './transit.module.css';

function headingText(row: CampusNextRow): string {
  if (row.heading) return row.heading.startsWith('往') ? row.heading : `往 ${row.heading}`;
  return row.arrival ? directionLabel(row.arrival) : '';
}

export function CampusArrivalRow(props: {
  row: CampusNextRow;
  now: number;
  href?: string;
  onSelect?: () => void;
}) {
  const view = campusEtaView(props.row.arrival, props.now);
  const empty = view.kind === 'empty';
  const heading = headingText(props.row);
  const stop = waitingStopLabel(props.row.arrival?.stopName ?? '');
  const className = `${css.arrivalRow}${empty ? ` ${css.arrivalRowEmpty}` : ''}`;
  const label = [props.row.route, heading, stop, view.text].filter(Boolean).join('，');
  const inner = (
    <>
      <span className={css.routeBadge}>{props.row.route}</span>
      <span className={css.rowCopy}>
        {heading ? <strong>{heading}</strong> : null}
        {stop ? <small>{stop}</small> : null}
      </span>
      <span className={css.rowEta} data-kind={view.kind}>
        {view.kind === 'live' || view.kind === 'soon' ? <span className={css.liveMark} aria-hidden="true" /> : null}
        {view.text}
      </span>
    </>
  );
  if (props.href) {
    return <a className={className} href={props.href} aria-label={label}>{inner}</a>;
  }
  if (props.onSelect) {
    return <button type="button" className={className} onClick={props.onSelect} aria-label={label}>{inner}</button>;
  }
  return <div className={className}>{inner}</div>;
}
