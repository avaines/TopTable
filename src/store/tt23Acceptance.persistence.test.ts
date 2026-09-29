import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY, useTopTableStore } from './store'
import { allocate } from '../domain/allocate'
import { seatOf } from '../domain/seating'
import type { Guest } from '../domain/types'

function guest(id: string): Guest { return { id, name: id, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null, conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable' } }

beforeEach(() => { useTopTableStore.getState().reset(); localStorage.clear() })

describe('TT-23 exact pins persist as human decisions', () => {
  it('persists exact seat pins at storage version 4 and a fresh allocation keeps the fixed chairs', async () => {
    const guests = [guest('a'), guest('b')]
    useTopTableStore.getState().setRoom({ roundTables: 1, seatsEach: 2, topTableSeats: 0 })
    useTopTableStore.getState().setGuests(guests)
    useTopTableStore.getState().moveGuest({ guestId: 'a', from: { tableId: 'round-1', seatIndex: 0 }, to: { tableId: 'round-1', seatIndex: 1 } })
    const persisted: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (!persisted || typeof persisted !== 'object' || !('version' in persisted)) throw new Error('expected persisted version')
    expect(persisted.version).toBe(4)
    vi.resetModules()
    const { useTopTableStore: reloaded } = await import('./store')
    expect(reloaded.getState().pins).toEqual([{ guestId: 'a', tableId: 'round-1', seatIndex: 1 }])
    const plan = allocate(reloaded.getState().room, reloaded.getState().guests, reloaded.getState().pins)
    expect(seatOf(plan, 'a')?.table.id).toBe('round-1')
    expect(seatOf(plan, 'a')?.seatIndex).toBe(1)
  })
})
