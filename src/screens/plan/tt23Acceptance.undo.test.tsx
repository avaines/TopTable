import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { useTopTableStore } from '../../store/store'
import type { Guest } from '../../domain/types'

function guest(id: string, name: string): Guest { return { id, name, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null, conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable' } }
function chair(table: number, seat: number, name: string) { return within(screen.getByRole('group', { name: `Seats at Table ${table}` })).getByRole('img', { name: `Seat ${seat}, ${name}` }) }
async function ready() {
  useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
  useTopTableStore.getState().setGuests([guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie'), guest('d', 'Delta')])
  const user = userEvent.setup(); render(<App />); await user.click(screen.getByRole('button', { name: 'Plan' })); await user.click(screen.getByRole('button', { name: 'Auto-allocate' })); return user
}
async function swap(user: ReturnType<typeof userEvent.setup>, fromName: string, toName: string) {
  const from = chair(1, 1, fromName); const to = chair(2, 1, toName)
  await user.pointer([{ keys: '[MouseLeft>]', target: from }, { target: to }, { keys: '[/MouseLeft]', target: to }])
}
beforeEach(() => { useTopTableStore.getState().reset(); localStorage.clear() })

describe('TT-23 undo acceptance', () => {
  it('undo restores both occupants, pins, and removes the notice', async () => {
    const user = await ready(); await swap(user, 'Alpha', 'Charlie')
    expect(screen.getByRole('button', { name: 'Undo move' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo move' }))
    expect(chair(1, 1, 'Alpha')).toBeInTheDocument(); expect(chair(2, 1, 'Charlie')).toBeInTheDocument()
    expect(useTopTableStore.getState().pins).toEqual([])
    expect(screen.queryByRole('button', { name: 'Undo move' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/move undone/i)
  })

  it('after two moves one undo restores only the second move, and a cancelled pickup does not replace that undo', async () => {
    const user = await ready(); await swap(user, 'Alpha', 'Charlie')
    const secondFrom = Array.from(within(screen.getByRole('group', { name: 'Seats at Table 1' })).getAllByRole('img')).find((node) => !node.getAttribute('aria-label')?.includes('empty'))
    const secondTo = Array.from(within(screen.getByRole('group', { name: 'Seats at Table 2' })).getAllByRole('img')).find((node) => !node.getAttribute('aria-label')?.includes('empty'))
    if (!secondFrom || !secondTo) throw new Error('expected occupied chairs for second move')
    await user.pointer([{ keys: '[MouseLeft>]', target: secondFrom }, { target: secondTo }, { keys: '[/MouseLeft]', target: secondTo }])
    const origin = secondFrom; origin.focus(); await user.keyboard(' '); await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Undo move' }))
    expect(screen.queryByRole('button', { name: 'Undo move' })).not.toBeInTheDocument()
    expect(useTopTableStore.getState().pins).toHaveLength(2)
  })

  it.each(['Guests', 'Auto-allocate'])('invalidates the undo notice after %s', async (action) => {
    const user = await ready(); await swap(user, 'Alpha', 'Charlie')
    if (action === 'Guests') {
      await user.click(screen.getByRole('button', { name: 'Guests' }))
      await user.click(screen.getByRole('button', { name: 'Plan' }))
      expect(screen.getByRole('img', { name: 'Seat 1, Charlie' })).toBeInTheDocument()
    }
    else await user.click(screen.getByRole('button', { name: 'Auto-allocate' }))
    expect(screen.queryByRole('button', { name: 'Undo move' })).not.toBeInTheDocument()
  })

  it.each(['guest edit', 'room edit', 'pin clear'])('invalidates undo after a source change: %s', async (change) => {
    const user = await ready(); await swap(user, 'Alpha', 'Charlie')
    if (change === 'guest edit') useTopTableStore.getState().setGuests([guest('a', 'Alpha renamed'), guest('b', 'Bravo'), guest('c', 'Charlie'), guest('d', 'Delta')])
    if (change === 'room edit') useTopTableStore.getState().setRoom({ seatsEach: 3 })
    if (change === 'pin clear') useTopTableStore.getState().clearPins()
    expect(screen.queryByRole('button', { name: 'Undo move' })).not.toBeInTheDocument()
  })
})
