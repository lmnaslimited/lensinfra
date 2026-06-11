import axios from 'axios'
import {expect} from 'chai'

import {clPortainerClient, fnFormatAxiosError} from '../../src/portainer-client.js'
import {IAppConfig, IPortainerEndpoint} from '../../src/types.js'

interface IHttpCall {
  LdOptions?: unknown
  LPath: string
}

interface IHttpStub {
  LaGetCalls: IHttpCall[]
  LdCreateConfig?: Record<string, unknown>
  fnGetHandler: (iPath: string, idOptions?: unknown) => Promise<unknown>
  get: <T>(iPath: string, idOptions?: unknown) => Promise<{data: T}>
}

type TCreateAxios = typeof axios.create

const fnOriginalAxiosCreate = axios.create.bind(axios)

function fnCreateConfig(idOverrides: Partial<IAppConfig> = {}): IAppConfig {
  return {
    portainerUrl: 'https://portainer.test',
    patToken: 'pat-token',
    endpointId: 'auto',
    tlsVerify: true,
    imageCleanupMode: 'unused',
    volumeCleanupMode: 'all-unused',
    maxDeleteCount: 50,
    ...idOverrides,
  }
}

function fnCreateHttpStub(fnGetHandler: IHttpStub['fnGetHandler']): IHttpStub {
  return {
    LaGetCalls: [],
    fnGetHandler,
    async get<T>(iPath: string, idOptions?: unknown): Promise<{data: T}> {
      this.LaGetCalls.push({LPath: iPath, LdOptions: idOptions})

      return {data: await this.fnGetHandler(iPath, idOptions) as T}
    },
  }
}

function fnInstallAxiosStub(clHttp: IHttpStub): void {
  // Portainer client tests replace axios.create so no real API calls can happen.
  ;(axios as unknown as {create: TCreateAxios}).create = ((idConfig: Record<string, unknown>) => {
    clHttp.LdCreateConfig = idConfig

    return clHttp
  }) as unknown as TCreateAxios
}

function fnEndpoint(iId: number, iName: string, iStatus = 1): IPortainerEndpoint {
  return {
    Id: iId,
    Name: iName,
    Status: iStatus,
    Type: 1,
  }
}

describe('portainer client module', () => {
  afterEach(() => {
    ;(axios as unknown as {create: TCreateAxios}).create = fnOriginalAxiosCreate
  })

  it('should create axios client with Portainer base URL', () => {
    // The Portainer client talks to normal Portainer API routes, not Docker gateway routes.
    const clHttp = fnCreateHttpStub(async () => [])
    fnInstallAxiosStub(clHttp)

    const clClient = new clPortainerClient(fnCreateConfig())

    expect(clClient).to.be.instanceOf(clPortainerClient)
    expect(clHttp.LdCreateConfig?.baseURL).to.equal('https://portainer.test')
  })

  it('should return PAT authentication headers', () => {
    // Cleanup supports Portainer PAT auth through X-API-Key.
    const clHttp = fnCreateHttpStub(async () => [])
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    expect(clClient.fnAuthHeaders()).to.deep.equal({'X-API-Key': 'pat-token'})
  })

  it('should list Portainer endpoints with auth headers', async () => {
    // Endpoint listing is the harmless PAT validation request.
    const clHttp = fnCreateHttpStub(async () => [fnEndpoint(1, 'local')])
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    const LaEndpoints = await clClient.fnListEndpoints()

    expect(LaEndpoints[0].Name).to.equal('local')
    expect(clHttp.LaGetCalls[0]).to.deep.equal({
      LPath: '/api/endpoints',
      LdOptions: {headers: {'X-API-Key': 'pat-token'}},
    })
  })

  it('should wrap endpoint list failures with a clear message', async () => {
    // Wrapped errors make startup failures readable in CLI output and reports.
    const clHttp = fnCreateHttpStub(async () => {
      throw new Error('network down')
    })
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    await clClient.fnListEndpoints().then(
      () => {
        throw new Error('expected list endpoints to fail')
      },
      (idError: unknown) => {
        expect(idError).to.be.instanceOf(Error)
        expect((idError as Error).message).to.equal('Unable to list Portainer endpoints: network down')
      },
    )
  })

  it('should list stacks for the selected endpoint', async () => {
    // Stack listing is filtered by endpointId so active-stack cleanup guards use the right target.
    const clHttp = fnCreateHttpStub(async () => [{Id: 10, Name: 'bench'}])
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    const LaStacks = await clClient.fnListStacks('7')

    expect(LaStacks[0].Name).to.equal('bench')
    expect(clHttp.LaGetCalls[0].LdOptions).to.deep.equal({
      headers: {'X-API-Key': 'pat-token'},
      params: {endpointId: '7'},
    })
  })

  it('should require endpoint ID before validating endpoint access', async () => {
    // Endpoint access validation cannot run until manual or auto resolution has completed.
    const clHttp = fnCreateHttpStub(async () => ({}))
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig({endpointId: undefined}))

    await clClient.fnValidateEndpointAccess().then(
      () => {
        throw new Error('expected validation to fail')
      },
      (idError: unknown) => {
        expect((idError as Error).message).to.equal('Cannot validate endpoint access before endpoint ID is resolved')
      },
    )
  })

  it('should report Docker gateway availability as true on success', async () => {
    // Docker gateway probing decides whether auto endpoint selection can use an endpoint.
    const clHttp = fnCreateHttpStub(async () => ({Version: '25.0.0'}))
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    const LbCanUseGateway = await clClient.fnCanUseDockerGateway('7')

    expect(LbCanUseGateway).to.equal(true)
  })

  it('should report Docker gateway availability as false on failure', async () => {
    // Gateway failures are converted to false so auto selection can continue checking endpoints.
    const clHttp = fnCreateHttpStub(async () => {
      throw new Error('gateway failed')
    })
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    const LbCanUseGateway = await clClient.fnCanUseDockerGateway('7')

    expect(LbCanUseGateway).to.equal(false)
  })

  it('should return manual endpoint IDs without auto-selection', async () => {
    // Manual endpoint selection must not perform discovery API calls.
    const clHttp = fnCreateHttpStub(async () => [])
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig({endpointId: '9'}))

    const LEndpointId = await clClient.fnResolveEndpointId()

    expect(LEndpointId).to.equal('9')
    expect(clHttp.LaGetCalls).to.deep.equal([])
  })

  it('should auto-select the only active endpoint with Docker gateway access', async () => {
    // Auto-selection should settle on exactly one working gateway endpoint.
    const LdConfig = fnCreateConfig({endpointId: 'auto'})
    const clHttp = fnCreateHttpStub(async (LPath: string) => {
      if (LPath === '/api/endpoints') {
        return [fnEndpoint(1, 'local'), fnEndpoint(2, 'remote', 2)]
      }

      return {Version: '25.0.0'}
    })
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(LdConfig)

    const LEndpointId = await clClient.fnResolveEndpointId()

    expect(LEndpointId).to.equal('1')
    expect(LdConfig.endpointId).to.equal('1')
  })

  it('should reject auto-selection when multiple gateways are available', async () => {
    // Multiple valid targets require the operator to set PORTAINER_ENDPOINT_ID explicitly.
    const clHttp = fnCreateHttpStub(async (LPath: string) => {
      if (LPath === '/api/endpoints') {
        return [fnEndpoint(1, 'local'), fnEndpoint(2, 'remote')]
      }

      return {Version: '25.0.0'}
    })
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    await clClient.fnResolveEndpointId().then(
      () => {
        throw new Error('expected auto endpoint resolution to fail')
      },
      (idError: unknown) => {
        expect((idError as Error).message).to.include('multiple active endpoints')
      },
    )
  })

  it('should reject auto-selection when no gateway is available', async () => {
    // No usable Docker gateway means cleanup cannot safely talk to Docker.
    const clHttp = fnCreateHttpStub(async (LPath: string) => {
      if (LPath === '/api/endpoints') {
        return [fnEndpoint(1, 'local')]
      }

      throw new Error('gateway failed')
    })
    fnInstallAxiosStub(clHttp)
    const clClient = new clPortainerClient(fnCreateConfig())

    await clClient.fnResolveEndpointId().then(
      () => {
        throw new Error('expected auto endpoint resolution to fail')
      },
      (idError: unknown) => {
        expect((idError as Error).message).to.include('found no active endpoints')
      },
    )
  })

  it('should format Axios response errors with status and body', () => {
    // Report entries should keep enough HTTP detail for operator troubleshooting.
    const LMessage = fnFormatAxiosError({
      isAxiosError: true,
      message: 'request failed',
      response: {
        status: 403,
        statusText: 'Forbidden',
        data: {message: 'denied'},
      },
    })

    expect(LMessage).to.equal('403 Forbidden {"message":"denied"}')
  })

  it('should format normal errors by message', () => {
    // Non-Axios failures should still produce compact report strings.
    expect(fnFormatAxiosError(new Error('plain failure'))).to.equal('plain failure')
  })
})
