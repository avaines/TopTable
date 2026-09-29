import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { useTopTableStore } from '../../store/store'
import type { Guest } from '../../domain/types'

function guest(id: string, name: string, overrides: Partial<Guest> = {}): Guest {
  return { id, name, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable', ...overrides }
}

function setRoom(...guests: Guest[]) {
  useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
  useTopTableStore.getState().setGuests(guests)
}

async function plan(user: ReturnType<typeof userEvent.setup>) {
  render(<App />)
  await user.click(screen.getByRole('button', { name: 'Plan' }))
  await user.click(screen.getByRole('button', { name: 'Auto-allocate' }))
}

function chair(table: number, seat: number, name: string) {
  return within(screen.getByRole('group', { name: `Seats at Table ${table}` })).getByRole('img', { name: `Seat ${seat}, ${name}` })
}

beforeEach(() => { useTopTableStore.getState().reset(); localStorage.clear() })

describe('TT-23 pointer acceptance', () => {
  it('keeps a plain click as table detail selection', async () => {
    const user = userEvent.setup(); setRoom(guest('a', 'Alpha'), guest('b', 'Bravo'))
    await plan(user)
    await user.click(chair(1, 1, 'Alpha'))
    expect(screen.getByRole('heading', { name: 'Table 1' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Moving Alpha' })).not.toBeInTheDocument()
  })

  it('previews and commits an occupied-seat swap, changing exactly two chair names and two pins', async () => {
    const user = userEvent.setup(); setRoom(guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie'), guest('d', 'Delta'))
    await plan(user)
    const from = chair(1, 1, 'Alpha'); const to = chair(2, 1, 'Charlie')
    const before = Array.from(document.querySelectorAll('[data-seat-index]')).map((node) => node.getAttribute('aria-label'))
    await user.pointer([{ keys: '[MouseLeft>]', target: from }, { target: to }])
    expect(screen.getByRole('heading', { name: 'Moving Alpha' })).toBeInTheDocument()
    expect(from).toHaveAttribute('data-move', 'origin')
    expect(to).toHaveAttribute('data-move', 'target')
    expect(document.body.textContent).toMatch(/To Table/)
    expect(screen.getByText(/After this move the plan can be published/)).toBeInTheDocument()
    await user.pointer({ keys: '[/MouseLeft]', target: to })
    const after = Array.from(document.querySelectorAll('[data-seat-index]')).map((node) => node.getAttribute('aria-label'))
    expect(after.filter((label, index) => label !== before[index])).toHaveLength(2)
    expect(useTopTableStore.getState().pins).toHaveLength(2)
  })

  it('moves only the guest into an empty seat and reports no unrelated reseats', async () => {
    const user = userEvent.setup(); setRoom(guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie'))
    await plan(user)
    const from = chair(1, 1, 'Alpha'); const to = within(screen.getByRole('group', { name: 'Seats at Table 2' })).getAllByRole('img').find((node) => node.getAttribute('aria-label')?.includes('empty'))
    if (!to) throw new Error('expected an empty chair in Table 2')
    await user.pointer([{ keys: '[MouseLeft>]', target: from }, { target: to }])
    expect(screen.queryAllByText(/other guest[s]? change seat too/).length).toBeGreaterThan(0)
    await user.pointer({ keys: '[/MouseLeft]', target: to })
    expect(within(screen.getByRole('group', { name: 'Seats at Table 2' })).getByRole('img', { name: 'Seat 2, Alpha' })).toBeInTheDocument()
  })

  it('cancels when released outside a chair or via pointer cancel, preserving the plan', async () => {
    const user = userEvent.setup(); setRoom(guest('a', 'Alpha'), guest('b', 'Bravo'))
    await plan(user)
    const from = chair(1, 1, 'Alpha'); const before = from.getAttribute('aria-label')
    await user.pointer([{ keys: '[MouseLeft>]', target: from }, { target: screen.getByRole('heading', { name: 'Unseated' }) }])
    await user.pointer({ keys: '[/MouseLeft]', target: screen.getByRole('heading', { name: 'Unseated' }) })
    expect(screen.queryByRole('heading', { name: 'Moving Alpha' })).not.toBeInTheDocument()
    expect(chair(1, 1, 'Alpha')).toHaveAttribute('aria-label', before)
  })

  it('suppresses hover summaries while held and refuses top-table targets', async () => {
    const user = userEvent.setup();
    useTopTableStore.getState().setRoom({ roundTables: 1, seatsEach: 2, topTableSeats: 2 })
    useTopTableStore.getState().setGuests([guest('a', 'Alpha'), guest('b', 'Bravo')])
    await plan(user)
    const from = chair(1, 1, 'Alpha')
    const top = within(screen.getByRole('group', { name: 'Seats at Top table' })).getByRole('img', { name: 'Seat 1, empty' })
    await user.pointer([{ keys: '[MouseLeft>]', target: from }, { target: top }])
    expect(top).toHaveAttribute('data-move', 'refused')
    expect(screen.getByText(/top table keeps the protocol order/i)).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /Summary for/ })).not.toBeInTheDocument()
    await user.pointer({ keys: '[/MouseLeft]', target: top })
    expect(screen.queryByRole('heading', { name: 'Moving Alpha' })).not.toBeInTheDocument()
  })
})
