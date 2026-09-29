import { describe, expect, it } from 'vitest'
import { rule } from './conflicts.rule'
import type { SeatedTable } from '../seating'
import type { Guest } from '../types'

const guest = (id: string, conflictsWith: string[] = []): Guest => ({
  id, name: `Guest ${id}`, side: 'bride', role: 'guest', age: 'adult', household: null,
  partnerOf: null, conflictsWith, tags: [], allergies: [], dietaryPreferences: [],
  accessibility: [], socialType: 'sociable',
})
const table = (id: string, seats: (Guest | null)[], overflow: Guest[] = []): SeatedTable => ({
  id, kind: 'round', number: Number(id.split('-')[1]), label: id, capacity: seats.length,
  seats: seats.map((g) => (g ? { guest: g, pinned: false } : null)),
  overflow: overflow.map((g) => ({ guest: g, pinned: false })),
})

describe('conflicts rule', () => {
  it('counts reciprocal, one-sided and duplicate declarations once', () => {
    const a = guest('a', ['b', 'c'])
    const b = guest('b', ['a'])
    const c = guest('c')
    const result = rule.evaluate({ tables: [table('round-1', [a, b, c])], unseated: [] })
    expect(result.opportunities).toBe(2)
    expect(result.missed).toBe(2)
    expect(result.findings).toHaveLength(2)
  })

  it('ignores dangling ids and reports a pair sharing a table even when one overflows', () => {
    const a = guest('a', ['missing', 'b'])
    const b = guest('b')
    const result = rule.evaluate({ tables: [table('round-1', [a], [b])], unseated: [] })
    expect(result).toMatchObject({ opportunities: 1, missed: 1 })
    expect(result.findings).toHaveLength(1)
  })

  it('is quiet when the pair is seated at different tables and names both guests when together', () => {
    const a = guest('a', ['b'])
    const b = guest('b', ['a'])
    expect(rule.evaluate({ tables: [table('round-1', [a]), table('round-2', [b])], unseated: [] }).findings).toEqual([])
    const result = rule.evaluate({ tables: [table('round-1', [a, b])], unseated: [] })
    expect(result.findings[0]?.guestIds).toEqual(['a', 'b'])
    expect(result.findings[0]?.tableIds).toEqual(['round-1'])
  })
})
