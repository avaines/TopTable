import type { SeatGuard } from './allocate'
import type { Guest, ProtocolRole } from './types'
import type { Seat, SeatedTable, SeatingPlan } from './seating'
import { TOP_TABLE_ID } from './seating'

type Unit = { segments: Guest[][]; tableId?: string; adjacentTo?: number }
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
  const initialTableByGuest = new Map(initial.flatMap((table) =>
    [...table.seats, ...table.overflow].flatMap((seat) => seat ? [[seat.guest.id, table.id] as const] : []),
  ))
  const initialSeatByGuest = new Map(initial.flatMap((table) => table.seats.flatMap((seat, index) =>
    seat ? [[seat.guest.id, { tableId: table.id, seatIndex: index, kind: table.kind }] as const] : [],
  )))
  const guardAllows = (candidate: Parameters<SeatGuard>[0]): boolean => {
    const { tableId, seatIndex, guest } = candidate
    const fixed = guest.partnerOf ? initialSeatByGuest.get(guest.partnerOf) : undefined
    if (fixed?.kind === 'round') {
      const fixedTable = initial.find((table) => table.id === fixed.tableId)
      const capacity = fixedTable?.capacity ?? 0
      const adjacent = tableId === fixed.tableId && capacity > 1 &&
        (seatIndex === (fixed.seatIndex + 1) % capacity || seatIndex === (fixed.seatIndex + capacity - 1) % capacity)
      if (!adjacent) return false
    }
    return allowSeat(candidate)
  }
  const partners = new Map<string, string>()
  for (const guest of remaining) {
    if (!guest.partnerOf || guest.partnerOf === guest.id || !byId.has(guest.partnerOf)) continue
    if ((partners.has(guest.id) && partners.get(guest.id) !== guest.partnerOf) ||
        (partners.has(guest.partnerOf) && partners.get(guest.partnerOf) !== guest.id)) return null
    partners.set(guest.id, guest.partnerOf)
    partners.set(guest.partnerOf, guest.id)
  }
  const roundTables = initial.filter((table) => table.kind === 'round')
  const freeCapacity = roundTables.reduce((sum, table) => sum + table.capacity - table.seats.filter((seat) => seat !== null).length, 0)
  const target = Math.min(remaining.length, freeCapacity)
  const short = target < remaining.length

  const used = new Set<string>()
  let units: Unit[] = []
  for (const guest of remaining) {
    if (used.has(guest.id)) continue
    const partnerId = partners.get(guest.id)
    const partner = partnerId ? byId.get(partnerId) : undefined
    const segment = partner ? [guest, partner] : [guest]
    segment.forEach((member) => used.add(member.id))
    const fixedPartnerId = guest.partnerOf
    const fixedPartnerTableId = fixedPartnerId ? initialTableByGuest.get(fixedPartnerId) : undefined
    const fixedPartnerTable = fixedPartnerTableId && initial.find((table) => table.id === fixedPartnerTableId)?.kind === 'round'
      ? fixedPartnerTableId
      : undefined
    const fixedPartnerSeat = fixedPartnerId ? initialSeatByGuest.get(fixedPartnerId) : undefined
    units.push({ segments: [segment], tableId: fixedPartnerTable, adjacentTo: fixedPartnerSeat?.kind === 'round' ? fixedPartnerSeat.seatIndex : undefined })
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
    if (restrictions.size > 0) unit.tableId = restrictions.values().next().value
  }
  const forcedCounts = new Map<string, number>()
  for (const unit of units) {
    if (!unit.tableId) continue
    const required = short ? members(unit).filter((guest) => honoured.get(guest.id) === unit.tableId).length : members(unit).length
    forcedCounts.set(unit.tableId, (forcedCounts.get(unit.tableId) ?? 0) + required)
  }
  if (roundTables.some((table) => (forcedCounts.get(table.id) ?? 0) > table.capacity)) return null

  // Place the most constrained pinned units first. A pinned guest may not be moved to make
  // room for an optional partner, and placing pinned-only units before coupled units lets the
  // guard see those fixed occupants before it considers the partner. This keeps a later pinned
  // conflict from being hidden by an earlier optional partner.
  const pinnedCount = (unit: Unit) => members(unit).filter((guest) => honoured.has(guest.id)).length
  units.sort((a, b) =>
    Number(Boolean(b.tableId)) - Number(Boolean(a.tableId)) ||
    (a.tableId && b.tableId
      ? pinnedCount(b) - pinnedCount(a) ||
        (members(a).length - pinnedCount(a)) - (members(b).length - pinnedCount(b)) ||
        members(a).length - members(b).length
      : members(b).length - members(a).length),
  )

  const tables: MutableTable[] = initial.map((table) => ({ ...table, seats: [...table.seats] }))
  const rounds = tables.filter((table) => table.kind === 'round')
  const fills = rounds.map((table) => table.seats.filter((seat) => seat !== null).length)

  function positionsFor(table: MutableTable, start: number, length: number): number[] {
    if (length === 2 && start === table.capacity - 1) return [start, 0]
    return Array.from({ length }, (_, offset) => start + offset)
  }

  function startsFor(table: MutableTable, length: number, adjacentTo?: number, exhaustive = false): number[] {
    const starts: number[] = []
    if (!exhaustive) {
      const prefix = table.seats.findIndex((seat) => seat === null)
      if (prefix >= 0 && table.seats.slice(prefix + 1).every((seat) => seat === null)) {
        const positions = positionsFor(table, prefix, length)
        const adjacent = adjacentTo === undefined || positions.some((position) => position === (adjacentTo + 1) % table.capacity || position === (adjacentTo + table.capacity - 1) % table.capacity)
        if (positions.length === length && positions.every((position) => table.seats[position] === null) && adjacent && (length <= 2 || prefix + length <= table.capacity)) return [prefix]
      }
    }
    for (let start = 0; start < table.capacity; start++) {
      const positions = positionsFor(table, start, length)
      if (new Set(positions).size !== positions.length || positions.some((position) => table.seats[position] !== null)) continue
      if (length > 2 && start + length > table.capacity) continue
      if (adjacentTo !== undefined && !positions.some((position) => position === (adjacentTo + 1) % table.capacity || position === (adjacentTo + table.capacity - 1) % table.capacity)) continue
      starts.push(start)
    }
    return starts
  }

  type SegmentAssignment = { guest: Guest; position: number; pinned: boolean }
  function visitSegmentAssignments(
    unit: Unit,
    table: MutableTable,
    exhaustive: boolean,
    visit: (assignments: readonly SegmentAssignment[]) => boolean,
  ): boolean {
    const trialTables = tables.map((candidate) => ({ ...candidate, seats: [...candidate.seats] }))
    const trialTable = trialTables.find((candidate) => candidate.id === table.id)
    if (!trialTable) return false
    const assignments: SegmentAssignment[] = []
    const place = (segmentIndex: number): boolean => {
      if (segmentIndex === unit.segments.length) return visit(assignments)
      const segment = unit.segments[segmentIndex]!
      for (const start of startsFor(trialTable, segment.length, undefined, exhaustive)) {
        const positions = positionsFor(trialTable, start, segment.length)
        const beforeSegment = assignments.length
        let accepted = true
        for (let offset = 0; offset < segment.length; offset++) {
          const guest = segment[offset]!
          const position = positions[offset]!
          const pinned = honoured.get(guest.id) === table.id
          if (!pinned && !guardAllows({ plan: { tables: trialTables }, tableId: table.id, seatIndex: position, guest })) {
            accepted = false
            break
          }
          trialTable.seats[position] = { guest, pinned }
          assignments.push({ guest, position, pinned })
        }
        if (accepted && place(segmentIndex + 1)) return true
        for (const assignment of assignments.splice(beforeSegment)) {
          trialTable.seats[assignment.position] = null
        }
      }
      return false
    }
    return place(0)
  }

  function findSegmentAssignment(unit: Unit, table: MutableTable, exhaustive = false): SegmentAssignment[] | null {
    let found: SegmentAssignment[] | null = null
    visitSegmentAssignments(unit, table, exhaustive, (assignments) => {
      found = [...assignments]
      return true
    })
    return found
  }
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
  let alternatePlacementAvailable = false

  function hasCandidatePlacement(index: number): boolean {
    const unit = units[index]!
    if (unit.segments.length > 1) {
      return rounds.some((table) => (!unit.tableId || unit.tableId === table.id) && findSegmentAssignment(unit, table, true) !== null)
    }
    for (const occupants of variants[index]!) {
      if (occupants.length === 0) return true
      for (let tableIndex = 0; tableIndex < rounds.length; tableIndex++) {
        const table = rounds[tableIndex]!
        if (unit.tableId && unit.tableId !== table.id) continue
        for (const start of startsFor(table, occupants.length, unit.adjacentTo, true)) {
          const positions = positionsFor(table, start, occupants.length)
          // A singleton guard sees the current plan before the candidate is placed, so it
          // needs no scratch clone. Couples are checked together and need one shared trial.
          const trialTables = occupants.length === 1
            ? tables
            : tables.map((candidate) => ({ ...candidate, seats: [...candidate.seats] }))
          const trialTable = trialTables.find((candidate) => candidate.id === table.id)
          if (!trialTable) continue
          let accepted = true
          for (let offset = 0; offset < occupants.length; offset++) {
            const guest = occupants[offset]!
            const pinned = honoured.get(guest.id) === table.id
            if (!pinned && !guardAllows({
              plan: { tables: trialTables }, tableId: table.id, seatIndex: positions[offset]!, guest,
            })) {
              accepted = false
              break
            }
            if (occupants.length > 1) trialTable.seats[positions[offset]!] = { guest, pinned }
          }
          if (accepted) return true
        }
      }
    }
    return false
  }

  function search(index: number, seated: number, exhaustivePlacement = false): boolean {
    if (index === units.length) {
      if (seated !== target) return false
      // Guards see a partial plan while the search is running. Recheck each unpinned occupant
      // against the completed candidate so a later pinned unit cannot invalidate an earlier
      // optional placement. Removing the occupant before asking mirrors a fresh placement.
      for (const table of tables) {
        if (table.kind !== 'round') continue
        for (let seatIndex = 0; seatIndex < table.seats.length; seatIndex++) {
          const seat = table.seats[seatIndex]
          if (!seat || seat.pinned) continue
          const seats = [...table.seats]
          seats[seatIndex] = null
          const candidateTables = tables.map((other) => other.id === table.id ? { ...other, seats } : other)
          if (!guardAllows({
            plan: { tables: candidateTables },
            tableId: table.id,
            seatIndex,
            guest: seat.guest,
          })) return false
        }
      }
      return true
    }
    for (let future = index; future < units.length; future++) {
      if (!hasCandidatePlacement(future)) return false
    }
    const free = rounds.map((table, i) => table.capacity - fills[i]!)
    if (free.some((count, tableIndex) => count < suffixRequired[index]![tableIndex]!)) return false
    // A merged protocol block needs all of its segments on one table. Reserve every
    // still-required table-bound unit before exploring that block; otherwise an impossible
    // overflow pair can permute pinned fillers exponentially before falling back to ordinary fill.
    for (let future = index; future < units.length; future++) {
      const candidate = units[future]!
      if (candidate.segments.length <= 1) continue
      const candidateSize = members(candidate).length
      const fitsSomeTable = rounds.some((table, tableIndex) => {
        if (candidate.tableId && candidate.tableId !== table.id) return false
        const ownRequired = candidate.tableId === table.id ? Math.min(...variants[future]!.map((choice) => choice.length)) : 0
        return free[tableIndex]! - (suffixRequired[index]![tableIndex]! - ownRequired) >= candidateSize
      })
      if (!fitsSomeTable) return false
    }
    const pairSlots = free.reduce((sum, count) => sum + Math.floor(count / 2), 0)
    const pairs = suffixPairs[index]!
    // A couple beyond the remaining adjacent slots can contribute at most one seated partner.
    const possibleGuests = suffixGuests[index]! - pairs + Math.min(pairs, pairSlots)
    if (seated + possibleGuests < target) return false
    if (!short && suffixGuests[index]! > free.reduce((sum, count) => sum + count, 0)) return false
    const unit = units[index]!
    if (unit.segments.length > 1) {
      for (let tableIndex = 0; tableIndex < rounds.length; tableIndex++) {
        const table = rounds[tableIndex]!
        if (unit.tableId && unit.tableId !== table.id) continue
        let continued = false
        visitSegmentAssignments(unit, table, exhaustivePlacement, (assignments) => {
          for (const assignment of assignments) table.seats[assignment.position] = { guest: assignment.guest, pinned: assignment.pinned }
          fills[tableIndex] = fills[tableIndex]! + assignments.length
          continued = search(index + 1, seated + assignments.length, exhaustivePlacement)
          if (!continued) {
            fills[tableIndex] = fills[tableIndex]! - assignments.length
            for (const assignment of assignments) table.seats[assignment.position] = null
            if (!exhaustivePlacement) alternatePlacementAvailable = true
          }
          return continued
        })
        if (continued) return true
        if (!exhaustivePlacement && findSegmentAssignment(unit, table, true)) alternatePlacementAvailable = true
      }
      return false
    }
    for (const occupants of variants[index]!) {
      if (seated + occupants.length > target) continue
      if (occupants.length === 0) {
        if (search(index + 1, seated, exhaustivePlacement)) return true
        continue
      }
      for (let tableIndex = 0; tableIndex < rounds.length; tableIndex++) {
        const table = rounds[tableIndex]!
        if (unit.tableId && unit.tableId !== table.id) continue
        // Reserve later mandatory pins before trying an optional partner at this table.
        if (occupants.length + suffixRequired[index + 1]![tableIndex]! > free[tableIndex]!) continue
        const starts = startsFor(table, occupants.length, unit.adjacentTo, exhaustivePlacement)
        const alternateStarts = exhaustivePlacement ? starts : startsFor(table, occupants.length, unit.adjacentTo, true)
        for (const start of starts) {
          const positions = positionsFor(table, start, occupants.length)
          let accepted = true
          for (let offset = 0; offset < occupants.length; offset++) {
            const guest = occupants[offset]!
            const pinned = honoured.get(guest.id) === table.id
            if (!pinned && !guardAllows({ plan: { tables }, tableId: table.id, seatIndex: positions[offset]!, guest })) {
              accepted = false
              break
            }
            table.seats[positions[offset]!] = { guest, pinned }
          }
          if (accepted) {
            fills[tableIndex] = fills[tableIndex]! + occupants.length
            if (search(index + 1, seated + occupants.length, exhaustivePlacement)) return true
            fills[tableIndex] = fills[tableIndex]! - occupants.length
            if (!exhaustivePlacement && alternateStarts.length > starts.length) alternatePlacementAvailable = true
          } else if (!exhaustivePlacement && alternateStarts.length > starts.length) {
            for (const position of positions) table.seats[position] = null
            for (const alternateStart of alternateStarts.slice(starts.length)) {
              const alternatePositions = positionsFor(table, alternateStart, occupants.length)
              const alternateTables = occupants.length === 1
                ? tables
                : tables.map((candidate) => ({ ...candidate, seats: [...candidate.seats] }))
              const alternateTable = alternateTables.find((candidate) => candidate.id === table.id)
              if (!alternateTable) continue
              let alternateAccepted = true
              for (let offset = 0; offset < occupants.length; offset++) {
                const guest = occupants[offset]!
                const pinned = honoured.get(guest.id) === table.id
                if (!pinned && !guardAllows({
                  plan: { tables: alternateTables }, tableId: table.id,
                  seatIndex: alternatePositions[offset]!, guest,
                })) {
                  alternateAccepted = false
                  break
                }
                if (occupants.length > 1) alternateTable.seats[alternatePositions[offset]!] = { guest, pinned }
              }
              if (alternateAccepted) {
                alternatePlacementAvailable = true
                break
              }
            }
          }
          for (const position of positions) table.seats[position] = null
        }
      }
    }
    return false
  }

  if (!search(0, 0) && (!alternatePlacementAvailable || !search(0, 0, true))) return null
  const placed = new Set(tables.flatMap((table) => table.seats.flatMap((seat) => seat ? [seat.guest.id] : [])))
  return { tables, unseated: remaining.filter((guest) => !placed.has(guest.id)) }
}
