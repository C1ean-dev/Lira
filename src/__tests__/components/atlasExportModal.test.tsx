// @vitest-environment jsdom
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AtlasExportModal } from '../../components/avatar-customizer/AtlasExportModal'
import type { CustomAsset } from '../../types/customAsset'

const exportCategoryAtlasMock = vi.hoisted(() => vi.fn())

vi.mock('../../engine/avatar/avatarAtlasExporter', async importOriginal => {
  const actual = await importOriginal<typeof import('../../engine/avatar/avatarAtlasExporter')>()
  return {
    ...actual,
    exportCategoryAtlas: exportCategoryAtlasMock,
  }
})

vi.mock('../../editor/PixelArtThumbnail', () => ({
  PixelArtThumbnail: ({ id }: { id: string }) => <div data-testid={`thumb-${id}`} />,
}))

const furnitureAssets: CustomAsset[] = [
  {
    id: 'furn_sofa',
    name: 'sofa azul',
    type: 'furniture',
    category: 'Geral',
    width: 2,
    height: 1,
    isObstacle: true,
    frames: ['data:image/png;base64,a'],
    createdAt: 1,
  },
  {
    id: 'furn_mew',
    name: 'MEW',
    type: 'furniture',
    category: 'pokemon',
    width: 2,
    height: 2,
    isObstacle: true,
    frames: ['data:image/png;base64,b'],
    createdAt: 2,
  },
  {
    id: 'furn_estante',
    name: 'estante com vidro',
    type: 'furniture',
    category: 'pokemon',
    width: 3,
    height: 3,
    isObstacle: true,
    frames: ['data:image/png;base64,c'],
    createdAt: 3,
  },
  {
    id: 'floor_wood',
    name: 'piso especial',
    type: 'floor',
    category: 'Geral',
    width: 1,
    height: 1,
    isObstacle: false,
    frames: ['data:image/png;base64,d'],
    createdAt: 4,
  },
]

describe('AtlasExportModal', () => {
  beforeEach(() => {
    exportCategoryAtlasMock.mockReset()
    exportCategoryAtlasMock.mockResolvedValue({ xmlString: '<TextureAtlas />', pngDataUrl: 'data:image/png;base64,ok' })
  })

  afterEach(() => {
    cleanup()
  })

  it('opens with nothing selected and exports only the objects picked by the user', async () => {
    render(
      <AtlasExportModal
        isOpen={true}
        onClose={vi.fn()}
        category="furniture"
        customAssets={furnitureAssets}
        initialSubCategory="pokemon"
      />
    )

    // Starts focused on the active category ("pokemon") and never shows floors
    expect(screen.getByText('MEW')).toBeTruthy()
    expect(screen.getByText('estante com vidro')).toBeTruthy()
    expect(screen.queryByText('sofa azul')).toBeNull()
    expect(screen.queryByText('piso especial')).toBeNull()

    const exportBtn = screen.getByRole('button', { name: 'Exportar' }) as HTMLButtonElement
    expect(exportBtn.disabled).toBe(true)

    // Pick one object from "pokemon"
    fireEvent.click(screen.getByRole('button', { name: /estante com vidro/i }))
    expect(screen.getByRole('button', { name: 'Exportar (1)' })).toBeTruthy()

    // Switch to "Todas" and pick an object from "Geral" too
    fireEvent.click(screen.getByRole('button', { name: /Todas/i }))
    fireEvent.click(screen.getByRole('button', { name: /sofa azul/i }))

    // Rename export file
    fireEvent.change(screen.getByLabelText('Nome do arquivo:'), { target: { value: 'meus-objetos' } })

    fireEvent.click(screen.getByRole('button', { name: 'Exportar (2)' }))

    await waitFor(() => {
      expect(exportCategoryAtlasMock).toHaveBeenCalledTimes(1)
    })

    expect(exportCategoryAtlasMock).toHaveBeenCalledWith(
      'furniture',
      furnitureAssets,
      undefined,
      {
        selectedIds: ['furn_estante', 'furn_sofa'],
        fileBaseName: 'meus-objetos',
      }
    )
  })

  it('supports search filtering, select visible, and clear selection', () => {
    render(
      <AtlasExportModal
        isOpen={true}
        onClose={vi.fn()}
        category="furniture"
        customAssets={furnitureAssets}
      />
    )

    fireEvent.change(screen.getByLabelText('Buscar objeto por nome'), { target: { value: 'mew' } })
    expect(screen.getByText('MEW')).toBeTruthy()
    expect(screen.queryByText('estante com vidro')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar visíveis (1)' }))
    expect(screen.getByRole('button', { name: 'Exportar (1)' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Limpar (1)' }))
    const exportBtn = screen.getByRole('button', { name: 'Exportar' }) as HTMLButtonElement
    expect(exportBtn.disabled).toBe(true)
  })

  it('shows an empty state when there are no custom objects in the category', () => {
    render(
      <AtlasExportModal
        isOpen={true}
        onClose={vi.fn()}
        category="wall"
        customAssets={furnitureAssets}
      />
    )

    expect(screen.getByText('Nenhum objeto personalizado para exportar')).toBeTruthy()
    const exportBtn = screen.getByRole('button', { name: 'Exportar' }) as HTMLButtonElement
    expect(exportBtn.disabled).toBe(true)
  })
})
