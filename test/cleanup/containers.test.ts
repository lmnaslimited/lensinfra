import {expect} from 'chai'

import {
  fnDeleteContainerCandidates,
  fnGetContainerStackName,
  fnScanContainers,
} from '../../src/cleanup/containers.js'
import {
  ICandidate,
  ICleanupReport,
  IDockerContainer,
} from '../../src/types.js'

interface IContainerClientStub {
  LaRemovedIds: string[]
  fnGetContainers: (iAll?: boolean) => Promise<IDockerContainer[]>
  fnRemoveContainer: (iContainerId: string) => Promise<void>
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

function fnCreateClient(iaContainers: IDockerContainer[]): IContainerClientStub {
  return {
    LaRemovedIds: [],
    async fnGetContainers(iAll = false): Promise<IDockerContainer[]> {
      expect(iAll).to.equal(true)

      return iaContainers
    },
    async fnRemoveContainer(iContainerId: string): Promise<void> {
      this.LaRemovedIds.push(iContainerId)
    },
  }
}

function fnContainer(idOverrides: Partial<IDockerContainer> = {}): IDockerContainer {
  return {
    Id: 'container-1234567890',
    Names: ['/bench_backend.1'],
    Image: 'bench:latest',
    State: 'exited',
    Status: 'Exited 1 minute ago',
    Labels: {
      'com.docker.stack.namespace': 'bench',
      'com.docker.swarm.service.name': 'bench_backend',
      'com.docker.swarm.task.name': 'bench_backend.1',
      'com.docker.swarm.task.desired-state': 'shutdown',
    },
    ...idOverrides,
  }
}

describe('cleanup containers module', () => {
  it('should resolve stack name from Docker Swarm namespace label', () => {
    // Validate the primary stack label used by Docker Swarm deployments.
    const LStackName = fnGetContainerStackName(fnContainer())

    expect(LStackName).to.equal('bench')
  })

  it('should resolve stack name from Docker Compose project label', () => {
    // Validate fallback support for Compose-created containers.
    const LStackName = fnGetContainerStackName(fnContainer({
      Labels: {
        'com.docker.compose.project': 'compose-bench',
      },
    }))

    expect(LStackName).to.equal('compose-bench')
  })

  it('should resolve stack name from Portainer stack label', () => {
    // Validate fallback support for Portainer-labelled containers.
    const LStackName = fnGetContainerStackName(fnContainer({
      Labels: {
        'io.portainer.stack.name': 'portainer-bench',
      },
    }))

    expect(LStackName).to.equal('portainer-bench')
  })

  it('should return undefined when no stack label exists', () => {
    // Containers with no stack identity are intentionally ignored by cleanup.
    const LStackName = fnGetContainerStackName(fnContainer({Labels: {}}))

    expect(LStackName).to.equal(undefined)
  })

  it('should scan exited containers from active stacks', async () => {
    // A stopped container from an active stack should become a deletion candidate.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnContainer()])

    const LaCandidates = await fnScanContainers(clClient as never, new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(1)
    expect(LdReport.containers.candidates).to.have.length(1)
  })

  it('should scan dead containers from active stacks', async () => {
    // Dead containers are included because they are not running workload.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnContainer({State: 'dead'})])

    const LaCandidates = await fnScanContainers(clClient as never, new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates[0].record.state).to.equal('dead')
  })

  it('should ignore running containers', async () => {
    // Running containers must never be proposed for cleanup.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnContainer({State: 'running'})])

    const LaCandidates = await fnScanContainers(clClient as never, new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
  })

  it('should ignore containers without stack labels', async () => {
    // Standalone containers are outside this cleanup module's ownership.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnContainer({Labels: {}})])

    await fnScanContainers(clClient as never, new Set(['bench']), LdReport, clLogger as never)

    expect(clLogger.LaInfos.join('\n')).to.include('does not belong to a Portainer stack')
  })

  it('should ignore containers from inactive stacks', async () => {
    // A stack label alone is not enough; the stack must also be active.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnContainer()])

    const LaCandidates = await fnScanContainers(clClient as never, new Set(['other']), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
    expect(clLogger.LaInfos.join('\n')).to.include('stack is not active')
  })

  it('should create readable container record fields', async () => {
    // Report rows should contain short IDs and human-friendly names.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnContainer()])

    await fnScanContainers(clClient as never, new Set(['bench']), LdReport, clLogger as never)

    expect(LdReport.containers.candidates[0].id).to.equal('container-12')
    expect(LdReport.containers.candidates[0].name).to.equal('bench_backend.1')
  })

  it('should include swarm labels in container record', async () => {
    // Swarm metadata makes reports easier to audit after cleanup.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnContainer()])

    await fnScanContainers(clClient as never, new Set(['bench']), LdReport, clLogger as never)

    expect(LdReport.containers.candidates[0].serviceName).to.equal('bench_backend')
    expect(LdReport.containers.candidates[0].desiredState).to.equal('shutdown')
  })

  it('should delete confirmed container candidates', async () => {
    // Deletion should call Docker once for every confirmed candidate.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([])
    const LaCandidates: ICandidate<IDockerContainer>[] = [
      {resource: fnContainer({Id: 'container-a'}), record: {id: 'container-a'}},
    ]

    await fnDeleteContainerCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clClient.LaRemovedIds).to.deep.equal(['container-a'])
    expect(LdReport.containers.deleted).to.have.length(1)
  })

  it('should continue deleting after one container fails', async () => {
    // One Docker delete failure should not block later candidates.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([])
    const LaCandidates: ICandidate<IDockerContainer>[] = [
      {resource: fnContainer({Id: 'bad'}), record: {id: 'bad'}},
      {resource: fnContainer({Id: 'good'}), record: {id: 'good'}},
    ]

    clClient.fnRemoveContainer = async (iContainerId: string): Promise<void> => {
      if (iContainerId === 'bad') {
        throw new Error('remove failed')
      }

      clClient.LaRemovedIds.push(iContainerId)
    }

    await fnDeleteContainerCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clClient.LaRemovedIds).to.deep.equal(['good'])
    expect(LdReport.containers.failed[0].error).to.equal('remove failed')
  })

  it('should log container deletion success', async () => {
    // Success logs help operators trace what was removed.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([])
    const LaCandidates: ICandidate<IDockerContainer>[] = [
      {resource: fnContainer({Id: 'container-a'}), record: {id: 'container-a'}},
    ]

    await fnDeleteContainerCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clLogger.LaInfos.join('\n')).to.include('Deleted container container-a')
  })

  it('should log container deletion failure', async () => {
    // Failure logs should include the container ID for follow-up.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([])
    const LaCandidates: ICandidate<IDockerContainer>[] = [
      {resource: fnContainer({Id: 'bad'}), record: {id: 'bad'}},
    ]

    clClient.fnRemoveContainer = async (): Promise<void> => {
      throw new Error('remove failed')
    }

    await fnDeleteContainerCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clLogger.LaErrors.join('\n')).to.include('Failed deleting container bad')
  })

  it('should return empty scan results for empty Docker response', async () => {
    // Empty Docker responses should produce an empty candidate list.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([])

    const LaCandidates = await fnScanContainers(clClient as never, new Set(['bench']), LdReport, clLogger as never)

    expect(LaCandidates).to.deep.equal([])
  })
})
