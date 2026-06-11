import {expect} from 'chai'

import {fnLoadConfig} from '../../src/config.js'

const GaConfigEnvKeys = [
  'PORTAINER_URL',
  'PORTAINER_PAT_TOKEN',
  'PORTAINER_ENDPOINT_ID',
  'PORTAINER_TLS_VERIFY',
  'ALLOW_SELF_SIGNED_CERT',
  'MAX_DELETE_COUNT',
]

function fnWithEnv(iEnv: Record<string, string | undefined>, fnTest: () => void): void {
  // Preserve the caller's shell values so config tests cannot leak state.
  const LdOriginalEnv = new Map(GaConfigEnvKeys.map((LKey) => [LKey, process.env[LKey]]))

  try {
    for (const LKey of GaConfigEnvKeys) {
      delete process.env[LKey]
    }

    for (const [LKey, LValue] of Object.entries(iEnv)) {
      if (LValue !== undefined) {
        process.env[LKey] = LValue
      }
    }

    fnTest()
  } finally {
    for (const LKey of GaConfigEnvKeys) {
      const LValue = LdOriginalEnv.get(LKey)

      if (LValue === undefined) {
        delete process.env[LKey]
      } else {
        process.env[LKey] = LValue
      }
    }
  }
}

function fnBaseEnv(idOverrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    PORTAINER_URL: 'https://portainer.test///',
    PORTAINER_PAT_TOKEN: 'pat-token',
    ...idOverrides,
  }
}

describe('cleanup config module', () => {
  it('should load required Portainer settings from environment', () => {
    // The cleanup runner depends on URL and PAT being present before any API call starts.
    fnWithEnv(fnBaseEnv(), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.portainerUrl).to.equal('https://portainer.test')
      expect(LdConfig.patToken).to.equal('pat-token')
    })
  })

  it('should throw when Portainer URL is missing', () => {
    // Missing URL should fail early instead of producing confusing HTTP errors later.
    fnWithEnv(fnBaseEnv({PORTAINER_URL: undefined}), () => {
      expect(() => fnLoadConfig()).to.throw('Missing required environment variable: PORTAINER_URL')
    })
  })

  it('should throw when PAT token is missing', () => {
    // PAT token is the only supported cleanup authentication mechanism.
    fnWithEnv(fnBaseEnv({PORTAINER_PAT_TOKEN: undefined}), () => {
      expect(() => fnLoadConfig()).to.throw('Missing required environment variable: PORTAINER_PAT_TOKEN')
    })
  })

  it('should keep endpoint ID undefined when the env value is blank', () => {
    // Blank endpoint values allow the later auto-resolution path to run.
    fnWithEnv(fnBaseEnv({PORTAINER_ENDPOINT_ID: '   '}), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.endpointId).to.equal(undefined)
    })
  })

  it('should keep endpoint ID when the env value is meaningful', () => {
    // Manual endpoint selection must pass through unchanged.
    fnWithEnv(fnBaseEnv({PORTAINER_ENDPOINT_ID: '4'}), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.endpointId).to.equal('4')
    })
  })

  it('should enable TLS verification by default', () => {
    // Secure TLS is the default when no override is provided.
    fnWithEnv(fnBaseEnv(), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.tlsVerify).to.equal(true)
    })
  })

  it('should disable TLS verification when PORTAINER_TLS_VERIFY is false', () => {
    // This supports local Portainer installs with self-signed certificates.
    fnWithEnv(fnBaseEnv({PORTAINER_TLS_VERIFY: 'false'}), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.tlsVerify).to.equal(false)
    })
  })

  it('should disable TLS verification when self-signed certs are allowed', () => {
    // ALLOW_SELF_SIGNED_CERT takes priority over the normal TLS verification flag.
    fnWithEnv(fnBaseEnv({ALLOW_SELF_SIGNED_CERT: 'yes', PORTAINER_TLS_VERIFY: 'true'}), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.tlsVerify).to.equal(false)
    })
  })

  it('should default cleanup modes and max delete count', () => {
    // Default cleanup settings keep the operator flow predictable.
    fnWithEnv(fnBaseEnv(), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.imageCleanupMode).to.equal('unused')
      expect(LdConfig.volumeCleanupMode).to.equal('all-unused')
      expect(LdConfig.maxDeleteCount).to.equal(50)
    })
  })

  it('should load custom positive max delete count', () => {
    // MAX_DELETE_COUNT is operator-controlled and should remain configurable.
    fnWithEnv(fnBaseEnv({MAX_DELETE_COUNT: '75'}), () => {
      const LdConfig = fnLoadConfig()

      expect(LdConfig.maxDeleteCount).to.equal(75)
    })
  })

  it('should reject zero max delete count', () => {
    // A zero limit is invalid because cleanup planning expects at least one allowed deletion.
    fnWithEnv(fnBaseEnv({MAX_DELETE_COUNT: '0'}), () => {
      expect(() => fnLoadConfig()).to.throw('MAX_DELETE_COUNT must be a positive integer')
    })
  })

  it('should reject non-numeric max delete count', () => {
    // Invalid numeric input should stop before cleanup selection begins.
    fnWithEnv(fnBaseEnv({MAX_DELETE_COUNT: 'many'}), () => {
      expect(() => fnLoadConfig()).to.throw('MAX_DELETE_COUNT must be a positive integer')
    })
  })
})
