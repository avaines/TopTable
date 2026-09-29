import { describe, expect, it } from 'vitest'
import { applySeatMove } from './pins'
import type { Pin } from './types'
import type { SeatMove } from './pins'

const tableDrop = (overrides: Partial<SeatMove> = {}): SeatMove => ({
  guestId: 'mover',
  from: { tableId: 'round-1', seatIndex: 0 },
  to: { tableId: 'round-1', seatIndex: 1 },
  ...overrides,
})

describe('TT-23 table-body pin source guard', () => {
  it('promotes a same-table table-only source to the exact chair dropped on', () => {
    const pins: Pin[] = [
      { guestId: 'mover', tableId: 'round-1' },
      { guestId: 'other', tableId: 'round-2' },
    ]

    expect(applySeatMove(pins, tableDrop())).toEqual([
      { guestId: 'mover', tableId: 'round-1', seatIndex: 1 },
      { guestId: 'other', tableId: 'round-2' },
    ])
    expect(pins).toEqual([
      { guestId: 'mover', tableId: 'round-1' },
      { guestId: 'other', tableId: 'round-2' },
    ])
  })

  it('rejects a stale move whose exact source chair conflicts with the mover pin', () => {
    const pins: Pin[] = [
      { guestId: 'mover', tableId: 'round-1', seatIndex: 2 },
      { guestId: 'other', tableId: 'round-2', seatIndex: 0 },
    ]

    expect(applySeatMove(pins, tableDrop())).toBe(pins)
  })

  it('keeps displaced exact pins and unrelated pin identity when a same-table drop swaps chairs', () => {
    const unrelated: Pin = { guestId: 'unrelated', tableId: 'round-2', seatIndex: 1 }
    const pins: Pin[] = [
      { guestId: 'mover', tableId: 'round-1' },
      { guestId: 'target', tableId: 'round-1', seatIndex: 1 },
      unrelated,
    ]

    const result = applySeatMove(pins, { ...tableDrop(), displacedGuestId: 'target' })

    expect(result).toEqual([
      { guestId: 'mover', tableId: 'round-1', seatIndex: 1 },
      { guestId: 'target', tableId: 'round-1', seatIndex: 0 },
      unrelated,
    ])
    expect(result[2]).toBe(unrelated)
  })
})
