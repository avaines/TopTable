import type { RuleReport } from '../../domain/rules/engine'
import { isPublishable } from '../../domain/rules/engine'
import type { SeatingPlan } from '../../domain/seating'
import type { Violation } from '../../domain/rules/contract'

export type ViolationChanges = { breaks: readonly Violation[]; clears: readonly Violation[] }

function identity(v: Violation): string {
  const guests = [...v.guestIds].sort().join(',')
  return `${v.ruleId}|${guests}|${v.guestIds.length ? '' : v.message}`
}

export function violationChanges(before: RuleReport, after: RuleReport): ViolationChanges {
  const old = new Set(before.violations.map(identity))
  const next = new Set(after.violations.map(identity))
  const order = (a: Violation, b: Violation) => (a.severity === b.severity ? 0 : a.severity === 'hard' ? -1 : 1)
  return {
    breaks: after.violations.filter((v) => !old.has(identity(v))).sort(order),
    clears: before.violations.filter((v) => !next.has(identity(v))).sort(order),
  }
}

export function reseatedGuestIds(before: SeatingPlan, after: SeatingPlan, excluded: readonly string[] = []): string[] {
  const skip = new Set(excluded)
  const location = (plan: SeatingPlan, id: string) => {
    for (const table of plan.tables) {
      const index = table.seats.findIndex((seat) => seat?.guest.id === id)
      if (index >= 0) return `${table.id}:${index}`
      if (table.overflow.some((seat) => seat.guest.id === id)) return `${table.id}:overflow`
    }
    return 'unseated'
  }
  const ids = new Set([...before.unseated.map((g) => g.id), ...after.unseated.map((g) => g.id)])
  for (const table of [...before.tables, ...after.tables]) for (const seat of [...table.seats, ...table.overflow]) if (seat) ids.add(seat.guest.id)
  return [...ids].filter((id) => !skip.has(id) && location(before, id) !== location(after, id))
}

export function isMovePublishable(report: RuleReport): boolean { return isPublishable(report) }
