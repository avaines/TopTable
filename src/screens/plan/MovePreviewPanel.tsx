import { Panel, tabularClass } from '../../ui'
import styles from './ViolationsPanel.module.css'
import type { MovePreview } from './moveConsequences'

export function MovePreviewPanel({ preview }: { preview: MovePreview }) {
  const label = (id: string) => preview.slots.find((slot) => slot.id === id)?.label ?? id
  return <Panel title={`Moving ${preview.guest.name}`}>
    <p>From {label(preview.from.tableId)}, seat <span className={tabularClass}>{preview.from.seatIndex + 1}</span>.</p>
    {preview.status === 'refused' ? <p>The top table keeps the protocol order, so its seats cannot take a moved guest. Dropping here puts them back.</p> : preview.status === 'home' ? <p>Their own seat. Dropping here puts them back.</p> : preview.status === 'nowhere' ? <p>Not over a seat. Dropping here puts them back.</p> : preview.to && <>
      <p>To {label(preview.to.tableId)}, seat <span className={tabularClass}>{preview.to.seatIndex + 1}</span>.</p>
      {preview.displacedGuest && <p>{preview.displacedGuest.name} moves to {label(preview.from.tableId)}, seat <span className={tabularClass}>{preview.from.seatIndex + 1}</span>.</p>}
      <p><span className={tabularClass}>{preview.reseatedCount}</span> other {preview.reseatedCount === 1 ? 'guest changes seat' : 'guests change seats'} too.</p>
      {preview.breaks.length > 0 && <section aria-labelledby="move-breaks"><h3 id="move-breaks">Would break</h3><ul className={styles.list}>{preview.breaks.map((v) => <li key={`${v.ruleId}-${v.message}`} data-severity={v.severity}><p className={styles.title}>{v.message}</p><p className={styles.meta}>{v.severity === 'hard' ? 'Hard' : 'Soft'}{v.detail ? ` · ${v.detail}` : ''}</p></li>)}</ul></section>}
      {preview.clears.length > 0 && <section aria-labelledby="move-clears"><h3 id="move-clears">Would clear</h3><ul className={styles.list}>{preview.clears.map((v) => <li key={`${v.ruleId}-${v.message}`} data-change="clears"><p className={styles.title} style={{ textDecoration: 'line-through' }}>{v.message}</p><p className={styles.meta}>{v.severity === 'hard' ? 'Hard' : 'Soft'}</p></li>)}</ul></section>}
      {preview.breaks.length === 0 && preview.clears.length === 0 && <p>Breaks nothing and clears nothing.</p>}
      <p>After this move the plan {preview.publishable ? 'can' : 'cannot'} be published.</p>
    </>}
  </Panel>
}
