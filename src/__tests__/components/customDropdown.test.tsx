// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CustomDropdown } from '../../components/common/CustomDropdown'

beforeAll(() => {
  if (!window.PointerEvent) window.PointerEvent = MouseEvent as typeof PointerEvent
  HTMLElement.prototype.hasPointerCapture = () => false
  HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.releasePointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})
afterEach(cleanup)
const options = [{ value: 'a', label: 'Alfa' }, { value: 'b', label: 'Beta' }, { value: 'g', label: 'Gama' }]
describe('accessible dropdown integration', () => {
  it('selects with the mouse and returns focus to the trigger', async () => {
    const user = userEvent.setup(), change = vi.fn()
    render(<CustomDropdown value="a" options={options} onChange={change} labelPrefix="Motor" />)
    const trigger = screen.getByRole('combobox', { name: 'Motor' })
    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: 'Beta' }))
    expect(change).toHaveBeenCalledWith('b')
    expect(document.activeElement).toBe(trigger)
  })
  it('supports keyboard selection inside a dialog', async () => {
    const user = userEvent.setup(), change = vi.fn()
    render(<div role="dialog"><CustomDropdown value="a" options={options} onChange={change} title="Escolher" /></div>)
    screen.getByRole('combobox').focus()
    await user.keyboard('[ArrowDown]')
    await screen.findByRole('listbox')
    await user.keyboard('[End][Enter]')
    expect(change).toHaveBeenCalledWith('g')
  })
  it('finds an option by typing its label', async () => {
    const user = userEvent.setup(), change = vi.fn()
    render(<CustomDropdown value="a" options={options} onChange={change} />)
    await user.click(screen.getByRole('combobox'))
    await user.keyboard('b[Enter]')
    expect(change).toHaveBeenCalledWith('b')
  })
  it('closes on Escape without changing the selected value', async () => {
    const user = userEvent.setup(), change = vi.fn()
    render(<CustomDropdown value="a" options={options} onChange={change} />)
    const trigger = screen.getByRole('combobox')
    await user.click(trigger); await user.keyboard('[Escape]')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(change).not.toHaveBeenCalled(); expect(document.activeElement).toBe(trigger)
  })
  it('provides an explicit state when there are no options', () => {
    render(<CustomDropdown value="a" options={[]} onChange={() => {}} />)
    expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Nenhuma opção disponível')).toBeDefined()
  })
})
