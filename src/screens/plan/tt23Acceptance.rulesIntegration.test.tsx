import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { useTopTableStore } from '../../store/store'
import type { Guest } from '../../domain/types'

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return { id, name: `Guest ${id}`, side: 'both', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable', ...overrides }
}
function briefs(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /Kitchen briefs/i })
  if (!heading.parentElement) throw new Error('Kitchen briefs container missing')
  return heading.parentElement
}
function chair(table: number, seat: number, name: string) {
  return within(screen.getByRole('group', { name: `Seats at Table ${table}` })).getByRole('img', { name: `Seat ${seat}, ${name}` })
}
beforeEach(() => { useTopTableStore.getState().reset(); localStorage.clear() })

describe('TT-23 integration with registered conflict and kitchen-brief rules', () => {
  it('updates a named kitchen brief after an allergic guest swap and restores it on undo', async () => {
    const allergic = guest('a', { name: 'Asha Rao', allergies: ['nuts', 'sesame'] })
    const other = guest('b', { name: 'Ben Cole' })
    useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
    useTopTableStore.getState().setGuests([allergic, other])
    useTopTableStore.getState().pinGuest('a', 'round-1')
    useTopTableStore.getState().pinGuest('b', 'round-2')
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    expect(briefs()).toHaveTextContent('Asha Rao')
    expect(briefs()).toHaveTextContent('nuts')
    expect(briefs()).toHaveTextContent('sesame')
    expect(briefs()).toHaveTextContent('Table 1')
    const from = chair(1, 1, 'Asha Rao'); const to = chair(2, 1, 'Ben Cole')
    await user.pointer([{ keys: '[MouseLeft>]', target: from }, { target: to }])
    const moving = screen.getByRole('heading', { name: 'Moving Asha Rao' }).parentElement?.parentElement
    expect(moving).toBeTruthy()
    expect(moving).not.toHaveTextContent(/Would break/i)
    expect(moving).not.toHaveTextContent(/needs a kitchen brief/i)
    await user.pointer({ keys: '[/MouseLeft]', target: to })
    expect(briefs()).toHaveTextContent('Asha Rao')
    expect(briefs()).toHaveTextContent('nuts')
    expect(briefs()).toHaveTextContent('sesame')
    expect(briefs()).toHaveTextContent('Table 2')
    await user.click(screen.getByRole('button', { name: 'Undo move' }))
    expect(briefs()).toHaveTextContent('Table 1')
    expect(briefs()).not.toHaveTextContent('Table 2')
  })

  it('previews a newly broken conflict and matches the post-drop report', async () => {
    const alice = guest('a', { name: 'Alice Stone', conflictsWith: ['c'] })
    const bob = guest('b', { name: 'Bob Stone' })
    const cara = guest('c', { name: 'Cara Wells', conflictsWith: ['a'] })
    useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
    useTopTableStore.getState().setGuests([alice, bob, cara])
    useTopTableStore.getState().pinGuest('a', 'round-1')
    useTopTableStore.getState().pinGuest('b', 'round-1')
    useTopTableStore.getState().pinGuest('c', 'round-2')
    const user = userEvent.setup(); render(<App />)
    await user.click(screen.getByRole('button', { name: 'Plan' }))
    const from = chair(1, 1, 'Alice Stone')
    const to = within(screen.getByRole('group', { name: 'Seats at Table 2' })).getByRole('img', { name: 'Seat 2, empty' })
    await user.pointer([{ keys: '[MouseLeft>]', target: from }, { target: to }])
    const moving = screen.getByRole('heading', { name: 'Moving Alice Stone' }).parentElement?.parentElement
    expect(moving).toHaveTextContent(/Would break/i)
    expect(moving).toHaveTextContent('Cara Wells and Alice Stone are in conflict')
    await user.pointer({ keys: '[/MouseLeft]', target: to })
    const violations = screen.getByRole('heading', { name: 'Violations' }).parentElement?.parentElement
    expect(violations).toHaveTextContent('Cara Wells and Alice Stone are in conflict')
  })
})
