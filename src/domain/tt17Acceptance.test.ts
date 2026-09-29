import { describe, expect, it } from 'vitest'
import { allocate } from './allocate'
import type { SeatGuard } from './allocate'
import type { Guest } from './types'

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return { id, name: id, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable', ...overrides }
}

describe('TT-17 conflicts: allocator forward checking', () => {
  it('finds the feasible split when one conflicted guest is only allowed at seat 2', () => {
    const room = { roundTables: 2, seatsEach: 2, topTableSeats: 0 }
    const guests = [guest('a'), guest('b'), guest('c', { conflictsWith: ['d'] }), guest('d', { conflictsWith: ['c'] })]
    const guard: SeatGuard = ({ plan, tableId, seatIndex, guest: candidate }) => {
      if (candidate.id === 'd' && seatIndex !== 1) return false
      const table = plan.tables.find((item) => item.id === tableId)
      return !table?.seats.some((seat) => seat && (seat.guest.conflictsWith.includes(candidate.id) || candidate.conflictsWith.includes(seat.guest.id)))
    }
    const result = allocate(room, guests, [], { allowSeat: guard })
    expect(result.unseated).toEqual([])
    const occupants = result.tables.map((table) => table.seats.map((seat) => seat?.guest.id ?? null))
    expect(occupants).toContainEqual(['a', 'c'])
    expect(occupants).toContainEqual(['b', 'd'])
  })
})
