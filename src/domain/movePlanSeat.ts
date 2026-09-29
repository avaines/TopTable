import type { SeatingPlan, Seat } from './seating'
import type { SeatMove } from './pins'

/** Apply a manual round-table move without invoking the allocator. */
export function movePlanSeat(plan: SeatingPlan, move: SeatMove): SeatingPlan {
  if (move.from.tableId === move.to.tableId && move.from.seatIndex === move.to.seatIndex) return plan
  const fromTable = plan.tables.find((table) => table.id === move.from.tableId)
  const toTable = plan.tables.find((table) => table.id === move.to.tableId)
  if (!fromTable || !toTable || fromTable.kind !== 'round' || toTable.kind !== 'round') return plan
  if (!Number.isInteger(move.from.seatIndex) || !Number.isInteger(move.to.seatIndex)) return plan
  if (move.from.seatIndex < 0 || move.to.seatIndex < 0 || move.from.seatIndex >= fromTable.capacity || move.to.seatIndex >= toTable.capacity) return plan
  const mover = fromTable.seats[move.from.seatIndex]
  if (!mover || mover.guest.id !== move.guestId) return plan
  const target = toTable.seats[move.to.seatIndex]
  if (target && move.displacedGuestId !== target.guest.id) return plan
  const tables = plan.tables.map((table) => {
    if (table.id !== fromTable.id && table.id !== toTable.id) return table
    const seats = table.seats.slice() as (Seat | null)[]
    if (table.id === fromTable.id) seats[move.from.seatIndex] = target ?? null
    if (table.id === toTable.id) seats[move.to.seatIndex] = mover
    return { ...table, seats }
  })
  return { ...plan, tables }
}
