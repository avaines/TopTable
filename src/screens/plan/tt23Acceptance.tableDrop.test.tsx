import { beforeEach, describe, expect, it } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { useTopTableStore } from '../../store/store'
import type { Guest } from '../../domain/types'

function guest(id: string, name: string): Guest {
  return {
    id,
    name,
    side: 'bride',
    role: 'guest',
    age: 'adult',
    household: null,
    partnerOf: null,
    conflictsWith: [],
    tags: [],
    allergies: [],
    dietaryPreferences: [],
    accessibility: [],
    socialType: 'sociable',
  }
}

function chair(table: number, seat: number, name: string): HTMLElement {
  return within(screen.getByRole('group', { name: `Seats at Table ${table}` }))
    .getByRole('img', { name: `Seat ${seat}, ${name}` })
}

function tableFace(table: number): HTMLElement {
  const button = document.querySelector(`[data-drop-table-id="round-${table}"]`)
  if (!(button instanceof HTMLElement)) throw new Error('expected a table face button')
  return button
}

function guestLocations(): Map<string, string> {
  const locations = new Map(useTopTableStore.getState().guests.map((person) => [person.id, 'unseated']))
  for (const chairNode of document.querySelectorAll<HTMLElement>('[data-guest-id][data-seat-index]')) {
    const guestId = chairNode.getAttribute('data-guest-id')
    const tableId = chairNode.getAttribute('data-table-id')
    const seatIndex = chairNode.getAttribute('data-seat-index')
    if (guestId && tableId && seatIndex) locations.set(guestId, `${tableId}:${seatIndex}`)
  }
  return locations
}

async function ready(user: ReturnType<typeof userEvent.setup>, guests: Guest[], pins: string[] = []) {
  useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
  useTopTableStore.getState().setGuests(guests)
  for (const [index, guestId] of pins.entries()) {
    useTopTableStore.getState().pinGuest(guestId, `round-${index + 1}`)
  }
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Plan' }))
  await user.click(screen.getByRole('button', { name: 'Auto-allocate' }))
}

beforeEach(() => {
  useTopTableStore.getState().reset()
  localStorage.clear()
})

describe('TT-23 table-body drops', () => {
  it('reallocates an unpinned full target, reports the actual collateral count, and commits the preview candidate', async () => {
    const user = userEvent.setup()
    await ready(user, [guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie'), guest('d', 'Delta')], ['a'])

    const from = chair(1, 1, 'Alpha')
    const target = tableFace(2)
    const before = guestLocations()

    await user.pointer([{ keys: '[MouseLeft>]' , target: from }, { target }])

    expect(screen.getByRole('heading', { name: 'Moving Alpha' })).toBeInTheDocument()
    expect(target).toHaveAttribute('data-move', 'target')
    expect(screen.getByText(/To Table 2.*automatic allocation/i)).toBeInTheDocument()
    const previewText = screen.getByRole('heading', { name: 'Moving Alpha' }).parentElement?.parentElement?.textContent ?? ''
    const collateral = previewText.match(/(\d+)\s+other\s+guests?\s+change(?:s)?\s+(?:seats?|places?)/i)
    if (!collateral) throw new Error(`expected a numeric collateral count in preview: ${previewText}`)
    const predictedSeat = previewText.match(/They take seat\s+(\d+)/i)
    if (!predictedSeat) throw new Error(`expected predicted target seat in preview: ${previewText}`)
    expect(screen.getByText(/After this move the plan can be published|After this move the plan cannot be published/)).toBeInTheDocument()

    await user.pointer({ keys: '[/MouseLeft]', target })
    expect(useTopTableStore.getState().pins).toContainEqual({ guestId: 'a', tableId: 'round-2' })
    const after = guestLocations()
    const changedCollateral = [...before.keys()].filter((guestId) => guestId !== 'a' && before.get(guestId) !== after.get(guestId))
    expect(changedCollateral).toHaveLength(Number(collateral[1]))
    expect(after.get('a')).toBe(`round-2:${Number(predictedSeat[1]) - 1}`)
  })

  it('preserves exact and table pins, and tells the truth when every target seat is pinned', async () => {
    const user = userEvent.setup()
    const guests = [guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie'), guest('d', 'Delta')]
    useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
    useTopTableStore.getState().setGuests(guests)
    useTopTableStore.getState().pinGuest('a', 'round-1')
    useTopTableStore.getState().pinGuest('b', 'round-2')
    useTopTableStore.getState().pinGuest('c', 'round-2')
    useTopTableStore.getState().restorePins([
      { guestId: 'a', tableId: 'round-1' },
      { guestId: 'b', tableId: 'round-2' },
      { guestId: 'c', tableId: 'round-2', seatIndex: 1 },
    ])
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    await user.click(screen.getByRole('button', { name: 'Auto-allocate' }))

    const from = chair(1, 1, 'Alpha')
    const target = tableFace(2)
    await user.pointer([{ keys: '[MouseLeft>]' , target: from }, { target }])
    expect(screen.getByText(/no available seat|no free seat|no seat/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot be published/i)).toBeInTheDocument()
    await user.pointer({ keys: '[/MouseLeft]', target })

    expect(useTopTableStore.getState().pins).toEqual(expect.arrayContaining([
      { guestId: 'b', tableId: 'round-2' },
      { guestId: 'c', tableId: 'round-2', seatIndex: 1 },
      { guestId: 'a', tableId: 'round-2' },
    ]))
  })

  it.each(['same-table', 'top-table', 'outside'])('treats a %s body release as a safe no-op', async (kind) => {
    const user = userEvent.setup()
    await ready(user, [guest('a', 'Alpha'), guest('b', 'Bravo')], ['a'])
    const from = chair(1, 1, 'Alpha')
    const target = kind === 'same-table' ? tableFace(1) : kind === 'top-table'
      ? screen.getByRole('button', { name: /Top table.*seats/i })
      : screen.getByRole('heading', { name: 'Unseated' })
    const pinsBefore = useTopTableStore.getState().pins
    await user.pointer([{ keys: '[MouseLeft>]' , target: from }, { target }])
    await user.pointer({ keys: '[/MouseLeft]', target })
    expect(useTopTableStore.getState().pins).toEqual(pinsBefore)
    expect(screen.queryByRole('button', { name: 'Undo move' })).not.toBeInTheDocument()
  })

  it('supports keyboard table-face drops and coarse press/release without an intermediate move event', async () => {
    const user = userEvent.setup()
    await ready(user, [guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie')], ['a'])
    const from = chair(1, 1, 'Alpha')
    const target = tableFace(2)
    act(() => from.focus())
    await user.keyboard(' ')
    act(() => target.focus())
    expect(screen.getByRole('heading', { name: 'Moving Alpha' })).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(useTopTableStore.getState().pins).toContainEqual({ guestId: 'a', tableId: 'round-2' })

    const next = chair(2, 1, 'Alpha')
    const other = chair(1, 1, 'Bravo')
    fireEvent.pointerDown(next, { button: 0, buttons: 1, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(other, { button: 0, buttons: 0, pointerId: 1, pointerType: 'mouse' })
    expect(useTopTableStore.getState().pins).toEqual(expect.arrayContaining([
      { guestId: 'a', tableId: 'round-1', seatIndex: 0 },
      { guestId: 'b', tableId: 'round-2', seatIndex: 0 },
    ]))
  })

  it('shows the top-table body refusal on keyboard focus and cancels on Enter without changing pins', async () => {
    const user = userEvent.setup()
    await ready(user, [guest('a', 'Alpha'), guest('b', 'Bravo')], ['a'])
    const from = chair(1, 1, 'Alpha')
    const top = screen.getByRole('button', { name: /Top table.*seats/i })
    const pinsBefore = useTopTableStore.getState().pins
    act(() => from.focus())
    await user.keyboard(' ')
    act(() => top.focus())
    expect(screen.getByRole('heading', { name: 'Moving Alpha' })).toBeInTheDocument()
    expect(screen.getByText(/top table keeps the protocol order/i)).toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(useTopTableStore.getState().pins).toEqual(pinsBefore)
    expect(screen.queryByRole('heading', { name: 'Moving Alpha' })).not.toBeInTheDocument()
  })

  it('undoes an unallocated table drop after a cancelled pickup, invalidates on edit, and persists a later chair drop across tab navigation', async () => {
    const user = userEvent.setup()
    useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
    useTopTableStore.getState().setGuests([guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie')])
    useTopTableStore.getState().pinGuest('a', 'round-1')
    render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    const beforePins = useTopTableStore.getState().pins
    const from = chair(1, 1, 'Alpha')
    const target = tableFace(2)
    await user.pointer([{ keys: '[MouseLeft>]' , target: from }, { target }, { keys: '[/MouseLeft]' , target }])
    expect(screen.getByRole('button', { name: 'Undo move' })).toBeInTheDocument()
    const held = screen.getByRole('img', { name: /Seat \d+, Alpha/ })
    act(() => held.focus())
    await user.keyboard(' ')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Undo move' }))
    expect(useTopTableStore.getState().pins).toEqual(beforePins)
    expect(screen.getByRole('button', { name: 'Auto-allocate' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Seat \d+, Alpha/ })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Bravo|Charlie/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bravo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Charlie' })).toBeInTheDocument()

    useTopTableStore.getState().updateGuest({ ...guest('b', 'Bravo'), name: 'Bravo edited' })
    expect(screen.queryByRole('img', { name: /Bravo edited|Charlie/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Auto-allocate' }))
    const preciseFrom = chair(1, 1, 'Alpha')
    const preciseTo = Array.from(within(screen.getByRole('group', { name: 'Seats at Table 2' })).getAllByRole('img'))
      .find((node) => !node.getAttribute('aria-label')?.includes('empty'))
    if (!preciseTo) throw new Error('expected an occupied target chair')
    const displacedGuestId = preciseTo.getAttribute('data-guest-id')
    if (!displacedGuestId) throw new Error('expected target guest id')
    await user.pointer([{ keys: '[MouseLeft>]' , target: preciseFrom }, { target: preciseTo }, { keys: '[/MouseLeft]' , target: preciseTo }])
    expect(useTopTableStore.getState().pins).toEqual(expect.arrayContaining([
      { guestId: 'a', tableId: 'round-2', seatIndex: 0 },
      { guestId: displacedGuestId, tableId: 'round-1', seatIndex: 0 },
    ]))
    const saved = localStorage.getItem('top-table')
    expect(saved).toContain('seatIndex')
    const persisted = JSON.parse(saved ?? '{}') as { state?: { pins?: unknown } }
    expect(persisted.state?.pins).toEqual(expect.arrayContaining([
      { guestId: 'a', tableId: 'round-2', seatIndex: 0 },
    ]))
    await user.click(screen.getByRole('button', { name: 'Guests' }))
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    expect(screen.getByRole('img', { name: 'Seat 1, Alpha' })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: /Seat 1, (Bravo|Charlie)/ })).toHaveLength(1)
  })
})
