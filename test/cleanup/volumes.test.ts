import {expect} from 'chai'

import {
  fnDeleteVolumeCandidates,
  fnGetUsedVolumeNames,
  fnIsProtectedVolume,
  fnScanVolumes,
} from '../../src/cleanup/volumes.js'
import {
  IAppConfig,
  ICandidate,
  ICleanupReport,
  IDockerContainer,
  IDockerVolume,
  IDockerVolumeList,
} from '../../src/types.js'

interface IVolumeClientStub {
  LaRemovedNames: string[]
  fnGetContainers: (iAll?: boolean) => Promise<IDockerContainer[]>
  fnGetVolumes: () => Promise<IDockerVolumeList>
  fnRemoveVolume: (iVolumeName: string) => Promise<void>
}

interface ILoggerStub {
  LaErrors: string[]
  LaInfos: string[]
  error: (iMessage: string) => void
  info: (iMessage: string) => void
}

function fnCreateReport(): ICleanupReport {
  return {
    startedAt: '',
    finishedAt: '',
    endpointId: '1',
    dryRun: false,
    summary: {
      deleted: 0,
      candidates: 0,
      skipped: 0,
      failed: 0,
    },
    containers: {
      candidates: [],
      deleted: [],
      skipped: [],
      failed: [],
    },
    volumes: {
      candidates: [],
      deleted: [],
      skipped: [],
      failed: [],
    },
    images: {
      candidates: [],
      deleted: [],
      skipped: [],
      failed: [],
    },
  }
}

function fnCreateConfig(iMode: IAppConfig['volumeCleanupMode'] = 'all-unused'): IAppConfig {
  return {
    portainerUrl: 'http://portainer.test',
    patToken: 'token',
    endpointId: '1',
    tlsVerify: true,
    imageCleanupMode: 'unused',
    volumeCleanupMode: iMode,
    maxDeleteCount: 50,
  }
}

function fnCreateLogger(): ILoggerStub {
  return {
    LaErrors: [],
    LaInfos: [],
    error(iMessage: string): void {
      this.LaErrors.push(iMessage)
    },
    info(iMessage: string): void {
      this.LaInfos.push(iMessage)
    },
  }
}

function fnVolume(idOverrides: Partial<IDockerVolume> = {}): IDockerVolume {
  return {
    Name: 'bench_cache',
    Driver: 'local',
    Mountpoint: '/var/lib/docker/volumes/bench_cache/_data',
    Labels: {},
    Scope: 'local',
    ...idOverrides,
  }
}

function fnContainer(idOverrides: Partial<IDockerContainer> = {}): IDockerContainer {
  return {
    Id: 'container-1',
    Names: ['/bench_backend.1'],
    State: 'exited',
    Mounts: [],
    ...idOverrides,
  }
}

function fnCreateClient(
  iaVolumes: IDockerVolume[],
  iaContainers: IDockerContainer[],
): IVolumeClientStub {
  return {
    LaRemovedNames: [],
    async fnGetContainers(iAll = false): Promise<IDockerContainer[]> {
      expect(iAll).to.equal(true)

      return iaContainers
    },
    async fnGetVolumes(): Promise<IDockerVolumeList> {
      return {Volumes: iaVolumes}
    },
    async fnRemoveVolume(iVolumeName: string): Promise<void> {
      this.LaRemovedNames.push(iVolumeName)
    },
  }
}

describe('cleanup volumes module', () => {
  it('should collect named volumes mounted by containers', async () => {
    // Used-volume collection is the main guard that prevents deleting mounted data.
    const clClient = fnCreateClient([], [
      fnContainer({
        Mounts: [
          {Type: 'volume', Name: 'bench_cache'},
          {Type: 'volume', Name: 'bench_uploads'},
        ],
      }),
    ])

    const LaUsedVolumeNames = await fnGetUsedVolumeNames(clClient as never)

    expect([...LaUsedVolumeNames]).to.deep.equal(['bench_cache', 'bench_uploads'])
  })

  it('should ignore bind mounts and unnamed mounts while collecting used volumes', async () => {
    // Bind mounts are host paths, not Docker-managed named volumes, so they stay outside this cleanup check.
    const clClient = fnCreateClient([], [
      fnContainer({
        Mounts: [
          {Type: 'bind', Source: '/host/path', Destination: '/data'},
          {Type: 'volume'},
        ],
      }),
    ])

    const LaUsedVolumeNames = await fnGetUsedVolumeNames(clClient as never)

    expect(LaUsedVolumeNames.size).to.equal(0)
  })

  it('should protect volumes with keep labels', () => {
    // Explicit keep labels are treated as operator intent and must block cleanup.
    const LbProtected = fnIsProtectedVolume(fnVolume({Labels: {keep: 'true'}}))

    expect(LbProtected).to.equal(true)
  })

  it('should protect volumes with data-like names', () => {
    // Names containing database-related fragments are intentionally protected.
    const LbProtected = fnIsProtectedVolume(fnVolume({Name: 'bench_postgres_data'}))

    expect(LbProtected).to.equal(true)
  })

  it('should not protect normal cache-like volumes', () => {
    // Normal non-data names can still move into the safety validator for mode checks.
    const LbProtected = fnIsProtectedVolume(fnVolume({Name: 'bench_cache'}))

    expect(LbProtected).to.equal(false)
  })

  it('should scan unused volumes in all-unused mode', async () => {
    // All-unused mode accepts a volume when it is not mounted and not protected.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnVolume()], [])

    const LaCandidates = await fnScanVolumes(clClient as never, fnCreateConfig(), new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(1)
    expect(LdReport.volumes.candidates).to.have.length(1)
  })

  it('should resolve active stack volumes by Docker labels', async () => {
    // Label-based stack detection is the most reliable path for Swarm and Compose volumes.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([
      fnVolume({
        Name: 'cache_assets',
        Labels: {'com.docker.stack.namespace': 'bench'},
      }),
    ], [])

    await fnScanVolumes(clClient as never, fnCreateConfig(), new Set(['bench']), LdReport, clLogger as never)

    expect(LdReport.volumes.candidates[0].stackNamespace).to.equal('bench')
  })

  it('should resolve active stack volumes by name prefix fallback', async () => {
    // Prefix fallback keeps older stack volumes visible even when Docker labels are missing.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnVolume({Name: 'bench_assets'})], [])

    await fnScanVolumes(clClient as never, fnCreateConfig(), new Set(['bench']), LdReport, clLogger as never)

    expect(LdReport.volumes.candidates[0].stackNamespace).to.equal('bench')
  })

  it('should skip volumes that belong to inactive stacks', async () => {
    // A labelled stack volume is skipped when its stack is not currently active.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([
      fnVolume({
        Name: 'old_cache',
        Labels: {'com.docker.stack.namespace': 'oldstack'},
      }),
    ], [])

    const LaCandidates = await fnScanVolumes(clClient as never, fnCreateConfig(), new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
    expect(LdReport.volumes.candidates).to.have.length(0)
  })

  it('should skip volumes mounted by any container', async () => {
    // Mounted volumes stay protected even if the owning container is stopped.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnVolume()], [
      fnContainer({
        Mounts: [{Type: 'volume', Name: 'bench_cache'}],
      }),
    ])

    const LaCandidates = await fnScanVolumes(clClient as never, fnCreateConfig(), new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
    expect(clLogger.LaInfos.join('\n')).to.include('volume is mounted by at least one container')
  })

  it('should skip volumes with protected labels during scan', async () => {
    // Protected labels are checked during scan so risky volumes never reach the confirmation list.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnVolume({Labels: {protected: 'true'}})], [])

    const LaCandidates = await fnScanVolumes(clClient as never, fnCreateConfig(), new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
    expect(clLogger.LaInfos.join('\n')).to.include('volume has protected labels')
  })

  it('should scan hash-like volumes in anonymous mode', async () => {
    // Anonymous mode is stricter and accepts hash-like Docker-generated volume names.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnVolume({Name: 'abcdef1234567890abcdef1234567890'})], [])

    const LaCandidates = await fnScanVolumes(clClient as never, fnCreateConfig('anonymous'), new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(1)
    expect(LdReport.volumes.candidates[0].reason).to.equal('unused anonymous-looking volume')
  })

  it('should skip labelled named volumes in anonymous mode', async () => {
    // Named volumes with meaningful labels are not anonymous-looking and should remain untouched in anonymous mode.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([
      fnVolume({
        Name: 'bench_assets',
        Labels: {purpose: 'cache'},
      }),
    ], [])

    const LaCandidates = await fnScanVolumes(clClient as never, fnCreateConfig('anonymous'), new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
    expect(clLogger.LaInfos.join('\n')).to.include('volume is unused but does not look anonymous')
  })

  it('should create readable volume report records', async () => {
    // Report rows should preserve the volume name as both id and name for easy audit.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnVolume({Name: 'bench_tmp'})], [])

    await fnScanVolumes(clClient as never, fnCreateConfig(), new Set(['bench']), LdReport, clLogger as never)

    expect(LdReport.volumes.candidates[0].id).to.equal('bench_tmp')
    expect(LdReport.volumes.candidates[0].name).to.equal('bench_tmp')
  })

  it('should delete confirmed volume candidates', async () => {
    // Deletion should call Docker once for every confirmed volume candidate.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([], [])
    const LaCandidates: ICandidate<IDockerVolume>[] = [
      {resource: fnVolume({Name: 'bench_tmp'}), record: {id: 'bench_tmp', name: 'bench_tmp'}},
    ]

    await fnDeleteVolumeCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clClient.LaRemovedNames).to.deep.equal(['bench_tmp'])
    expect(LdReport.volumes.deleted).to.have.length(1)
  })

  it('should continue deleting volumes after one failure', async () => {
    // One Docker delete failure should be reported without blocking later candidates.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([], [])
    const LaCandidates: ICandidate<IDockerVolume>[] = [
      {resource: fnVolume({Name: 'bad_volume'}), record: {id: 'bad_volume', name: 'bad_volume'}},
      {resource: fnVolume({Name: 'good_volume'}), record: {id: 'good_volume', name: 'good_volume'}},
    ]

    clClient.fnRemoveVolume = async (iVolumeName: string): Promise<void> => {
      if (iVolumeName === 'bad_volume') {
        throw new Error('volume delete failed')
      }

      clClient.LaRemovedNames.push(iVolumeName)
    }

    await fnDeleteVolumeCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clClient.LaRemovedNames).to.deep.equal(['good_volume'])
    expect(LdReport.volumes.failed[0].error).to.equal('volume delete failed')
  })
})
