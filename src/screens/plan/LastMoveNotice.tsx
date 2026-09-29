import { Button, Panel, tabularClass } from '../../ui'
import type { MovePreview } from './moveConsequences'
export function LastMoveNotice({ move, onUndo }: { move: MovePreview; onUndo: () => void }) {
  const label = (id: string) => move.slots.find((slot) => slot.id === id)?.label ?? id
  return <Panel title="Last move"><p>Moved {move.guest.name} to {label(move.targetTableId ?? move.to?.tableId ?? move.from.tableId)}{move.status === 'table' ? move.targetSeat ? <> by automatic allocation to seat <span className={tabularClass}>{move.targetSeat.seatIndex + 1}</span>.</> : ' by automatic allocation; the table had no available seat, so they remain in overflow.' : <>, seat <span className={tabularClass}>{(move.to?.seatIndex ?? move.from.seatIndex) + 1}</span>.</>}{move.displacedGuest && <> {move.displacedGuest.name} moved to {label(move.from.tableId)}, seat <span className={tabularClass}>{move.from.seatIndex + 1}</span>.</>}</p><Button variant="secondary" onClick={onUndo}>Undo move</Button></Panel>
}
