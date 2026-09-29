import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../../App'
import { useTopTableStore } from '../../store/store'
import type { Guest } from '../../domain/types'

function guest(id: string, name: string): Guest {
  return { id, name, side: 'bride', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable' }
}
function setupGuests() {
  useTopTableStore.getState().setRoom({ roundTables: 2, seatsEach: 2, topTableSeats: 2 })
  useTopTableStore.getState().setGuests([guest('a', 'Alpha'), guest('b', 'Bravo'), guest('c', 'Charlie'), guest('d', 'Delta')])
}
async function start() {
  const user = userEvent.setup(); render(<App />)
  await user.click(screen.getByRole('button', { name: 'Plan' }))
  await user.click(screen.getByRole('button', { name: 'Auto-allocate' }))
  return user
}
function chair(table: number, seat: number, name: string) {
  return within(screen.getByRole('group', { name: `Seats at Table ${table}` })).getByRole('img', { name: `Seat ${seat}, ${name}` })
}

beforeEach(() => { useTopTableStore.getState().reset(); localStorage.clear() })

describe('TT-23 keyboard acceptance', () => {
  it('Space and Enter pick up and drop a round-table guest, with a live status announcement', async () => {
    setupGuests(); const user = await start(); const from = chair(1, 1, 'Alpha'); const target = chair(2, 1, 'Charlie')
    from.focus(); await user.keyboard(' ')
    expect(from).toHaveAttribute('data-move', 'origin')
    expect(screen.getByRole('status')).toHaveTextContent(/moving alpha/i)
    target.focus(); await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Undo move' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/moved/i)
  })

  it('Escape cancels and restores focus to the origin without writing pins', async () => {
    setupGuests(); const user = await start(); const from = chair(1, 1, 'Alpha'); from.focus(); await user.keyboard('{Enter}')
    await user.keyboard('{Escape}')
    expect(document.activeElement).toBe(from)
    expect(screen.queryByRole('heading', { name: 'Moving Alpha' })).not.toBeInTheDocument()
    expect(useTopTableStore.getState().pins).toEqual([])
  })

  it('only occupied round chairs expose the move instruction; top and empty chairs do not', async () => {
    setupGuests(); await start()
    expect(chair(1, 1, 'Alpha')).toHaveAccessibleDescription('Press Space to move this guest.')
    expect(chair(1, 2, 'Bravo')).toHaveAccessibleDescription('Press Space to move this guest.')
    expect(within(screen.getByRole('group', { name: 'Seats at Top table' })).getByRole('img', { name: 'Seat 1, empty' })).not.toHaveAttribute('aria-describedby')
    const empty = within(screen.getByRole('group', { name: 'Seats at Top table' })).getAllByRole('img').find((node) => node.getAttribute('aria-label')?.includes('empty'))
    if (!empty) throw new Error('expected an empty chair')
    expect(empty).not.toHaveAttribute('aria-describedby')
  })
})
