import {expect} from 'chai'

import {fnClassifyHealth} from '../../../src/stack-health/validation/container-health-validator.js'

describe('fnClassifyHealth', () => {
  it('returns known Docker health states unchanged', () => {
    const LHealth = fnClassifyHealth({
      Id: 'container-1',
      State: {
        Health: {
          Status: 'healthy',
        },
      },
    })

    expect(LHealth).to.equal('healthy')
  })

  it('returns unknown when health data is missing', () => {
    const LHealth = fnClassifyHealth({
      Id: 'container-2',
    })

    expect(LHealth).to.equal('unknown')
  })
})
