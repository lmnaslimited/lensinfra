import axios from 'axios'
import {expect} from 'chai'

import {clDockerGatewayClient} from '../../src/docker-gateway-client.js'
import {IAppConfig} from '../../src/types.js'

interface IHttpCall {
  LdOptions?: unknown
  LPath: string
}

interface IHttpStub {
  LaDeleteCalls: IHttpCall[]
  LaGetCalls: IHttpCall[]
  LdCreateConfig?: Record<string, unknown>
  delete: (iPath: string, idOptions?: unknown) => Promise<void>
  get: <T>(iPath: string, idOptions?: unknown) => Promise<{data: T}>
}

type TCreateAxios = typeof axios.create

const fnOriginalAxiosCreate = axios.create.bind(axios)

function fnCreateConfig(idOverrides: Partial<IAppConfig> = {}): IAppConfig {
  return {
    portainerUrl: 'https://portainer.test',
    patToken: 'pat-token',
    endpointId: '7',
    tlsVerify: true,
    imageCleanupMode: 'unused',
    volumeCleanupMode: 'all-unused',
    maxDeleteCount: 50,
    ...idOverrides,
  }
}

function fnCreateHttpStub(idGetDataByPath: Record<string, unknown> = {}): IHttpStub {
  return {
    LaDeleteCalls: [],
    LaGetCalls: [],
    async delete(iPath: string, idOptions?: unknown): Promise<void> {
      this.LaDeleteCalls.push({LPath: iPath, LdOptions: idOptions})
    },
    async get<T>(iPath: string, idOptions?: unknown): Promise<{data: T}> {
      this.LaGetCalls.push({LPath: iPath, LdOptions: idOptions})

      return {data: idGetDataByPath[iPath] as T}
    },
  }
}

function fnInstallAxiosStub(clHttp: IHttpStub): void {
  // Capture axios.create options so constructor behavior can be verified without real HTTP.
  ;(axios as unknown as {create: TCreateAxios}).create = ((idConfig: Record<string, unknown>) => {
    clHttp.LdCreateConfig = idConfig

    return clHttp
  }) as unknown as TCreateAxios
}

describe('docker gateway client module', () => {
  afterEach(() => {
    ;(axios as unknown as {create: TCreateAxios}).create = fnOriginalAxiosCreate
  })

  it('should require a resolved endpoint ID', () => {
    // Docker gateway URLs cannot be built safely until endpoint resolution finishes.
    expect(() => new clDockerGatewayClient(fnCreateConfig({endpointId: undefined}), {'X-API-Key': 'token'})).to.throw(
      'Docker gateway client requires a resolved endpoint ID',
    )
  })

  it('should create axios client scoped to the selected endpoint', () => {
    // The base URL must route Docker API calls through Portainer's endpoint gateway.
    const clHttp = fnCreateHttpStub()
    fnInstallAxiosStub(clHttp)

    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    expect(clClient).to.be.instanceOf(clDockerGatewayClient)
    expect(clHttp.LdCreateConfig?.baseURL).to.equal('https://portainer.test/api/endpoints/7/docker')
    expect(clHttp.LdCreateConfig?.headers).to.deep.equal({'X-API-Key': 'token'})
  })

  it('should create insecure HTTPS agent when TLS verification is disabled', () => {
    // Self-signed local installs need the rejectUnauthorized=false agent path.
    const clHttp = fnCreateHttpStub()
    fnInstallAxiosStub(clHttp)

    const clClient = new clDockerGatewayClient(fnCreateConfig({tlsVerify: false}), {'X-API-Key': 'token'})

    expect(clClient).to.be.instanceOf(clDockerGatewayClient)
    expect(clHttp.LdCreateConfig?.httpsAgent).to.exist
  })

  it('should fetch all containers by default', async () => {
    // Cleanup must inspect stopped and dead containers, so all=true is the default.
    const clHttp = fnCreateHttpStub({'/containers/json': [{Id: 'container-1'}]})
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    const LaContainers = await clClient.fnGetContainers()

    expect(LaContainers).to.deep.equal([{Id: 'container-1'}])
    expect(clHttp.LaGetCalls[0]).to.deep.equal({LPath: '/containers/json', LdOptions: {params: {all: true}}})
  })

  it('should fetch Docker version without mutating resources', async () => {
    // The version probe is used as a read-only gateway validation call.
    const clHttp = fnCreateHttpStub({'/version': {Version: '25.0.0'}})
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    const LdVersion = await clClient.fnGetVersion()

    expect(LdVersion.Version).to.equal('25.0.0')
    expect(clHttp.LaGetCalls[0].LPath).to.equal('/version')
  })

  it('should encode container IDs before inspect requests', async () => {
    // Encoding keeps special characters from changing the HTTP route.
    const clHttp = fnCreateHttpStub({'/containers/container%2Fone/json': {Id: 'container/one'}})
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    await clClient.fnInspectContainer('container/one')

    expect(clHttp.LaGetCalls[0].LPath).to.equal('/containers/container%2Fone/json')
  })

  it('should delete containers without force or volume removal', async () => {
    // Container deletion must keep the operational safety params unchanged.
    const clHttp = fnCreateHttpStub()
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    await clClient.fnRemoveContainer('container/one')

    expect(clHttp.LaDeleteCalls[0]).to.deep.equal({
      LPath: '/containers/container%2Fone',
      LdOptions: {params: {v: false, force: false}},
    })
  })

  it('should fetch Docker volumes from the gateway', async () => {
    // Volume scanning starts from the Docker /volumes response shape.
    const clHttp = fnCreateHttpStub({'/volumes': {Volumes: [{Name: 'bench_cache'}]}})
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    const LdVolumes = await clClient.fnGetVolumes()

    expect(LdVolumes.Volumes?.[0].Name).to.equal('bench_cache')
  })

  it('should delete selected volumes by encoded name', async () => {
    // Volume names are sent in the route and must be encoded safely.
    const clHttp = fnCreateHttpStub()
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    await clClient.fnRemoveVolume('volume/name')

    expect(clHttp.LaDeleteCalls[0].LPath).to.equal('/volumes/volume%2Fname')
  })

  it('should fetch all images for cleanup scanning', async () => {
    // Image cleanup relies on all=true so unused images are visible.
    const clHttp = fnCreateHttpStub({'/images/json': [{Id: 'image-1'}]})
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    const LaImages = await clClient.fnGetImages()

    expect(LaImages).to.deep.equal([{Id: 'image-1'}])
    expect(clHttp.LaGetCalls[0]).to.deep.equal({LPath: '/images/json', LdOptions: {params: {all: true}}})
  })

  it('should delete images without force pruning', async () => {
    // Image deletion must not force-remove dependent resources.
    const clHttp = fnCreateHttpStub()
    fnInstallAxiosStub(clHttp)
    const clClient = new clDockerGatewayClient(fnCreateConfig(), {'X-API-Key': 'token'})

    await clClient.fnRemoveImage('sha256:image/one')

    expect(clHttp.LaDeleteCalls[0]).to.deep.equal({
      LPath: '/images/sha256%3Aimage%2Fone',
      LdOptions: {params: {force: false, noprune: false}},
    })
  })
})
