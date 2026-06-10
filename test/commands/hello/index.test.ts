import {expect} from 'chai'

import {fnMaskSecret} from '../../../src/stack-health/config.js'

describe('fnMaskSecret', () => {
  it('masks long secrets while keeping token shape visible', () => {
    const LMaskedSecret = fnMaskSecret('abcd1234wxyz5678')

    expect(LMaskedSecret).to.equal('abcd...5678')
  })

  it('fully masks short secrets', () => {
    const LMaskedSecret = fnMaskSecret('short')

    expect(LMaskedSecret).to.equal('********')
  })
})
