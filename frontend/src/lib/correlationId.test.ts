/**
 * Correlation id generator tests.
 *
 * Author: Qoder
 */
import { describe, expect, it } from 'vitest'
import { newCorrelationId } from './correlationId'

describe('newCorrelationId', () => {
  it('emits the anl- prefixed format', () => {
    const id = newCorrelationId()
    expect(id).toMatch(/^anl-\d{10,13}-[0-9a-f]{8}$/)
  })

  it('stays unique across consecutive calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newCorrelationId()))
    expect(ids.size).toBe(1000)
  })
})
