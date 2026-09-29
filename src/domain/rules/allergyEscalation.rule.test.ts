import { describe, expect, it } from 'vitest'
import { evaluatePlan } from './engine'
import { evaluateRegisteredWithKitchenBriefs } from './registry'
import { rule } from './allergyEscalation.rule'
import type { Guest } from '../types'
import type { SeatingPlan, SeatedTable } from '../seating'

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return { id, name: `Guest ${id}`, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null, conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable', ...overrides }
}
function plan(seats: (Guest | null)[], unseated: Guest[] = [], briefs?: SeatingPlan['kitchenBriefs']): SeatingPlan {
  const table: SeatedTable = { id: 'round-1', kind: 'round', number: 1, label: 'Table 1', capacity: seats.length,
    seats: seats.map((g) => g ? { guest: g, pinned: false } : null), overflow: [] }
  return { tables: [table], unseated, kitchenBriefs: briefs }
}

describe('allergy escalation rule', () => {
  it('aggregates seated misses by table and counts unseated allergy guests as opportunities and misses', () => {
    const seated = guest('a', { name: 'Asha', allergies: ['nuts'] })
    const unseated = guest('b', { allergies: ['dairy'] })
    const report = evaluatePlan(plan([seated], [unseated]), [rule])
    expect(report.violations).toHaveLength(1)
    expect(report.violations[0]?.message).toContain('Asha')
    expect(report.outcomes[0]).toMatchObject({ opportunities: 2, missed: 2 })
  })

  it('ignores orphan briefs and dietary-only guests, while generated briefs satisfy the hard rule', () => {
    const allergy = guest('a', { allergies: ['nuts'] })
    const dietary = guest('d', { dietaryPreferences: ['vegan'] })
    const raw = plan([allergy, dietary], [], [{ tableId: 'missing', tableLabel: 'Missing', guests: [] }])
    expect(evaluatePlan(raw, [rule]).violations).toHaveLength(1)
    const evaluated = evaluateRegisteredWithKitchenBriefs(raw)
    expect(evaluated.report.violations.filter((v) => v.ruleId === 'allergy-escalation')).toEqual([])
    expect(evaluated.report.outcomes.find((o) => o.ruleId === 'allergy-escalation')).toMatchObject({ opportunities: 1, missed: 0 })
  })

  it('flags stale names and allergen lists as hard findings, but refreshed briefs clear them', () => {
    const allergy = guest('a', { name: 'Current name', allergies: ['nuts', 'dairy'] })
    const stale = plan([allergy], [], [{ tableId: 'round-1', tableLabel: 'Table 1', guests: [{ id: 'a', name: 'Old name', allergies: ['nuts'] }] }])
    expect(evaluatePlan(stale, [rule]).violations[0]).toMatchObject({ severity: 'hard', remedy: 'flag', guestIds: ['a'] })
    expect(evaluateRegisteredWithKitchenBriefs(stale).report.violations.filter((v) => v.ruleId === 'allergy-escalation')).toEqual([])
  })
})
