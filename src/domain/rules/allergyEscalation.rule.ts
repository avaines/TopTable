import type { Guest } from '../types'
import type { RulePlan, Finding, SeatingRule } from './contract'
import type { KitchenBrief } from '../seating'

function guestsInPlan(plan: RulePlan): Guest[] {
  return [...plan.tables.flatMap((table) => [...table.seats.flatMap((seat) => (seat ? [seat.guest] : [])), ...table.overflow.map((seat) => seat.guest)]), ...plan.unseated]
}

export const rule: SeatingRule = {
  id: 'allergy-escalation',
  description: 'Allergy guests have a current kitchen brief',
  severity: 'hard',
  remedy: 'flag',
  evaluate(plan: RulePlan) {
    const allGuests = guestsInPlan(plan)
    const opportunities = allGuests.filter((guest) => guest.allergies.length > 0).length
    const seated = new Map<string, { tableId: string; tableLabel: string }>()
    for (const table of plan.tables) {
      for (const seat of [...table.seats.flatMap((value) => (value ? [value] : [])), ...table.overflow]) {
        seated.set(seat.guest.id, { tableId: table.id, tableLabel: table.label })
      }
    }
    const briefs = new Map<string, KitchenBrief>((plan.kitchenBriefs ?? []).map((brief): [string, KitchenBrief] => [brief.tableId, brief]))
    const missedGuests = allGuests.filter((guest) => {
      if (guest.allergies.length === 0) return false
      const location = seated.get(guest.id)
      if (!location) return true
      const brief = briefs.get(location.tableId)
      const briefGuest = brief?.guests.find((entry) => entry.id === guest.id)
      if (!brief || brief.tableLabel !== location.tableLabel || !briefGuest || briefGuest.name !== guest.name) return true
      const actualAllergies = [...new Set(guest.allergies)].sort()
      const briefAllergies = [...new Set(briefGuest.allergies)].sort()
      return actualAllergies.length !== briefAllergies.length || actualAllergies.some((allergy, index) => allergy !== briefAllergies[index])
    })
    const byTable = new Map<string, { label: string; guests: Guest[] }>()
    for (const guest of missedGuests) {
      const location = seated.get(guest.id)
      if (!location) continue
      const entry = byTable.get(location.tableId) ?? { label: location.tableLabel, guests: [] }
      entry.guests.push(guest)
      byTable.set(location.tableId, entry)
    }
    const findings: Finding[] = [...byTable.entries()].map(([tableId, entry]) => ({
      tableIds: [tableId], guestIds: entry.guests.map((guest) => guest.id),
      message: `${entry.label} needs a kitchen brief for ${entry.guests.map((guest) => guest.name).join(', ')}`,
      detail: entry.guests.map((guest) => `${guest.name}: ${guest.allergies.join(', ')}`).join(' · '),
    }))
    return { findings, opportunities, missed: missedGuests.length }
  },
}
