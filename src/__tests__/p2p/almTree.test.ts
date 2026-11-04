import { describe, expect, it } from 'vitest'
import { AlmTree } from '../../p2p/almTree'

function example() {
  const tree = new AlmTree('1')
  for (let id = 2; id <= 7; id++) tree.add(String(id))
  return tree
}

function assertTree(tree: AlmTree) {
  for (const child of tree.parents.keys()) {
    const path = new Set<string>()
    let id = child
    while (id !== tree.root) {
      expect(path.has(id)).toBe(false)
      path.add(id)
      expect(tree.parents.has(id)).toBe(true)
      id = tree.parents.get(id)!
    }
    expect(tree.children(child).length).toBeLessThanOrEqual(3)
  }
  expect(tree.children(tree.root).length).toBeLessThanOrEqual(3)
}

describe('Live ALM tree', () => {
  it('serves twelve participants with only three copies leaving the presenter', () => {
    const tree = new AlmTree('1')
    for (let id = 2; id <= 12; id++) expect(tree.add(String(id))).toBe(true)
    expect(tree.children('1')).toEqual(['2', '3', '4'])
    expect(tree.parents.size).toBe(11)
    assertTree(tree)
  })

  it('sheds only 7 from 2 to idle child 5, keeping 5 and 6 connected', () => {
    const tree = example()
    expect(tree.shed('2', 2)).toBe(true)
    expect([...tree.parents]).toEqual([['2', '1'], ['3', '1'], ['4', '1'], ['5', '2'], ['6', '2'], ['7', '5']])
    assertTree(tree)
    tree.add('8')
    expect(tree.children('2')).toEqual(['5', '6'])
  })

  it('removes a departed relay without rebuilding unrelated branches', () => {
    const tree = example()
    tree.shed('2', 2)
    const parentOf7 = tree.parents.get('7')
    expect(tree.remove('2')).toEqual([])
    expect(tree.parents.get('3')).toBe('1')
    expect(tree.parents.get('4')).toBe('1')
    expect(tree.parents.get('7')).toBe(parentOf7)
    assertTree(tree)
  })

  it('never creates cycles while repeatedly shedding and reconnecting nodes', () => {
    const tree = new AlmTree('1')
    for (let id = 2; id <= 80; id++) tree.add(String(id))
    for (let id = 2; id <= 40; id++) { tree.shed(String(id), 1); assertTree(tree) }
    for (let id = 2; id <= 30; id += 3) { tree.remove(String(id)); assertTree(tree) }
  })
})
