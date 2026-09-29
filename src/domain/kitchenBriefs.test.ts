import { describe, expect, it } from 'vitest'
import { kitchenBriefsFor, withKitchenBriefs, type SeatingPlan, type SeatedTable } from './seating'
import type { Guest } from './types'

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return { id, name: `Guest ${id}`, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable', ...overrides }
}
function table(id: string, seats: (Guest | null)[], overflow: Guest[] = []): SeatedTable {
  return { id, kind: 'round', number: 1, label: `Table ${id}`, capacity: seats.length,
    seats: seats.map((g) => g ? { guest: g, pinned: false } : null), overflow: overflow.map((g) => ({ guest: g, pinned: true })) }
}

describe('kitchen brief derivation', () => {
  it('orders tables, seats, and overflow and includes names and actual allergens', () => {
    const first = guest('a', { name: 'Asha', allergies: ['nuts', 'dairy'] })
    const overflow = guest('b', { name: 'Bo', allergies: ['shellfish'] })
    const plan: SeatingPlan = { tables: [table('one', [first, null], [overflow]), table('two', [guest('c', { allergies: ['sesame'] })])], unseated: [] }
    expect(kitchenBriefsFor(plan)).toEqual([
      { tableId: 'one', tableLabel: 'Table one', guests: [{ id: 'a', name: 'Asha', allergies: ['nuts', 'dairy'] }, { id: 'b', name: 'Bo', allergies: ['shellfish'] }] },
      { tableId: 'two', tableLabel: 'Table two', guests: [{ id: 'c', name: 'Guest c', allergies: ['sesame'] }] },
    ])
  })

  it('excludes dietary preferences, is deterministic, and does not mutate the plan or guest arrays', () => {
    const allergy = guest('a', { allergies: ['nuts'], dietaryPreferences: ['vegan'] })
    const plan: SeatingPlan = { tables: [table('one', [allergy])], unseated: [] }
    const before = JSON.stringify(plan)
    const first = withKitchenBriefs(plan)
    const second = withKitchenBriefs(first)
    expect(first.kitchenBriefs).toEqual(second.kitchenBriefs)
    expect(JSON.stringify(plan)).toBe(before)
    expect(first.kitchenBriefs?.[0]?.guests[0]).not.toBe(allergy)
  })
})
