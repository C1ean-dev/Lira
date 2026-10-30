import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PetApiSettings } from '../../components/pets/PetApiSettings'

vi.mock('../../services/petApiKey', () => ({ getRoomPetApiKey: () => '', setRoomPetApiKey: vi.fn() }))

describe('room pet API settings', () => {
  it('offers a password field and explains that the key stays local', () => {
    const html = renderToStaticMarkup(<PetApiSettings roomId="room" initiallyOpen />)
    expect(html).toContain('Chave OpenRouter')
    expect(html).toContain('type="password"')
    expect(html).toContain('somente neste dispositivo')
    expect(html).toContain('Salvar chave')
    expect(html).toContain('todos os pets da sala')
    expect(html).toContain('perguntas e personalidades')
  })
})
