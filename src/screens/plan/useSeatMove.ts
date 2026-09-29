import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import type { Guest, Pin, RoomConfig } from '../../domain/types'
import type { SeatingPlan } from '../../domain/seating'
import type { RuleReport } from '../../domain/rules/engine'
import type { SeatMove, SeatAddress } from '../../domain/pins'
import type { SeatGuard } from '../../domain/allocate'
import { seatOf } from '../../domain/seating'
import { movePlanSeat } from '../../domain/movePlanSeat'
import { useTopTableStore } from '../../store/store'
import type { PlanSnapshot } from '../../App'
import { buildMovePreview, buildTableMovePreview, type MovePreview } from './moveConsequences'
import type { ChairMoveProps } from './chairAddress'

type Options = {
  room: RoomConfig; guests: Guest[]; pins: Pin[]; allocated: boolean; plan: SeatingPlan; report: RuleReport
  seatGuard: SeatGuard; placing: boolean; announce: (text: string) => void
  onPickUp: () => void; focusFallback: () => void
  setPlanSnapshot?: (snapshot: PlanSnapshot | null) => void
  setAllocated: (allocated: boolean) => void
  priorAllocated?: boolean
}

type Holding = { move: SeatMove; pointerId?: number; targetTableId?: string; candidate?: ReturnType<typeof buildTableMovePreview> }

function addressFrom(target: EventTarget | null, point?: { clientX: number; clientY: number }): SeatAddress | null {
  if (point) {
    const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(point.clientX, point.clientY) : null
    if (hit) target = hit
  }
  const el = target instanceof Element ? target.closest<SVGElement>('[data-table-id][data-seat-index]') : null
  if (!el) return null
  const tableId = el.dataset.tableId
  const seatIndex = Number(el.dataset.seatIndex)
  return tableId && Number.isInteger(seatIndex) ? { tableId, seatIndex } : null
}

function chairElement(target: EventTarget | null, point?: { clientX: number; clientY: number }): Element | null {
  const hit = point && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(point.clientX, point.clientY) : null
  const candidate = hit ?? target
  return candidate instanceof Element ? candidate.closest('[data-table-id][data-seat-index]') : null
}

function tableElement(target: EventTarget | null, point?: { clientX: number; clientY: number }): Element | null {
  const direct = target instanceof Element ? target.closest('[data-drop-table-id]') : null
  if (direct) return direct
  const hit = point && typeof document.elementFromPoint === 'function' ? document.elementFromPoint(point.clientX, point.clientY) : null
  return hit instanceof Element ? hit.closest('[data-drop-table-id]') : null
}

export function useSeatMove(options: Options) {
  const { room, guests, pins, plan, report, allocated, placing, announce, onPickUp, focusFallback, setPlanSnapshot, setAllocated, priorAllocated = allocated } = options
  const moveGuest = useTopTableStore((s) => s.moveGuest)
  const pinGuest = useTopTableStore((s) => s.pinGuest)
  const restorePins = useTopTableStore((s) => s.restorePins)
  const [holding, setHolding] = useState<Holding | null>(null)
  const holdRef = useRef<Holding | null>(null)
  const [preview, setPreview] = useState<MovePreview | null>(null)
  const [lastMove, setLastMove] = useState<MovePreview | null>(null)
  const beforePins = useRef<Pin[]>([])
  const beforePlan = useRef<SeatingPlan | null>(null)
  const beforeAllocated = useRef(priorAllocated)
  const holdSource = useRef<{ room: RoomConfig; guests: Guest[]; pins: Pin[]; plan: SeatingPlan } | null>(null)
  const undoBeforeAllocated = useRef(priorAllocated)
  const undoBeforePins = useRef<Pin[]>([])
  const undoBeforePlan = useRef<SeatingPlan | null>(null)
  const committedSource = useRef<{ room: RoomConfig; guests: Guest[]; pins: Pin[] } | null>(null)
  const originElement = useRef<SVGCircleElement | null>(null)
  const movedRef = useRef(false)
  const suppressClickRef = useRef(false)
  const hintId = 'seat-move-hint'

  const tableCandidate = useCallback((guestId: string, tableId: string) => buildTableMovePreview(plan, guests, pins, guestId, tableId, report, room, options.seatGuard), [guests, options.seatGuard, pins, plan, report, room])

  const start = useCallback((event: PointerEvent) => {
    if (placing || event.pointerType === 'touch' || event.button !== 0) return
    const from = addressFrom(event.target)
    if (!from || from.tableId === 'top') return
    const location = seatOf(plan, (event.target as Element).getAttribute('data-guest-id') ?? '')
    const guestId = (event.target as Element).getAttribute('data-guest-id')
    if (!guestId || !location || location.seatIndex === null || location.table.kind !== 'round') return
    beforePins.current = pins
    beforePlan.current = plan
    beforeAllocated.current = priorAllocated
    holdSource.current = { room, guests, pins, plan }
    originElement.current = event.target as SVGCircleElement
    onPickUp()
    movedRef.current = false
    suppressClickRef.current = false
    holdRef.current = { move: { guestId, from, to: from }, pointerId: event.pointerId }
  }, [guests, onPickUp, pins, placing, plan, priorAllocated, room])

  const update = useCallback((event: PointerEvent) => {
    const stored = holdRef.current
    if (!stored) return
    onPickUp()
    const to = addressFrom(event.target, event)
    const body = tableElement(event.target, event)
    const bodyTableId = body?.getAttribute('data-drop-table-id') ?? undefined
    if (!to && bodyTableId) {
      movedRef.current = true
      if (bodyTableId === 'top') {
        stored.targetTableId = bodyTableId; stored.candidate = undefined
        setHolding({ ...stored })
        setPreview({ ...buildMovePreview(plan, guests, stored.move, report, room), to: null, status: 'refused' })
      } else if (bodyTableId === stored.move.from.tableId) {
        setHolding({ ...stored, targetTableId: bodyTableId, candidate: undefined })
        setPreview({ ...buildMovePreview(plan, guests, stored.move, report, room), to: null, status: 'home', targetTableId: bodyTableId })
      } else {
        const candidate = stored.targetTableId === bodyTableId && stored.candidate ? stored.candidate : tableCandidate(stored.move.guestId, bodyTableId)
        stored.targetTableId = bodyTableId
        stored.candidate = candidate
        setHolding({ ...stored })
        setPreview(candidate.preview)
      }
      return
    }
    if (!to) {
      movedRef.current = true
      stored.targetTableId = undefined
      stored.candidate = undefined
      setHolding({ ...stored })
      setPreview({ ...buildMovePreview(plan, guests, stored.move, report, room), to: null, status: 'nowhere' }); return
    }
    const targetEl = chairElement(event.target, event) ?? event.target as Element
    const targetGuest = targetEl.getAttribute('data-guest-id')
    const move: SeatMove = { ...stored.move, to, displacedGuestId: targetGuest ?? undefined }
    stored.targetTableId = undefined
    stored.candidate = undefined
    if (to.tableId === stored.move.from.tableId && to.seatIndex === stored.move.from.seatIndex) {
      if (!movedRef.current) { setPreview(null); return }
      setHolding({ ...stored }); setPreview({ ...buildMovePreview(plan, guests, stored.move, report, room), to, status: 'home' }); return
    }
    if (to.tableId === 'top') { movedRef.current = true; stored.move = move; setHolding({ ...stored }); setPreview({ ...buildMovePreview(plan, guests, move, report, room), status: 'refused' }); return }
    movedRef.current = true
    stored.move = move
    setHolding({ ...stored })
    setPreview(buildMovePreview(plan, guests, move, report, room))
  }, [guests, onPickUp, plan, report, room, tableCandidate])

  const finish = useCallback((event: PointerEvent) => {
    const stored = holdRef.current
    holdRef.current = null
    if (!stored) return
    const to = addressFrom(event.target, event)
    const bodyTableId = tableElement(event.target, event)?.getAttribute('data-drop-table-id') ?? undefined
    const move = stored.move
    if (!to && bodyTableId && bodyTableId !== move.from.tableId && bodyTableId !== 'top') {
      const candidate = stored.targetTableId === bodyTableId && stored.candidate ? stored.candidate : tableCandidate(move.guestId, bodyTableId)
      undoBeforePins.current = beforePins.current
      undoBeforePlan.current = beforePlan.current ?? plan
      undoBeforeAllocated.current = beforeAllocated.current
      pinGuest(move.guestId, bodyTableId)
      const committed = useTopTableStore.getState()
      committedSource.current = { room, guests, pins: committed.pins }
      setPlanSnapshot?.({ plan: candidate.plan, source: { room, guests, pins: committed.pins }, beforePins: beforePins.current, beforePlan: beforePlan.current ?? plan })
      setAllocated(true)
      setLastMove(candidate.preview); setHolding(null); setPreview(null); announce(`Moved ${candidate.preview.guest.name}.`); suppressClickRef.current = true
      return
    }
    if (!to || to.tableId === 'top' || (to.tableId === move.from.tableId && to.seatIndex === move.from.seatIndex)) {
      const wasActive = movedRef.current
      setHolding(null); setPreview(null); originElement.current?.focus(); if (wasActive) { suppressClickRef.current = true; announce('Move put back.') } return
    }
    move.to = to
    const targetGuest = (chairElement(event.target, event) ?? event.target as Element).getAttribute('data-guest-id')
    move.displacedGuestId = targetGuest ?? undefined
    const view = buildMovePreview(plan, guests, move, report, room)
    undoBeforePins.current = beforePins.current
    undoBeforePlan.current = beforePlan.current ?? plan
    undoBeforeAllocated.current = beforeAllocated.current
    moveGuest(move)
    const state = useTopTableStore.getState()
    committedSource.current = { room, guests, pins: state.pins }
    setPlanSnapshot?.({ plan: movePlanSeat(plan, move), source: { room, guests, pins: state.pins }, beforePins: beforePins.current, beforePlan: beforePlan.current ?? plan })
    setLastMove(view); setHolding(null); setPreview(null); announce(`Moved ${view.guest.name}.`)
    suppressClickRef.current = true
  }, [announce, guests, moveGuest, pinGuest, plan, report, room, setAllocated, setPlanSnapshot, tableCandidate])

  const keyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== ' ' && event.key !== 'Enter') return
    const address = addressFrom(event.target)
    const bodyTableId = tableElement(event.target)?.getAttribute('data-drop-table-id') ?? undefined
    const guestId = event.target instanceof Element ? event.target.getAttribute('data-guest-id') : null
    if (!address && !bodyTableId) return
    event.preventDefault()
    if (holdRef.current) {
      if (!address && bodyTableId) {
        if (bodyTableId === 'top' || bodyTableId === holdRef.current.move.from.tableId) {
          holdRef.current = null; setHolding(null); setPreview(null); originElement.current?.focus(); return
        }
        const candidate = tableCandidate(holdRef.current.move.guestId, bodyTableId)
        undoBeforePins.current = beforePins.current
        undoBeforePlan.current = beforePlan.current ?? plan
        undoBeforeAllocated.current = beforeAllocated.current
        pinGuest(holdRef.current.move.guestId, bodyTableId)
        const state = useTopTableStore.getState()
        committedSource.current = { room, guests, pins: state.pins }
        setPlanSnapshot?.({ plan: candidate.plan, source: { room, guests, pins: state.pins }, beforePins: beforePins.current, beforePlan: beforePlan.current ?? plan })
        setAllocated(true)
        setLastMove(candidate.preview); setHolding(null); setPreview(null); holdRef.current = null; announce(`Moved ${candidate.preview.guest.name}.`); return
      }
      if (!address) return
      if (address.tableId === 'top') { holdRef.current = null; setHolding(null); setPreview(null); originElement.current?.focus(); return }
      const move: SeatMove = { ...holdRef.current.move, to: address, displacedGuestId: guestId === holdRef.current.move.guestId ? undefined : guestId ?? undefined }
      if (move.from.tableId === move.to.tableId && move.from.seatIndex === move.to.seatIndex) { holdRef.current = null; setHolding(null); setPreview(null); originElement.current?.focus(); return }
      const view = buildMovePreview(plan, guests, move, report, room)
      undoBeforePins.current = beforePins.current
      undoBeforePlan.current = beforePlan.current ?? plan
      undoBeforeAllocated.current = beforeAllocated.current
      moveGuest(move)
      const state = useTopTableStore.getState()
      committedSource.current = { room, guests, pins: state.pins }
      setPlanSnapshot?.({ plan: movePlanSeat(plan, move), source: { room, guests, pins: state.pins }, beforePins: beforePins.current, beforePlan: beforePlan.current ?? plan })
      setLastMove(view); setHolding(null); setPreview(null); holdRef.current = null; announce(`Moved ${view.guest.name}.`); return
    }
    if (!address || address.tableId === 'top' || !guestId) return
    if (!holdRef.current) {
      const location = seatOf(plan, guestId)
      if (!location || location.seatIndex === null || location.table.kind !== 'round') return
      beforePins.current = pins; beforePlan.current = plan; originElement.current = event.target as SVGCircleElement
      beforeAllocated.current = priorAllocated
      holdSource.current = { room, guests, pins, plan }
      onPickUp()
      holdRef.current = { move: { guestId, from: address, to: address } }
      setHolding({ ...holdRef.current })
      setPreview({ ...buildMovePreview(plan, guests, holdRef.current.move, report, room), status: 'home' })
      announce(`Moving ${guests.find((guest) => guest.id === guestId)?.name ?? 'guest'}.`)
      return
    }
    const heldMove = (holdRef.current as Holding).move
    const move: SeatMove = { ...heldMove, to: address, displacedGuestId: guestId === heldMove.guestId ? undefined : guestId }
    if (move.from.tableId === move.to.tableId && move.from.seatIndex === move.to.seatIndex) { holdRef.current = null; setHolding(null); setPreview(null); originElement.current?.focus(); return }
    const view = buildMovePreview(plan, guests, move, report, room)
    undoBeforePins.current = beforePins.current
    undoBeforePlan.current = beforePlan.current ?? plan
    moveGuest(move)
    const state = useTopTableStore.getState()
    committedSource.current = { room, guests, pins: state.pins }
    setPlanSnapshot?.({ plan: movePlanSeat(plan, move), source: { room, guests, pins: state.pins }, beforePins: beforePins.current, beforePlan: beforePlan.current ?? plan })
    setLastMove(view); setHolding(null); setPreview(null); holdRef.current = null; announce(`Moved ${view.guest.name}.`)
  }, [announce, guests, moveGuest, onPickUp, pinGuest, pins, plan, priorAllocated, report, room, setAllocated, setPlanSnapshot, tableCandidate])

  const focus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    if (!holdRef.current) return
    const bodyTableId = (event.target instanceof Element ? event.target.closest('[data-drop-table-id]')?.getAttribute('data-drop-table-id') : null) ?? tableElement(event.target)?.getAttribute('data-drop-table-id')
    if (bodyTableId) {
      if (bodyTableId === 'top' || bodyTableId === holdRef.current.move.from.tableId) {
        holdRef.current.targetTableId = bodyTableId
        holdRef.current.candidate = undefined
        setHolding({ ...holdRef.current })
        setPreview({ ...buildMovePreview(plan, guests, holdRef.current.move, report, room), to: null, status: bodyTableId === 'top' ? 'refused' : 'home' })
      } else {
        const candidate = holdRef.current.targetTableId === bodyTableId && holdRef.current.candidate ? holdRef.current.candidate : tableCandidate(holdRef.current.move.guestId, bodyTableId)
        holdRef.current.targetTableId = bodyTableId
        holdRef.current.candidate = candidate
        setHolding({ ...holdRef.current }); setPreview(candidate.preview)
      }
      return
    }
    const address = addressFrom(event.target)
    if (!address || address.tableId === 'top') return
    holdRef.current.targetTableId = undefined
    holdRef.current.candidate = undefined
    const guestId = event.target instanceof Element ? event.target.getAttribute('data-guest-id') : null
    const move = { ...holdRef.current.move, to: address, displacedGuestId: guestId ?? undefined }
    holdRef.current.move = move
    setHolding({ ...holdRef.current })
    setPreview(buildMovePreview(plan, guests, move, report, room))
  }, [guests, plan, report, room, tableCandidate])

  const cancel = useCallback(() => {
    const stored = holdRef.current
    if (!stored) return false
    holdRef.current = null
    holdSource.current = null
    setHolding(null); setPreview(null); originElement.current?.focus(); announce('Move put back.'); return true
  }, [announce])

  useEffect(() => {
    const source = holdSource.current
    if (source && (source.room !== room || source.guests !== guests || source.pins !== pins || source.plan !== plan)) cancel()
  }, [cancel, guests, pins, plan, room])

  const click = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }, [])

  useEffect(() => {
    const unsubscribe = useTopTableStore.subscribe((state) => {
      const source = committedSource.current
      if (!lastMove || !source) return
      if (source.room !== state.room || source.guests !== state.guests || source.pins !== state.pins) {
        flushSync(() => {
          setLastMove(null)
          setPlanSnapshot?.(null)
        })
        committedSource.current = null
      }
    })
    return unsubscribe
  }, [lastMove, setPlanSnapshot])

  useEffect(() => {
    const up = (event: PointerEvent) => {
      if (holdRef.current) finish(event)
    }
    const cancelPointer = () => { if (holdRef.current) cancel() }
    window.addEventListener('pointerup', up as unknown as EventListener)
    window.addEventListener('pointercancel', cancelPointer)
    return () => { window.removeEventListener('pointerup', up as unknown as EventListener); window.removeEventListener('pointercancel', cancelPointer) }
  }, [cancel, finish])

  useEffect(() => {
    const blur = () => cancel()
    window.addEventListener('blur', blur)
    return () => window.removeEventListener('blur', blur)
  }, [cancel])

  const undoLastMove = useCallback(() => {
    if (!undoBeforePlan.current) return
    restorePins(undoBeforePins.current)
    setAllocated(undoBeforeAllocated.current)
    setPlanSnapshot?.({ plan: undoBeforePlan.current, source: { room, guests, pins: undoBeforePins.current }, beforePins: undoBeforePins.current, beforePlan: undoBeforePlan.current })
    setLastMove(null); announce('Move undone.'); focusFallback()
  }, [announce, focusFallback, guests, restorePins, room, setAllocated, setPlanSnapshot])

  const chairMoveFor = useCallback((tableId: string): ChairMoveProps | undefined => {
    if (placing) return undefined
    if (!holding) {
      return { marks: Array.from({ length: room.seatsEach }, () => undefined), hintId }
    }
    const marks = Array.from({ length: room.seatsEach }, () => undefined as 'origin' | 'target' | 'refused' | undefined)
    if (holding.move.from.tableId === tableId) marks[holding.move.from.seatIndex] = 'origin'
    if (preview?.to?.tableId === tableId && !(holding.move.from.tableId === tableId && holding.move.from.seatIndex === preview.to.seatIndex)) marks[preview.to.seatIndex] = preview.status === 'refused' ? 'refused' : 'target'
    return { marks, hintId }
  }, [holding, placing, preview, room.seatsEach])

  const tableMoveFor = useCallback((tableId: string): 'target' | 'refused' | undefined => {
    if (!holding || holding.targetTableId !== tableId) return undefined
    return preview?.status === 'refused' ? 'refused' : preview?.status === 'table' ? 'target' : undefined
  }, [holding, preview])

  const areaHandlers = useMemo(() => ({ onPointerDown: start, onPointerMove: update, onPointerUp: finish, onPointerCancel: cancel, onKeyDown: keyDown, onClickCapture: click, onFocusCapture: focus }), [cancel, click, finish, focus, keyDown, start, update])
  const invalidate = useCallback(() => { holdRef.current = null; holdSource.current = null; setHolding(null); setPreview(null); setLastMove(null); setPlanSnapshot?.(null) }, [setPlanSnapshot])
  return { holding: holding !== null, preview, lastMove, undoLastMove, chairMoveFor, tableMoveFor, areaHandlers, hintId, cancelHold: cancel, invalidate }
}
