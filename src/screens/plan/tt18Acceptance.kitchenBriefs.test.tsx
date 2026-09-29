import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen, within } from '@testing-library/react'
import { PlanScreen } from './PlanScreen'
import { NavigationContext } from '../../shell/navigation'
import { useTopTableStore } from '../../store/store'
import type { Guest } from '../../domain/types'

function guest(id: string, overrides: Partial<Guest> = {}): Guest {
  return { id, name: `Guest ${id}`, side: 'both', role: 'guest', age: 'adult', household: null, partnerOf: null,
    conflictsWith: [], tags: [], allergies: [], dietaryPreferences: [], accessibility: [], socialType: 'sociable', ...overrides }
}
function Harness() {
  const [allocated, setAllocated] = useState(false)
  return <PlanScreen allocated={allocated} setAllocated={setAllocated} />
}
function briefs(): HTMLElement {
  const heading = screen.getByRole('heading', { name: /Kitchen briefs/i })
  const container = heading.parentElement
  if (!container) throw new Error('Kitchen briefs has no containing element')
  return container
}
function mount() {
  return render(<NavigationContext.Provider value={{ tab: 'plan', goTo: () => {} }}><Harness /></NavigationContext.Provider>)
}
beforeEach(() => {
  useTopTableStore.getState().reset()
  localStorage.clear()
})

describe('TT-18: named current kitchen briefs on the real Plan screen', () => {
  it('shows table, guest and actual allergens, refreshes on edits and moves, and removes cleared allergies', () => {
    const person = guest('a', { name: 'Asha Rao', allergies: ['nuts', 'sesame'], dietaryPreferences: ['vegan'] })
    const dietary = guest('d', { name: 'Dietary Guest', dietaryPreferences: ['gluten free'] })
    const state = useTopTableStore.getState()
    state.setRoom({ roundTables: 2, seatsEach: 4, topTableSeats: 2 })
    state.setGuests([person, dietary])
    state.pinGuest('a', 'round-1')
    state.pinGuest('d', 'round-1')
    const { container } = mount()
    expect(briefs()).toHaveTextContent('Table 1')
    expect(briefs()).toHaveTextContent('Asha Rao')
    expect(briefs()).toHaveTextContent('nuts')
    expect(briefs()).toHaveTextContent('sesame')
    expect(briefs()).not.toHaveTextContent('vegan')
    expect(briefs()).not.toHaveTextContent('Dietary Guest')
    expect(briefs()).not.toHaveTextContent('gluten free')
    expect(screen.getByText('Can be published')).toBeInTheDocument()
    expect(container.querySelector('[data-severity="hard"]')).toBeNull()
    expect(within(briefs()).queryByRole('checkbox')).not.toBeInTheDocument()

    act(() => useTopTableStore.getState().updateGuest({ ...person, name: 'Asha Patel', allergies: ['dairy'] }))
    expect(briefs()).toHaveTextContent('Asha Patel')
    expect(briefs()).toHaveTextContent('dairy')
    expect(briefs()).not.toHaveTextContent('Asha Rao')
    expect(briefs()).not.toHaveTextContent('nuts')
    expect(briefs()).not.toHaveTextContent('sesame')
    act(() => useTopTableStore.getState().pinGuest('a', 'round-2'))
    expect(briefs()).toHaveTextContent('Table 2')
    expect(briefs()).not.toHaveTextContent('Table 1')
    expect(screen.getByText('Can be published')).toBeInTheDocument()

    act(() => useTopTableStore.getState().updateGuest({ ...person, name: 'Asha Patel', allergies: [] }))
    expect(screen.queryByRole('heading', { name: /Kitchen briefs/i })).not.toBeInTheDocument()
    expect(screen.getByText('Can be published')).toBeInTheDocument()
  })
})
