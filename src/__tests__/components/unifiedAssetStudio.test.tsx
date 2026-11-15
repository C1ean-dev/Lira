import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCustomAssetsStore } from '../../store/useCustomAssetsStore'
import { CustomElementModal } from '../../editor/CustomElementModal'
import { AssetDrawingStudio } from '../../editor/custom-element/AssetDrawingStudio'

vi.mock('../../store/useCustomAssetsStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../store/useCustomAssetsStore')>()
  return { ...actual, useCustomAssetsStore: Object.assign((select?: any) => select ? select(actual.useCustomAssetsStore.getState()) : actual.useCustomAssetsStore.getState(), actual.useCustomAssetsStore) }
})
const original = useCustomAssetsStore.getState()
afterEach(() => useCustomAssetsStore.setState(original))

describe('one studio for drawing and assembling assets', () => {
  it.each(['furniture', 'floor', 'wall'] as const)('opens a new %s in the same studio with the correct type', type => {
    useCustomAssetsStore.getState().openCreateModal('draw', 'Minha categoria', type)
    expect(useCustomAssetsStore.getState().initialAssetType).toBe(type)
    expect(useCustomAssetsStore.getState().initialStudioMode).toBe('draw')
    const html = renderToStaticMarkup(<CustomElementModal />)
    expect(html).toContain('Estúdio de Elementos')
    expect(html).toContain('Desenhar')
    expect(html).toContain('Importar e recortar')
    expect(html).toContain('Montagem e colisão')
    expect(html.match(/Salvar Elemento no Catálogo/g)).toHaveLength(1)
    expect(html).not.toContain('Salvar Preset')
  })
  it('routes editing to the same studio and keeps the existing asset identity', () => {
    useCustomAssetsStore.setState({ customAssets: [{ id: 'desk', type: 'furniture', category: 'Mesas', frames: ['desk.png'], width: 2, height: 1, name: 'Mesa de vidro', isObstacle: true, createdAt: 1 }] })
    useCustomAssetsStore.getState().openEditModal('desk', 'draw')
    expect(useCustomAssetsStore.getState().editingAssetId).toBe('desk')
    expect(useCustomAssetsStore.getState().getAssetById('desk')?.name).toBe('Mesa de vidro')
  })
  it('exposes pixel tools, history, zoom and trim inside the shared drawing area', () => {
    const html = renderToStaticMarkup(<AssetDrawingStudio width={29} height={27} onChange={vi.fn()} />)
    for (const label of ['Lápis', 'Borracha', 'Preencher', 'Conta-gotas', 'Mover pixels', 'Desfazer', 'Refazer', 'Aparar bordas', 'Cor do desenho']) expect(html).toContain(label)
    expect(html).toContain('<canvas')
    expect(html).not.toContain('Salvar Preset')
    expect(html).not.toContain('Cancelar')
  })
})
