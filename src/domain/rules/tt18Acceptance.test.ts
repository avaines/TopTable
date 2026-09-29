import { describe, expect, it } from 'vitest'
import type { Guest } from '../types'
import type { KitchenBrief, SeatingPlan, SeatedTable } from '../seating'
import { kitchenBriefsFor, withKitchenBriefs } from '../seating'
import { rule } from './allergyEscalation.rule'
import { evaluateRegistered, evaluateRegisteredWithKitchenBriefs, REGISTERED_RULES } from './registry'
import { isPublishable } from './engine'
import { scorePlan } from './score'

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return { id, name: `Guest ${id}`, side: 'both', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable', ...overrides }
}

function table(id: string, people: Guest[], overflow: Guest[] = []): SeatedTable {
  return { id, label: `Table ${id}`, kind: 'round', number: 1, capacity: people.length,
    seats: people.map((person) => ({ guest: person, pinned: false })), overflow: overflow.map((person) => ({ guest: person, pinned: true })) }
}

const allergyGuest = () => guest('a', { name: 'Asha Rao', allergies: ['nuts', 'sesame'] })
function brief(overrides: Partial<KitchenBrief> = {}): KitchenBrief {
  return { tableId: 'one', tableLabel: 'Table one', guests: [{ id: 'a', name: 'Asha Rao', allergies: ['nuts', 'sesame'] }], ...overrides }
}

function raw(kitchenBriefs?: KitchenBrief[]): SeatingPlan {
  return { tables: [table('one', [allergyGuest()])], unseated: [], kitchenBriefs }
}

function allergyOutcome(plan: SeatingPlan) {
  const outcome = evaluateRegistered(plan).outcomes.find((item) => item.ruleId === 'allergy-escalation')
  if (!outcome) throw new Error('Allergy escalation was not registered')
  return outcome
}

describe('TT-18: independently validated kitchen-brief obligations', () => {
  it.each([
    { label: 'missing brief', briefs: undefined },
    { label: 'wrong table identity', briefs: [brief({ tableId: 'two' })] },
    { label: 'stale table label', briefs: [brief({ tableLabel: 'Old table name' })] },
    { label: 'wrong guest identity', briefs: [brief({ guests: [{ id: 'other', name: 'Asha Rao', allergies: ['nuts', 'sesame'] }] })] },
    { label: 'stale guest name alone', briefs: [brief({ guests: [{ id: 'a', name: 'Old name', allergies: ['nuts', 'sesame'] }] })] },
    { label: 'missing allergen alone', briefs: [brief({ guests: [{ id: 'a', name: 'Asha Rao', allergies: ['nuts'] }] })] },
    { label: 'stale allergen with the same count', briefs: [brief({ guests: [{ id: 'a', name: 'Asha Rao', allergies: ['nuts', 'dairy'] }] })] },
    { label: 'duplicate allergen hiding a missing one', briefs: [brief({ guests: [{ id: 'a', name: 'Asha Rao', allergies: ['nuts', 'nuts'] }] })] },
  ])('$label blocks publication until regenerated', ({ briefs }) => {
    const plan = raw(briefs)
    const report = evaluateRegistered(plan)
    const violations = report.violations.filter((v) => v.ruleId === 'allergy-escalation')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ severity: 'hard', remedy: 'flag', tableIds: ['one'], guestIds: ['a'] })
    expect(violations[0]?.message).toContain('Asha Rao')
    expect(isPublishable(report)).toBe(false)
    expect(allergyOutcome(plan)).toMatchObject({ opportunities: 1, missed: 1, weight: 3 })
    const corrected = evaluateRegisteredWithKitchenBriefs(plan)
    expect(corrected.plan.kitchenBriefs).toEqual([brief()])
    expect(isPublishable(corrected.report)).toBe(true)
  })

  it('accepts the exact current allergen set regardless of list order', () => {
    const plan = raw([brief({ guests: [{ id: 'a', name: 'Asha Rao', allergies: ['sesame', 'nuts'] }] })])
    expect(rule.evaluate(plan)).toMatchObject({ findings: [], opportunities: 1, missed: 0 })
    expect(isPublishable(evaluateRegistered(plan))).toBe(true)
  })

  it('counts allergy guests across seats, overflow and unseated without counting dietary preferences', () => {
    const a = allergyGuest()
    const b = guest('b', { name: 'Bo Green', allergies: ['dairy'] })
    const c = guest('c', { name: 'Cleo Blue', allergies: ['shellfish'] })
    const dietary = guest('d', { dietaryPreferences: ['vegan', 'gluten free'] })
    const plan: SeatingPlan = { tables: [table('one', [a, dietary], [b])], unseated: [c] }
    const assessment = rule.evaluate(plan)
    expect(assessment).toMatchObject({ opportunities: 3, missed: 3 })
    expect(assessment.findings).toHaveLength(1)
    expect(assessment.findings[0]?.guestIds).toEqual(['a', 'b'])
    expect(assessment.findings[0]?.message).toContain('Asha Rao')
    expect(assessment.findings[0]?.message).toContain('Bo Green')
    expect(assessment.findings[0]?.message).not.toContain('Cleo Blue')
    const generated = evaluateRegisteredWithKitchenBriefs(plan)
    expect(generated.plan.kitchenBriefs).toEqual([brief({ guests: [
      { id: 'a', name: 'Asha Rao', allergies: ['nuts', 'sesame'] },
      { id: 'b', name: 'Bo Green', allergies: ['dairy'] },
    ] })])
    expect(rule.evaluate(generated.plan)).toMatchObject({ findings: [], opportunities: 3, missed: 1 })
    const dimension = scorePlan(generated.report, { guests: 4, seated: 2 }).dimensions.find((d) => d.ruleId === 'allergy-escalation')
    expect(dimension).toMatchObject({ severity: 'hard', weight: 3, opportunities: 3, missed: 1 })
    expect(dimension?.fit).toBeCloseTo(2 / 3)
    for (const p of [plan, generated.plan]) {
      const result = rule.evaluate(p)
      expect(result.findings.length).toBeLessThanOrEqual(result.missed)
      expect(result.missed).toBeLessThanOrEqual(result.opportunities)
    }
  })

  it('a dietary-only plan gives allergy escalation no opportunities, score dimension or briefs', () => {
    const dietary = guest('d', { dietaryPreferences: ['nuts', 'vegan'] })
    const plan: SeatingPlan = { tables: [table('one', [dietary])], unseated: [] }
    expect(rule.evaluate(plan)).toEqual({ findings: [], opportunities: 0, missed: 0 })
    const generated = evaluateRegisteredWithKitchenBriefs(plan)
    expect(generated.plan.kitchenBriefs).toEqual([])
    expect(scorePlan(generated.report, { guests: 1, seated: 1 }).dimensions.some((d) => d.ruleId === 'allergy-escalation')).toBe(false)
    expect(isPublishable(generated.report)).toBe(true)
  })

  it('refreshing after moving and editing a guest replaces old table/name/allergens and removes orphan entries without mutation', () => {
    const previous = withKitchenBriefs(raw())
    const edited = guest('a', { name: 'Asha Patel', allergies: ['dairy'] })
    const moved: SeatingPlan = { ...previous, tables: [table('one', []), table('two', [edited])], unseated: [] }
    const before = JSON.stringify(moved)
    const current = evaluateRegisteredWithKitchenBriefs(moved)
    expect(current.plan.kitchenBriefs).toEqual([{ tableId: 'two', tableLabel: 'Table two', guests: [{ id: 'a', name: 'Asha Patel', allergies: ['dairy'] }] }])
    expect(JSON.stringify(moved)).toBe(before)
    expect(evaluateRegisteredWithKitchenBriefs(moved)).toEqual(current)
    expect(isPublishable(current.report)).toBe(true)
    const removed: SeatingPlan = { ...current.plan, tables: [table('two', [guest('a')])], unseated: [] }
    expect(rule.evaluate(removed)).toEqual({ findings: [], opportunities: 0, missed: 0 })
    expect(kitchenBriefsFor(removed)).toEqual([])
    expect(withKitchenBriefs(removed).kitchenBriefs).toEqual([])
  })

  it('registers the flag-only hard rule with the normal default weight', () => {
    expect(REGISTERED_RULES.filter((item) => item.id === 'allergy-escalation')).toHaveLength(1)
    expect(rule).toMatchObject({ severity: 'hard', remedy: 'flag' })
    expect(allergyOutcome(raw())).toMatchObject({ severity: 'hard', weight: 3 })
  })
})
