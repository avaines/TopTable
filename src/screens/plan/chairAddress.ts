import type { SeatAddress } from '../../domain/pins'

export function chairAddress(element: Element): SeatAddress | null {
  const tableId = element.getAttribute('data-table-id')
  const raw = element.getAttribute('data-seat-index')
  if (!tableId || raw === null || !/^\d+$/.test(raw)) return null
  const seatIndex = Number(raw)
  return Number.isSafeInteger(seatIndex) ? { tableId, seatIndex } : null
}

export type MoveMark = 'origin' | 'target' | 'refused'
export type ChairMoveProps = { marks: readonly (MoveMark | undefined)[]; hintId?: string }
