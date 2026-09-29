import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allocate } from '../allocate'
import { PROTOCOL_ROLES } from '../types'
import type { Guest, Pin, RoomConfig } from '../types'
import type { SeatingPlan, SeatedTable } from '../seating'
import { evaluateRegistered, evaluateRegisteredWithKitchenBriefs, registeredSeatGuard } from './registry'
import { isPublishable, seatGuardFrom } from './engine'
import type { GuardPlan, SeatingRule } from './contract'
import { rule as partnerRule } from './partnersAdjacent.rule'
import { scorePlan } from './score'

function guest(id: string, partnerOf: string | null = null, role: Guest['role'] = 'guest'): Guest {
  return { id, name: `Guest ${id}`, partnerOf, role, side: 'both', age: 'adult', household: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable' }
}

function table(id: string, capacity: number, occupants: Record<number, Guest>): SeatedTable {
  return { id, kind: id === 'top' ? 'top' : 'round', number: id === 'top' ? null : 1,
    label: id, capacity, overflow: [], seats: Array.from({ length: capacity }, (_, i) => {
      const person = occupants[i]
      return person ? { guest: person, pinned: false } : null
    }) }
}

function pairsAdjacent(plan: SeatingPlan, guests: Guest[]): boolean {
  const seats = new Map(plan.tables.flatMap((t) => t.seats.flatMap((s, index) => s ? [[s.guest.id, { table: t, index }] as const] : [])))
  return guests.every((g) => {
    if (!g.partnerOf) return true
    const a = seats.get(g.id)
    const b = seats.get(g.partnerOf)
    if (a?.table.kind === 'top' || b?.table.kind === 'top') return true
    if (!a || !b || a.table.id !== b.table.id) return false
    const gap = Math.abs(a.index - b.index)
    return gap === 1 || gap === a.table.capacity - 1
  })
}

function expectConserved(plan: SeatingPlan, guests: Guest[], pins: Pin[]) {
  const people = [...plan.unseated, ...plan.tables.flatMap((t) => [...t.seats.flatMap((s) => s ? [s.guest] : []), ...t.overflow.map((s) => s.guest)])]
  expect(people.map((g) => g.id).sort()).toEqual(guests.map((g) => g.id).sort())
  for (const pin of pins) {
    const t = plan.tables.find((candidate) => candidate.id === pin.tableId)
    expect([...t?.seats ?? [], ...t?.overflow ?? []].some((s) => s?.guest.id === pin.guestId && s.pinned)).toBe(true)
  }
}

function solve(room: RoomConfig, guests: Guest[], pins: Pin[] = []) {
  return allocate(room, guests, pins, { allowSeat: registeredSeatGuard() })
}

describe('TT-45: partner findings and score through the real registry', () => {
  it('a separated round-table couple is named once, hard, weighted three and blocks publication', () => {
    const a = guest('a', 'b'); const b = guest('b', 'a')
    const report = evaluateRegistered({ tables: [table('round-1', 4, { 0: a, 2: b })], unseated: [] })
    const violations = report.violations.filter((v) => v.ruleId === 'partners-adjacent')
    expect(violations).toHaveLength(1)
    expect(violations[0]).toMatchObject({ severity: 'hard', remedy: 'seating', guestIds: ['a', 'b'] })
    expect(violations[0]?.message).toContain('Guest a')
    expect(violations[0]?.message).toContain('Guest b')
    expect(isPublishable(report)).toBe(false)
    const score = scorePlan(report, { guests: 2, seated: 2 })
    expect(score.dimensions.find((d) => d.ruleId === 'partners-adjacent')).toMatchObject({ severity: 'hard', weight: 3, opportunities: 1, missed: 1 })
    expect(score.score).toBe(67)
  })

  it.each(['top', 'round', 'unseated'] as const)('either member at top exempts the pair when the other is %s, including scoring', (where) => {
    for (const reverse of [false, true]) {
      const a = guest('a', 'b', 'groom'); const b = guest('b', 'a', 'bride')
      const [atTop, other] = reverse ? [b, a] : [a, b]
      const tables = [table('top', 8, where === 'top' ? { 0: atTop, 7: other } : { 0: atTop })]
      if (where === 'round') tables.push(table('round-1', 4, { 0: other }))
      const report = evaluateRegistered({ tables, unseated: where === 'unseated' ? [other] : [] })
      expect(report.violations.filter((v) => v.ruleId === 'partners-adjacent')).toEqual([])
      expect(report.outcomes.find((o) => o.ruleId === 'partners-adjacent')).toMatchObject({ opportunities: 0, missed: 0 })
      expect(scorePlan(report, { guests: 2, seated: where === 'unseated' ? 1 : 2 }).dimensions.some((d) => d.ruleId === 'partners-adjacent')).toBe(false)
    }
  })
})

describe('TT-45: auto-allocation finds seating for couples', () => {
  it.each([{ pins: [] }, { pins: [{ guestId: 'a', tableId: 'round-1' }] }, { pins: [{ guestId: 'a', tableId: 'round-1' }, { guestId: 'c', tableId: 'round-1' }, { guestId: 'b', tableId: 'round-1' }] }])('rearranges interleaved couples including table-pinned chairs: %j', ({ pins }) => {
    const guests = [guest('a', 'b'), guest('c', 'd'), guest('b', 'a'), guest('d', 'c')]
    const room = { roundTables: 1, seatsEach: 4, topTableSeats: 0 }
    const before = JSON.stringify({ room, guests, pins })
    const plan = solve(room, guests, pins)
    expect(plan.unseated).toEqual([])
    expect(pairsAdjacent(plan, guests)).toBe(true)
    expect(isPublishable(evaluateRegistered(plan))).toBe(true)
    expectConserved(plan, guests, pins)
    expect(solve(room, guests, pins)).toEqual(plan)
    expect(JSON.stringify({ room, guests, pins })).toBe(before)
  })

  it('seats singles and constrained couples without wasting the only table suitable for a pair', () => {
    const guests = [guest('solo'), guest('a', 'b'), guest('b', 'a')]
    const pins = [{ guestId: 'solo', tableId: 'round-1' }]
    const plan = solve({ roundTables: 2, seatsEach: 2, topTableSeats: 0 }, guests, pins)
    expect(plan.unseated).toEqual([])
    expect(pairsAdjacent(plan, guests)).toBe(true)
    expectConserved(plan, guests, pins)
  })

  it('honours conflicting table pins, fills usable seats and names the impossible pair', () => {
    const guests = [guest('a', 'b'), guest('b', 'a'), guest('solo')]
    const pins = [{ guestId: 'a', tableId: 'round-1' }, { guestId: 'b', tableId: 'round-2' }]
    const room = { roundTables: 2, seatsEach: 2, topTableSeats: 0 }
    const plan = solve(room, guests, pins)
    expect(plan.unseated).toEqual([])
    expectConserved(plan, guests, pins)
    const report = evaluateRegistered(plan)
    expect(isPublishable(report)).toBe(false)
    const finding = report.violations.find((v) => v.ruleId === 'partners-adjacent')
    expect(finding?.message).toContain('Guest a')
    expect(finding?.message).toContain('Guest b')
    expect(solve(room, guests, pins)).toEqual(plan)
  })

  it('two single-chair tables seat both people and report the impossible adjacency', () => {
    const guests = [guest('a', 'b'), guest('b', 'a')]
    const plan = solve({ roundTables: 2, seatsEach: 1, topTableSeats: 0 }, guests)
    expect(plan.unseated).toEqual([])
    expect(evaluateRegistered(plan).violations.some((v) => v.ruleId === 'partners-adjacent')).toBe(true)
    expectConserved(plan, guests, [])
  })

  it.each([false, true])('resolves a one-sided partnership declaration in either guest-list direction: %s', (reverse) => {
    const guests = [guest('a'), guest('solo'), guest('b', 'a')]
    if (reverse) guests.reverse()
    const plan = solve({ roundTables: 1, seatsEach: 4, topTableSeats: 0 }, guests)
    expect(plan.unseated).toEqual([])
    expect(pairsAdjacent(plan, guests)).toBe(true)
    expectConserved(plan, guests, [])
  })

  it('returns a usable large plan when pins alone already exceed one table capacity', () => {
    const pinned = Array.from({ length: 9 }, (_, i) => guest(`pinned-${i}`))
    const couples = Array.from({ length: 80 }, (_, i) => [guest(`a-${i}`, `b-${i}`), guest(`b-${i}`, `a-${i}`)]).flat()
    const guests = [...pinned, ...couples, ...Array.from({ length: 31 }, (_, i) => guest(`solo-${i}`))]
    const pins = pinned.map((g) => ({ guestId: g.id, tableId: 'round-1' }))
    const plan = solve({ roundTables: 26, seatsEach: 8, topTableSeats: 0 }, guests, pins)
    expectConserved(plan, guests, pins)
    expect(plan.tables.find((t) => t.id === 'round-1')?.overflow).toHaveLength(1)
    expect(plan.unseated).toEqual([])
    expect(evaluateRegistered(plan).violations.some((v) => v.ruleId === 'capacity')).toBe(true)
  })

  it('chooses a protocol overflow table with room for both external partners', () => {
    const protocol = PROTOCOL_ROLES.map((role, index) => guest(`role-${index}`, index === 0 ? 'p0' : index === 7 ? 'p7' : null, role))
    const guests = [...protocol, guest('p0', 'role-0'), guest('p7', 'role-7'), guest('solo')]
    const pins = [{ guestId: 'solo', tableId: 'round-1' }]
    const plan = solve({ roundTables: 2, seatsEach: 4, topTableSeats: 6 }, guests, pins)
    expect(plan.unseated).toEqual([])
    expect(pairsAdjacent(plan, guests)).toBe(true)
    const overflowTable = plan.tables.find((t) => t.seats.some((s) => s?.guest.id === 'role-0'))
    expect(overflowTable?.id).toBe('round-2')
    expect(overflowTable?.seats.some((s) => s?.guest.id === 'role-7')).toBe(true)
    expectConserved(plan, guests, pins)
    expect(isPublishable(evaluateRegistered(plan))).toBe(true)
  })

  it('an omitted protocol role pinned to the small top table still joins the round-table overflow group', () => {
    const protocol = PROTOCOL_ROLES.map((role, index) => guest(`role-${index}`, null, role))
    const guests = [...protocol, guest('a', 'b'), guest('b', 'a')]
    const plan = solve({ roundTables: 2, seatsEach: 4, topTableSeats: 6 }, guests, [{ guestId: 'role-0', tableId: 'top' }])
    const chiefTable = plan.tables.find((t) => t.seats.some((s) => s?.guest.id === 'role-0'))
    expect(chiefTable?.kind).toBe('round')
    expect(chiefTable?.seats.some((s) => s?.guest.id === 'role-7')).toBe(true)
    expectConserved(plan, guests, [])
    expect(isPublishable(evaluateRegistered(plan))).toBe(true)
  })

  it('impossible partners do not bypass another hard seating rule in the fallback', () => {
    const forbidden: SeatingRule = {
      id: 'fixture-keep-solo-off-first-table', description: 'Solo cannot use the first table', severity: 'hard', remedy: 'seating',
      evaluate: (plan: GuardPlan) => {
        const bad = plan.tables.find((t) => t.id === 'round-1' && t.seats.some((s) => s?.guest.id === 'solo'))
        return { opportunities: 1, missed: bad ? 1 : 0, findings: bad ? [{ guestIds: ['solo'], tableIds: ['round-1'], message: 'Solo is at the wrong table' }] : [] }
      },
    }
    const guests = [guest('a', 'b'), guest('b', 'a'), guest('solo')]
    const pins = [{ guestId: 'a', tableId: 'round-1' }, { guestId: 'b', tableId: 'round-2' }]
    const plan = allocate({ roundTables: 3, seatsEach: 2, topTableSeats: 0 }, guests, pins, { allowSeat: seatGuardFrom([partnerRule, forbidden]) })
    expect(plan.unseated).toEqual([])
    expect(forbidden.evaluate(plan).findings).toEqual([])
    expectConserved(plan, guests, pins)
    expect(evaluateRegistered(plan).violations.some((v) => v.ruleId === 'partners-adjacent')).toBe(true)
  })

  it('a short room seats both interleaved couples together and leaves the spare single unseated', () => {
    const guests = [guest('a', 'b'), guest('c', 'd'), guest('b', 'a'), guest('d', 'c'), guest('e')]
    const plan = solve({ roundTables: 2, seatsEach: 2, topTableSeats: 0 }, guests)
    expect(plan.unseated).toHaveLength(1)
    expect(plan.tables.flatMap((t) => t.seats).filter(Boolean)).toHaveLength(4)
    expect(evaluateRegisteredWithKitchenBriefs(plan).report.violations.filter((v) => v.severity === 'hard')).toEqual([])
    expectConserved(plan, guests, [])
  })

  it('fills a large short room with adjacent couples without searching permutations of equivalent empty tables', () => {
    const first = Array.from({ length: 100 }, (_, i) => guest(`a-${i}`, `b-${i}`))
    const second = Array.from({ length: 100 }, (_, i) => guest(`b-${i}`, `a-${i}`))
    const guests = [...first, ...second, guest('solo-1'), guest('solo-2')]
    const plan = solve({ roundTables: 25, seatsEach: 8, topTableSeats: 0 }, guests)
    expect(plan.unseated).toHaveLength(2)
    expect(evaluateRegisteredWithKitchenBriefs(plan).report.violations.filter((v) => v.severity === 'hard')).toEqual([])
    expectConserved(plan, guests, [])
  })

  it('reserves every table for future mandatory pins when only one member of each couple can fit', () => {
    const guests = Array.from({ length: 80 }, (_, i) => [guest(`a-${i}`, `b-${i}`), guest(`b-${i}`, `a-${i}`)]).flat()
    const pins = Array.from({ length: 80 }, (_, i) => ({ guestId: `a-${i}`, tableId: `round-${i % 10 + 1}` }))
    const plan = solve({ roundTables: 10, seatsEach: 8, topTableSeats: 0 }, guests, pins)
    expect(plan.unseated.map((g) => g.id).sort()).toEqual(Array.from({ length: 80 }, (_, i) => `b-${i}`).sort())
    expect(plan.tables.flatMap((t) => t.seats).filter(Boolean)).toHaveLength(80)
    expect(evaluateRegisteredWithKitchenBriefs(plan).report.violations.filter((v) => v.severity === 'hard')).toEqual([])
    expectConserved(plan, guests, pins)
  }, 2000)

  it('a short room still fills every usable seat without duplicating or losing a partner', () => {
    const guests = [guest('a', 'b'), guest('c', 'd'), guest('b', 'a'), guest('d', 'c')]
    const plan = solve({ roundTables: 1, seatsEach: 3, topTableSeats: 0 }, guests)
    expect(plan.unseated).toHaveLength(1)
    expect(plan.tables.flatMap((t) => t.seats).filter(Boolean)).toHaveLength(3)
    expectConserved(plan, guests, [])
  })

  it.each(['small-and-cosy', 'adding-up', 'celebrity-scale'])('%s: all guests seated, protocol respected and no implemented hard violations', (id) => {
    const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../public/scenarios', `${id}.json`), 'utf8')) as { meta: { tables: RoomConfig }; guests: Guest[] }
    const plan = solve(fixture.meta.tables, fixture.guests)
    expect(plan.unseated).toEqual([])
    expect(pairsAdjacent(plan, fixture.guests)).toBe(true)
    expect(evaluateRegisteredWithKitchenBriefs(plan).report.violations.filter((v) => v.severity === 'hard')).toEqual([])
    expectConserved(plan, fixture.guests, [])
    expect(solve(fixture.meta.tables, fixture.guests)).toEqual(plan)
  })
})

// Exhaustive chair permutations are an independent feasibility oracle, deliberately limited
// to small rooms so the test does not inherit the solver's table-assignment strategy.
function feasible(room: RoomConfig, guests: Guest[], pins: Pin[]): boolean {
  const slots = Array.from({ length: room.roundTables * room.seatsEach }, (_, i) => ({ table: Math.floor(i / room.seatsEach), chair: i % room.seatsEach }))
  const used = new Set<number>(); const positions = new Map<string, number>()
  function visit(index: number): boolean {
    const person = guests[index]
    if (!person) return true
    const pin = pins.find((p) => p.guestId === person.id)
    for (const [slotIndex, slot] of slots.entries()) {
      if (used.has(slotIndex) || (pin && pin.tableId !== `round-${slot.table + 1}`)) continue
      const partnerIndex = person.partnerOf ? positions.get(person.partnerOf) : undefined
      const partner = partnerIndex === undefined ? undefined : slots[partnerIndex]
      if (partner) {
        const gap = Math.abs(partner.chair - slot.chair)
        if (partner.table !== slot.table || !(gap === 1 || gap === room.seatsEach - 1)) continue
      }
      used.add(slotIndex); positions.set(person.id, slotIndex)
      if (visit(index + 1)) return true
      used.delete(slotIndex); positions.delete(person.id)
    }
    return false
  }
  return visit(0)
}

describe('TT-45: independent feasibility oracle over small pinned rooms', () => {
  it.each([2, 3, 4])('matches every feasible two-couple pin combination at two tables of %i', (seatsEach) => {
    const room = { roundTables: 2, seatsEach, topTableSeats: 0 }
    const couples = [guest('a', 'b'), guest('c', 'd'), guest('b', 'a'), guest('d', 'c')]
    const orders = [couples, [...couples].reverse()]
    for (const guests of orders) {
      for (let pattern = 0; pattern < 81; pattern += 1) {
        let digits = pattern
        const pins = guests.flatMap((g) => {
          const destination = digits % 3; digits = Math.floor(digits / 3)
          return destination ? [{ guestId: g.id, tableId: `round-${destination}` }] : []
        })
        if (!feasible(room, guests, pins)) continue
        const plan = solve(room, guests, pins)
        const context = JSON.stringify({ order: guests.map((g) => g.id), pins, seatsEach })
        expect(plan.unseated, context).toEqual([])
        expect(pairsAdjacent(plan, guests), context).toBe(true)
        expectConserved(plan, guests, pins)
      }
    }
  })
})


describe('TT-45: shortage feasibility over fully occupied partial plans', () => {
  it('preserves all feasible pins while filling four seats from five guests', () => {
    const room = { roundTables: 2, seatsEach: 2, topTableSeats: 0 }
    const guests = [guest('a', 'b'), guest('c', 'd'), guest('b', 'a'), guest('d', 'c'), guest('solo')]
    for (let pattern = 0; pattern < 81; pattern += 1) {
      let digits = pattern
      const pins = guests.slice(0, 4).flatMap((g) => {
        const destination = digits % 3; digits = Math.floor(digits / 3)
        return destination ? [{ guestId: g.id, tableId: `round-${destination}` }] : []
      })
      const subsets = guests.map((_, omitted) => guests.filter((_, index) => index !== omitted))
      const canFillCleanly = subsets.some((subset) => pins.every((pin) => subset.some((g) => g.id === pin.guestId)) && feasible(room, subset, pins))
      if (!canFillCleanly) continue
      const plan = solve(room, guests, pins)
      const context = JSON.stringify(pins)
      expect(plan.unseated, context).toHaveLength(1)
      expect(evaluateRegistered(plan).violations.filter((v) => v.severity === 'hard'), context).toEqual([])
      expectConserved(plan, guests, pins)
    }
  })

  it.each([{ roundTables: 2, seatsEach: 2 }, { roundTables: 1, seatsEach: 3 }, { roundTables: 2, seatsEach: 3 }])('finds a clean full-seat subset where the independent oracle proves one exists: %j', (config) => {
    const room = { ...config, topTableSeats: 0 }
    const capacity = room.roundTables * room.seatsEach
    const original = [guest('a', 'b'), guest('c', 'd'), guest('e', 'f'), guest('b', 'a'), guest('d', 'c'), guest('f', 'e'), guest('solo')]
    for (let offset = 0; offset < original.length; offset += 1) {
      const guests = [...original.slice(offset), ...original.slice(0, offset)]
      const subsets = Array.from({ length: 2 ** guests.length }, (_, mask) => guests.filter((_, index) => (mask & (1 << index)) !== 0))
      const canFillCleanly = subsets.some((subset) => subset.length === capacity && feasible(room, subset, []))
      expect(canFillCleanly).toBe(true)
      const plan = solve(room, guests)
      const context = JSON.stringify({ room, order: guests.map((g) => g.id) })
      expect(plan.unseated, context).toHaveLength(guests.length - capacity)
      expect(evaluateRegistered(plan).violations.filter((v) => v.severity === 'hard'), context).toEqual([])
      expectConserved(plan, guests, [])
    }
  })
})
