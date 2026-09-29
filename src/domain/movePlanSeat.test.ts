import { describe, expect, it } from 'vitest'
import { movePlanSeat } from './movePlanSeat'
import { seatPins } from './seating'
import type { Guest } from './types'
import type { SeatMove } from './pins'

function guest(id: string): Guest {
  return { id, name: id, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable' }
}

function plan() {
  return seatPins({ roundTables: 2, seatsEach: 2, topTableSeats: 0 }, [guest('a'), guest('b'), guest('c')], [
    { guestId: 'a', tableId: 'round-1' }, { guestId: 'b', tableId: 'round-1' }, { guestId: 'c', tableId: 'round-2' },
  ])
}

describe('TT-23 movePlanSeat', () => {
  it('swaps exactly the two occupied guests and preserves every other seat and overflow record', () => {
    const before = plan()
    const move: SeatMove = { guestId: 'a', from: { tableId: 'round-1', seatIndex: 0 }, to: { tableId: 'round-1', seatIndex: 1 }, displacedGuestId: 'b' }
    const after = movePlanSeat(before, move)
    expect(after.tables[0]?.seats.map((seat) => seat?.guest.id ?? null)).toEqual(['b', 'a'])
    expect(after.tables[1]?.seats.map((seat) => seat?.guest.id ?? null)).toEqual(['c', null])
    expect(after.tables[0]?.seats[0]?.pinned).toBe(true)
    expect(after.tables[0]?.seats[1]?.pinned).toBe(true)
    expect(after.tables[1]).toBe(before.tables[1])
    expect(before.tables[0]?.seats.map((seat) => seat?.guest.id ?? null)).toEqual(['a', 'b'])
  })

  it('moves only the mover into an empty seat and leaves all other seat records identical', () => {
    const before = plan()
    const after = movePlanSeat(before, { guestId: 'a', from: { tableId: 'round-1', seatIndex: 0 }, to: { tableId: 'round-2', seatIndex: 1 } })
    expect(after.tables[0]?.seats.map((seat) => seat?.guest.id ?? null)).toEqual([null, 'b'])
    expect(after.tables[1]?.seats.map((seat) => seat?.guest.id ?? null)).toEqual(['c', 'a'])
    expect(after.tables[0]?.seats[1]).toBe(before.tables[0]?.seats[1])
    expect(after.unseated).toBe(before.unseated)
  })

  it('returns the same plan for an invalid, stale, top-table or own-seat move', () => {
    const before = plan()
    for (const move of [
      { guestId: 'missing', from: { tableId: 'round-1', seatIndex: 0 }, to: { tableId: 'round-2', seatIndex: 0 } },
      { guestId: 'a', from: { tableId: 'round-9', seatIndex: 0 }, to: { tableId: 'round-2', seatIndex: 0 } },
      { guestId: 'a', from: { tableId: 'round-1', seatIndex: 0 }, to: { tableId: 'top', seatIndex: 0 } },
      { guestId: 'a', from: { tableId: 'round-1', seatIndex: 0 }, to: { tableId: 'round-1', seatIndex: 0 } },
    ]) expect(movePlanSeat(before, move)).toBe(before)
  })
})
