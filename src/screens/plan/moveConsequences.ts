import type { RuleReport } from '../../domain/rules/engine'
import { isPublishable } from '../../domain/rules/engine'
import type { SeatingPlan } from '../../domain/seating'
import type { Violation } from '../../domain/rules/contract'
import { movePlanSeat } from '../../domain/movePlanSeat'
import type { SeatMove } from '../../domain/pins'
import { tablesInRoom, type TableSlot } from '../../domain/seating'
import type { Guest, Pin, RoomConfig } from '../../domain/types'
import { allocate, type SeatGuard } from '../../domain/allocate'
import { pinGuest } from '../../domain/pins'
import { seatPins } from '../../domain/seating'
import { evaluateRegisteredWithKitchenBriefs } from '../../domain/rules/registry'

export type ViolationChanges = { breaks: readonly Violation[]; clears: readonly Violation[] }

function identity(v: Violation): string {
  const guests = [...v.guestIds].sort().join(',')
  return `${v.ruleId}|${guests}|${v.guestIds.length ? '' : v.message}`
}

export function violationChanges(before: RuleReport, after: RuleReport): ViolationChanges {
  const old = new Set(before.violations.map(identity))
  const next = new Set(after.violations.map(identity))
  const order = (a: Violation, b: Violation) => (a.severity === b.severity ? 0 : a.severity === 'hard' ? -1 : 1)
  return {
    breaks: after.violations.filter((v) => !old.has(identity(v))).sort(order),
    clears: before.violations.filter((v) => !next.has(identity(v))).sort(order),
  }
}

export function reseatedGuestIds(before: SeatingPlan, after: SeatingPlan, excluded: readonly string[] = []): string[] {
  const skip = new Set(excluded)
  const location = (plan: SeatingPlan, id: string) => {
    for (const table of plan.tables) {
      const index = table.seats.findIndex((seat) => seat?.guest.id === id)
      if (index >= 0) return `${table.id}:${index}`
      if (table.overflow.some((seat) => seat.guest.id === id)) return `${table.id}:overflow`
    }
    return 'unseated'
  }
  const ids = new Set([...before.unseated.map((g) => g.id), ...after.unseated.map((g) => g.id)])
  for (const table of [...before.tables, ...after.tables]) for (const seat of [...table.seats, ...table.overflow]) if (seat) ids.add(seat.guest.id)
  return [...ids].filter((id) => !skip.has(id) && location(before, id) !== location(after, id))
}

export function isMovePublishable(report: RuleReport): boolean { return isPublishable(report) }

export type MovePreview = {
  guest: Guest
  from: SeatMove['from']
  to: SeatMove['to'] | null
  displacedGuest: Guest | null
  reseatedCount: number
  breaks: readonly Violation[]
  clears: readonly Violation[]
  publishable: boolean
  slots: readonly TableSlot[]
  status: 'move' | 'home' | 'nowhere' | 'refused' | 'table'
  targetTableId?: string
  targetSeat?: { tableId: string; seatIndex: number } | null
  targetOverflow?: boolean
}

export function derivePlan(room: RoomConfig, guests: Guest[], pins: Pin[], allocated: boolean, guard?: Parameters<typeof allocate>[3]): SeatingPlan {
  return allocated ? allocate(room, guests, pins, guard) : seatPins(room, guests, pins)
}

export function buildMovePreview(plan: SeatingPlan, guests: Guest[], move: SeatMove, beforeReport: RuleReport, room: RoomConfig): MovePreview {
  const guest = guests.find((candidate) => candidate.id === move.guestId) ?? { id: move.guestId, name: move.guestId } as Guest
  const displacedGuest = move.displacedGuestId ? guests.find((candidate) => candidate.id === move.displacedGuestId) ?? null : null
  const after = movePlanSeat(plan, move)
  const afterReport = evaluateRegisteredWithKitchenBriefs(after).report
  return {
    guest, from: move.from, to: move.to, displacedGuest,
    reseatedCount: reseatedGuestIds(plan, after, [move.guestId, ...(move.displacedGuestId ? [move.displacedGuestId] : [])]).length,
    ...violationChanges(beforeReport, afterReport),
    publishable: isPublishable(afterReport), slots: tablesInRoom(room),
    status: 'move',
  }
}

export function buildTableMovePreview(
  plan: SeatingPlan,
  guests: Guest[],
  pins: Pin[],
  guestId: string,
  tableId: string,
  beforeReport: RuleReport,
  room: RoomConfig,
  guard: SeatGuard,
): { preview: MovePreview; plan: SeatingPlan; pins: Pin[] } {
  const nextPins = pinGuest(pins, guestId, tableId)
  const nextPlan = allocate(room, guests, nextPins, { allowSeat: guard })
  const nextReport = evaluateRegisteredWithKitchenBriefs(nextPlan).report
  const guest = guests.find((candidate) => candidate.id === guestId) ?? ({ id: guestId, name: guestId } as Guest)
  const table = nextPlan.tables.find((candidate) => candidate.id === tableId)
  const targetIndex = table?.seats.findIndex((seat) => seat?.guest.id === guestId) ?? -1
  const targetSeat = targetIndex >= 0 ? { tableId, seatIndex: targetIndex } : null
  const targetOverflow = table?.overflow.some((seat) => seat.guest.id === guestId) ?? false
  const from = seatOfGuest(plan, guestId)
  return {
    preview: {
      guest,
      from: from ?? { tableId, seatIndex: 0 },
      to: targetSeat,
      displacedGuest: null,
      reseatedCount: reseatedGuestIds(plan, nextPlan, [guestId]).length,
      ...violationChanges(beforeReport, nextReport),
      publishable: isPublishable(nextReport),
      slots: tablesInRoom(room),
      status: 'table',
      targetTableId: tableId,
      targetSeat,
      targetOverflow,
    },
    plan: nextPlan,
    pins: nextPins,
  }
}

function seatOfGuest(plan: SeatingPlan, guestId: string): { tableId: string; seatIndex: number } | null {
  for (const table of plan.tables) {
    const index = table.seats.findIndex((seat) => seat?.guest.id === guestId)
    if (index >= 0) return { tableId: table.id, seatIndex: index }
  }
  return null
}
