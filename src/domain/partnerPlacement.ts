import type { SeatGuard } from './allocate'
import type { Guest, ProtocolRole } from './types'
import type { Seat, SeatedTable, SeatingPlan } from './seating'
import { TOP_TABLE_ID } from './seating'

type Unit = { segments: Guest[][]; tableId?: string }
type MutableTable = Omit<SeatedTable, 'seats'> & { seats: (Seat | null)[] }

function members(unit: Unit): Guest[] {
  return unit.segments.flat()
}

/**
 * Couples are contiguous two-seat segments; omitted protocol roles share a table, not a chair
 * order. Searching those units avoids permutations of equivalent chairs and unrelated singles.
 * null means no maximally seated arrangement satisfies the hard placement constraints. Singleton
 * units are intentional: the same constrained search also keeps independent guests out of
 * conflict tables instead of committing them in guest-list order.
 */
export function seatPartners(
  initial: readonly SeatedTable[],
  guests: readonly Guest[],
  honoured: ReadonlyMap<string, string>,
  omittedRoles: readonly ProtocolRole[],
  allowSeat: SeatGuard,
): SeatingPlan | null {
  const alreadySeated = new Set(initial.flatMap((table) =>
    [...table.seats, ...table.overflow].flatMap((seat) => seat ? [seat.guest.id] : []),
  ))
  const remaining = guests.filter((guest) => !alreadySeated.has(guest.id))
  const byId = new Map(remaining.map((guest) => [guest.id, guest]))
  const partners = new Map<string, string>()
  for (const guest of remaining) {
    if (!guest.partnerOf || guest.partnerOf === guest.id || !byId.has(guest.partnerOf)) continue
    if ((partners.has(guest.id) && partners.get(guest.id) !== guest.partnerOf) ||
        (partners.has(guest.partnerOf) && partners.get(guest.partnerOf) !== guest.id)) return null
    partners.set(guest.id, guest.partnerOf)
    partners.set(guest.partnerOf, guest.id)
  }
  const roundTables = initial.filter((table) => table.kind === 'round')
  const target = Math.min(remaining.length, roundTables.reduce((sum, table) => sum + table.capacity, 0))
  const short = target < remaining.length

  const used = new Set<string>()
  let units: Unit[] = []
  for (const guest of remaining) {
    if (used.has(guest.id)) continue
    const partnerId = partners.get(guest.id)
    const partner = partnerId ? byId.get(partnerId) : undefined
    const segment = partner ? [guest, partner] : [guest]
    segment.forEach((member) => used.add(member.id))
    units.push({ segments: [segment] })
  }

  // Pinned role holders have already chosen their destination; KB-4's overflow block contains
  // only the remaining holders, matching the ordinary allocation path.
  const overflowIds = new Set(omittedRoles.flatMap((role) => {
    const holder = remaining.find((guest) => guest.role === role &&
      (!honoured.has(guest.id) || honoured.get(guest.id) === TOP_TABLE_ID))
    return holder ? [holder.id] : []
  }))
  const blockUnits = units.filter((unit) => members(unit).some((guest) => overflowIds.has(guest.id)))
  if (blockUnits.length > 1) {
    units = units.filter((unit) => !blockUnits.includes(unit))
    units.unshift({ segments: blockUnits.flatMap((unit) => unit.segments) })
  }
  for (const unit of units) {
    const restrictions = new Set(members(unit).flatMap((guest) => {
      const tableId = honoured.get(guest.id)
      return tableId && tableId !== TOP_TABLE_ID ? [tableId] : []
    }))
    if (restrictions.size > 1) return null
    unit.tableId = restrictions.values().next().value
  }
  const forcedCounts = new Map<string, number>()
  for (const unit of units) {
    if (!unit.tableId) continue
    const required = short ? members(unit).filter((guest) => honoured.get(guest.id) === unit.tableId).length : members(unit).length
    forcedCounts.set(unit.tableId, (forcedCounts.get(unit.tableId) ?? 0) + required)
  }
  if (roundTables.some((table) => (forcedCounts.get(table.id) ?? 0) > table.capacity)) return null

  units.sort((a, b) => Number(Boolean(b.tableId)) - Number(Boolean(a.tableId)) || members(b).length - members(a).length)

  const tables: MutableTable[] = initial.map((table) => ({ ...table, seats: [...table.seats] }))
  const rounds = tables.filter((table) => table.kind === 'round')
  const fills = rounds.map(() => 0)
  const suffixGuests = new Array<number>(units.length + 1).fill(0)
  const suffixPairs = new Array<number>(units.length + 1).fill(0)
  for (let i = units.length - 1; i >= 0; i--) {
    const unit = units[i]!
    suffixGuests[i] = suffixGuests[i + 1]! + members(unit).length
    suffixPairs[i] = suffixPairs[i + 1]! + unit.segments.filter((segment) => segment.length === 2).length
  }

  const variants = units.map((unit) => {
    if (!short) return [members(unit)]
    const pinned = (guest: Guest) => honoured.has(guest.id) && honoured.get(guest.id) !== TOP_TABLE_ID
    const required = (guest: Guest) => pinned(guest) || overflowIds.has(guest.id)
    let choices: Guest[][] = [[]]
    for (const segment of unit.segments) {
      const options = [segment]
      if (segment.length === 2) {
        for (const guest of segment) {
          if (segment.every((other) => other === guest || !required(other))) options.push([guest])
        }
      }
      if (segment.every((guest) => !required(guest))) options.push([])
      choices = choices.flatMap((prefix) => options.map((option) => [...prefix, ...option]))
    }
    if (members(unit).every((guest) => !pinned(guest)) && !choices.some((choice) => choice.length === 0)) choices.push([])
    return choices.sort((a, b) => b.length - a.length)
  })

  const suffixRequired = Array.from({ length: units.length + 1 }, () => rounds.map(() => 0))
  for (let index = units.length - 1; index >= 0; index--) {
    const required = [...suffixRequired[index + 1]!]
    const tableIndex = rounds.findIndex((table) => table.id === units[index]!.tableId)
    if (tableIndex >= 0) {
      required[tableIndex] = required[tableIndex]! + Math.min(...variants[index]!.map((choice) => choice.length))
    }
    suffixRequired[index] = required
  }

  function search(index: number, seated: number): boolean {
    if (index === units.length) return seated === target
    const free = rounds.map((table, i) => table.capacity - fills[i]!)
    if (free.some((count, tableIndex) => count < suffixRequired[index]![tableIndex]!)) return false
    const pairSlots = free.reduce((sum, count) => sum + Math.floor(count / 2), 0)
    const pairs = suffixPairs[index]!
    // A couple beyond the remaining adjacent slots can contribute at most one seated partner.
    const possibleGuests = suffixGuests[index]! - pairs + Math.min(pairs, pairSlots)
    if (seated + possibleGuests < target) return false
    if (!short && suffixGuests[index]! > free.reduce((sum, count) => sum + count, 0)) return false
    const unit = units[index]!
    for (const occupants of variants[index]!) {
      if (seated + occupants.length > target) continue
      if (occupants.length === 0) {
        if (search(index + 1, seated)) return true
        continue
      }
      for (let tableIndex = 0; tableIndex < rounds.length; tableIndex++) {
        const table = rounds[tableIndex]!
        if (unit.tableId && unit.tableId !== table.id) continue
        const start = fills[tableIndex]!
        // Reserve later mandatory pins before trying an optional partner at this table.
        if (occupants.length + suffixRequired[index + 1]![tableIndex]! > free[tableIndex]!) continue
        let accepted = true
        for (let offset = 0; offset < occupants.length; offset++) {
          const guest = occupants[offset]!
          const pinned = honoured.get(guest.id) === table.id
          if (!pinned && !allowSeat({ plan: { tables }, tableId: table.id, seatIndex: start + offset, guest })) {
            accepted = false
            break
          }
          table.seats[start + offset] = { guest, pinned }
        }
        if (accepted) {
          fills[tableIndex] = start + occupants.length
          if (search(index + 1, seated + occupants.length)) return true
          fills[tableIndex] = start
        }
        for (let offset = 0; offset < occupants.length; offset++) table.seats[start + offset] = null
      }
    }
    return false
  }

  if (!search(0, 0)) return null
  const placed = new Set(tables.flatMap((table) => table.seats.flatMap((seat) => seat ? [seat.guest.id] : [])))
  return { tables, unseated: remaining.filter((guest) => !placed.has(guest.id)) }
}
