import type { Pin } from './types'

export type SeatAddress = { tableId: string; seatIndex: number }
export type SeatMove = { guestId: string; from: SeatAddress; to: SeatAddress; displacedGuestId?: string }

/**
 * Pin bookkeeping for the plan: who is placed at which table. Pure — no import beyond `Pin`,
 * no store, no rendering — and one pin per guest by construction, so nothing here needs a
 * `Set`, an object's keys, or any other order that could vary between runs.
 */

/**
 * Writes `guestId` -> `tableId`, replacing any pin that guest already held at that pin's own
 * array index rather than appending a second one — otherwise `pinnedTableFor`'s `find` would
 * keep returning a guest's *first* table instead of their latest.
 *
 * Validates nothing and never throws: it never sees the guest list, so it cannot check that
 * `guestId` or `tableId` resolve to anything real. The only caller reads the guest out of the
 * list first, and `pinnedTableFor` ignores a pin it cannot resolve.
 */
export function pinGuest(pins: Pin[], guestId: string, tableId: string): Pin[] {
  const index = pins.findIndex((pin) => pin.guestId === guestId)
  if (index === -1) {
    return [...pins, { guestId, tableId }]
  }
  return pins.map((pin, i) => (i === index ? { guestId, tableId } : pin))
}

export function pinGuestToSeat(pins: Pin[], guestId: string, address: SeatAddress): Pin[] {
  const next = { guestId, tableId: address.tableId, seatIndex: address.seatIndex }
  const index = pins.findIndex((pin) => pin.guestId === guestId)
  if (index === -1) return [...pins, next]
  return pins.map((pin, i) => (i === index ? next : pin))
}

export function applySeatMove(pins: Pin[], move: SeatMove): Pin[] {
  const validAddress = (address: SeatAddress) => /^round-[1-9]\d*$/.test(address.tableId) && Number.isInteger(address.seatIndex) && address.seatIndex >= 0
  if (!validAddress(move.from) || !validAddress(move.to)) return pins
  const existing = pins.find((pin) => pin.guestId === move.guestId)
  if (existing && (existing.tableId !== move.from.tableId || existing.seatIndex !== move.from.seatIndex)) return pins
  if (move.from.tableId === move.to.tableId && move.from.seatIndex === move.to.seatIndex) return pins
  if (move.displacedGuestId === move.guestId) return pins
  let next = pinGuestToSeat(pins, move.guestId, move.to)
  if (move.displacedGuestId) next = pinGuestToSeat(next, move.displacedGuestId, move.from)
  return next
}

/**
 * Drops the pin naming `guestId`. Returns `pins` by the same reference when none matches —
 * `removeGuest` (src/domain/guests.ts) calls through to this on its own early return, and
 * depends on that reference holding.
 */
export function unpinGuest(pins: Pin[], guestId: string): Pin[] {
  if (!pins.some((pin) => pin.guestId === guestId)) {
    return pins
  }
  return pins.filter((pin) => pin.guestId !== guestId)
}

/** The table `guestId` is pinned to, or `null` when they hold no pin. */
export function pinnedTableFor(pins: Pin[], guestId: string): string | null {
  return pins.find((pin) => pin.guestId === guestId)?.tableId ?? null
}
