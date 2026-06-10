import {expect} from 'chai'

import {
  IAppConfig,
  ICandidate,
  ICleanupReport,
  IDockerContainer,
  IDockerImage,
  IDockerVolume,
  IPortainerEndpoint,
  IPortainerStack,
  TAuthHeaders,
  TCleanupScope,
  TImageCleanupMode,
  TVolumeCleanupMode,
} from '../../src/types.js'

describe('cleanup types module', () => {
  it('should support the cleanup app config runtime shape', () => {
    // Config shape is shared by the cleanup runner, Portainer client, and Docker gateway client.
    const LdConfig: IAppConfig = {
      portainerUrl: 'https://portainer.test',
      patToken: 'pat-token',
      endpointId: '1',
      tlsVerify: true,
      imageCleanupMode: 'unused',
      volumeCleanupMode: 'all-unused',
      maxDeleteCount: 50,
    }

    expect(LdConfig.maxDeleteCount).to.equal(50)
  })

  it('should support PAT auth header shape', () => {
    // Portainer PAT auth is intentionally represented as an X-API-Key header map.
    const LdHeaders: TAuthHeaders = {'X-API-Key': 'pat-token'}

    expect(LdHeaders['X-API-Key']).to.equal('pat-token')
  })

  it('should support Portainer endpoint and stack payload shapes', () => {
    // Portainer payload types preserve fields used by endpoint resolution and active-stack filtering.
    const LdEndpoint: IPortainerEndpoint = {Id: 1, Name: 'local', Type: 1, Status: 1}
    const LdStack: IPortainerStack = {Id: 10, Name: 'bench', EndpointId: 1, Status: 'active'}

    expect(LdEndpoint.Name).to.equal('local')
    expect(LdStack.Status).to.equal('active')
  })

  it('should support Docker container payload shape with mounts and labels', () => {
    // Container cleanup and volume safety both read labels and mounts from this shared type.
    const LdContainer: IDockerContainer = {
      Id: 'container-1',
      Names: ['/bench_backend.1'],
      ImageID: 'sha256:image-1',
      Labels: {'com.docker.stack.namespace': 'bench'},
      Mounts: [{Type: 'volume', Name: 'bench_cache'}],
    }

    expect(LdContainer.Mounts?.[0].Name).to.equal('bench_cache')
  })

  it('should support Docker volume payload shape', () => {
    // Volume cleanup uses Name as the stable identifier because Docker volumes do not expose an ID.
    const LdVolume: IDockerVolume = {
      Name: 'bench_cache',
      Driver: 'local',
      Labels: {purpose: 'cache'},
    }

    expect(LdVolume.Name).to.equal('bench_cache')
  })

  it('should support Docker image payload shape', () => {
    // Image cleanup reads tags, size, and labels from this shared Docker image type.
    const LdImage: IDockerImage = {
      Id: 'sha256:image-1',
      RepoTags: ['bench:latest'],
      Size: 1024,
      Labels: {},
    }

    expect(LdImage.RepoTags).to.deep.equal(['bench:latest'])
  })

  it('should support cleanup report section shape', () => {
    // Report sections must keep candidates, deleted, skipped, and failed arrays separate.
    const LdReport: ICleanupReport = {
      startedAt: '',
      finishedAt: '',
      endpointId: '1',
      dryRun: true,
      summary: {
        deleted: 0,
        candidates: 0,
        skipped: 0,
        failed: 0,
      },
      containers: {candidates: [], deleted: [], skipped: [], failed: []},
      volumes: {candidates: [], deleted: [], skipped: [], failed: []},
      images: {candidates: [], deleted: [], skipped: [], failed: []},
    }

    LdReport.containers.candidates.push({id: 'container-1'})

    expect(LdReport.containers.candidates[0].id).to.equal('container-1')
  })

  it('should support generic cleanup candidates', () => {
    // Candidate pairs keep raw Docker data linked to the normalized report row.
    const LdCandidate: ICandidate<IDockerVolume> = {
      resource: {Name: 'bench_cache'},
      record: {id: 'bench_cache', name: 'bench_cache'},
    }

    expect(LdCandidate.resource.Name).to.equal(LdCandidate.record.name)
  })

  it('should support cleanup scope and mode unions', () => {
    // These literal unions document the accepted cleanup categories and modes.
    const LScope: TCleanupScope = 'all'
    const LImageMode: TImageCleanupMode = 'dangling'
    const LVolumeMode: TVolumeCleanupMode = 'anonymous'

    expect([LScope, LImageMode, LVolumeMode]).to.deep.equal(['all', 'dangling', 'anonymous'])
  })
})
