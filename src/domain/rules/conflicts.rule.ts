import type { Guest } from '../types'
import type { Finding, GuardPlan, RulePlan, SeatingRule } from './contract'

type Location = { tableId: string; label: string } | undefined

function guestsInPlan(plan: GuardPlan): Map<string, Guest> {
  const guests = new Map<string, Guest>()
  for (const table of plan.tables) {
    for (const seat of [...table.seats, ...table.overflow]) {
      if (seat) guests.set(seat.guest.id, seat.guest)
    }
  }
  return guests
}

function locationsInPlan(plan: GuardPlan): Map<string, Location> {
  const locations = new Map<string, Location>()
  for (const table of plan.tables) {
    for (const seat of [...table.seats, ...table.overflow]) {
      if (seat) locations.set(seat.guest.id, { tableId: table.id, label: table.label })
    }
  }
  return locations
}

function assess(plan: GuardPlan, known: ReadonlyMap<string, Guest>) {
  const locations = locationsInPlan(plan)
  const findings: Finding[] = []
  const seen = new Set<string>()
  let opportunities = 0
  let missed = 0

  for (const guest of known.values()) {
    for (const conflictId of guest.conflictsWith) {
      const key = [guest.id, conflictId].sort().join('::')
      if (seen.has(key)) continue
      seen.add(key)
      const other = known.get(conflictId)
      if (!other) continue
      opportunities += 1
      const first = locations.get(guest.id)
      const second = locations.get(other.id)
      if (!first || !second) {
        missed += 1
        continue
      }
      if (first.tableId !== second.tableId) continue
      missed += 1
      findings.push({
        tableIds: [first.tableId],
        guestIds: [guest.id, other.id],
        message: `${guest.name} and ${other.name} are in conflict`,
        detail: first.label,
      })
    }
  }

  return { findings, opportunities, missed }
}

function knownGuests(plan: RulePlan): Map<string, Guest> {
  const guests = guestsInPlan(plan)
  for (const guest of plan.unseated) guests.set(guest.id, guest)
  return guests
}

export const rule = {
  id: 'conflicts',
  severity: 'hard',
  remedy: 'seating',
  relaxWhenInfeasible: true,
  description: 'Guests in conflict must not share a table',
  evaluate: (plan: RulePlan) => assess(plan, knownGuests(plan)),
  evaluatePlacement: (plan: GuardPlan) => assess(plan, guestsInPlan(plan)).findings,
} satisfies SeatingRule
