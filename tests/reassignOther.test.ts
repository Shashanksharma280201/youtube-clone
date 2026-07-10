import { describe, it, expect } from 'vitest'
import { parseReassignments } from '@/lib/pipeline/reassignOther'

const allowed = ['air supply check', 'electrical check', 'mechanical check']

describe('parseReassignments', () => {
  it('maps each index to its assigned phase', () => {
    const raw = JSON.stringify({
      assignments: [
        { i: 0, phase: 'air supply check' },
        { i: 1, phase: 'electrical check' },
      ],
    })
    expect(parseReassignments(raw, 2, allowed)).toEqual(['air supply check', 'electrical check'])
  })

  it('keeps "other" for a phase not in the allowed list', () => {
    const raw = JSON.stringify({ assignments: [{ i: 0, phase: 'made up phase' }] })
    expect(parseReassignments(raw, 1, allowed)).toEqual(['other'])
  })

  it('keeps "other" for indices the model omitted', () => {
    const raw = JSON.stringify({ assignments: [{ i: 0, phase: 'mechanical check' }] })
    expect(parseReassignments(raw, 2, allowed)).toEqual(['mechanical check', 'other'])
  })

  it('returns all "other" on malformed output', () => {
    expect(parseReassignments('not json', 2, allowed)).toEqual(['other', 'other'])
  })
})
