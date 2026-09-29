import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PlanScreen } from './PlanScreen'
import { STORAGE_KEY, useTopTableStore } from '../../store/store'
import type { Guest } from '../../domain/types'
import { NavigationContext } from '../../shell/navigation'

function guest(id: string, partnerOf: string): Guest {
  return { id, name: `Partner ${id.toUpperCase()}`, partnerOf, role: 'guest', side: 'both', age: 'adult', household: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable' }
}

function Harness() {
  const [allocated, setAllocated] = useState(false)
  return <PlanScreen allocated={allocated} setAllocated={setAllocated} />
}

beforeEach(() => {
  useTopTableStore.getState().reset()
  localStorage.clear()
})

describe('TT-45: an existing saved split couple is immediately hard', () => {
  it('rehydrates the previous data format intact, marks both tables and blocks publication before allocation', async () => {
    const data = { event: { name: 'Saved wedding' }, room: { roundTables: 2, seatsEach: 4, topTableSeats: 2 },
      guests: [guest('a', 'b'), guest('b', 'a')], scenario: null,
      pins: [{ guestId: 'a', tableId: 'round-1' }, { guestId: 'b', tableId: 'round-2' }] }
    // Version 4 is the already-shipped format: the severity change must not discard saved pins.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: data, version: 4 }))
    await useTopTableStore.persist.rehydrate()
    expect(useTopTableStore.getState()).toMatchObject(data)
    const user = userEvent.setup()
    const { container } = render(<NavigationContext.Provider value={{ tab: 'plan', goTo: () => {} }}><Harness /></NavigationContext.Provider>)
    expect(screen.getByText('Cannot be published')).toBeInTheDocument()
    expect(screen.queryByText('Can be published')).not.toBeInTheDocument()
    const entries = Array.from(container.querySelectorAll('[data-severity="hard"]'))
    const pair = entries.find((el) => el.textContent?.includes('Partner A') && el.textContent.includes('Partner B'))
    expect(pair).toBeDefined()
    expect(container.querySelectorAll('[data-occupancy][data-violation="true"]')).toHaveLength(2)
    expect(pair?.textContent).toContain('Hard')
    expect(container.querySelector('[data-severity="soft"]')).toBeNull()
    expect(within(screen.getByRole('list', { name: 'Hard' })).getByText(/Partners must sit next to each other/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Fit/i }))
    expect(screen.getByRole('heading', { name: 'Score breakdown' })).toBeInTheDocument()
    expect(screen.getAllByText('Cannot be published')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: /Fit/i }))
    await user.click(screen.getByRole('button', { name: 'Auto-allocate' }))
    expect(screen.getByText('Cannot be published')).toBeInTheDocument()
    expect(useTopTableStore.getState().pins).toEqual(data.pins)
    const secondTable = Array.from(container.querySelectorAll('[data-occupancy]')).find((el) => el.querySelector('p')?.textContent?.startsWith('Table 2'))
    const select = secondTable?.querySelector('button')
    expect(select).toBeDefined()
    if (!select) throw new Error('Table 2 has no select control')
    await user.click(select)
    await user.click(screen.getByRole('button', { name: /^Release Partner B from Table 2/ }))
    expect(screen.getByText('Can be published')).toBeInTheDocument()
    expect(screen.queryByText('Cannot be published')).not.toBeInTheDocument()
  })
})
