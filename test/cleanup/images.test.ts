import {expect} from 'chai'

import {
  fnDeleteImageCandidates,
  fnGetUsedImageIds,
  fnIsDanglingImage,
  fnScanImages,
} from '../../src/cleanup/images.js'
import {
  IAppConfig,
  ICandidate,
  ICleanupReport,
  IDockerContainer,
  IDockerImage,
} from '../../src/types.js'

interface IImageClientStub {
  LaRemovedIds: string[]
  fnGetContainers: (iAll?: boolean) => Promise<IDockerContainer[]>
  fnGetImages: () => Promise<IDockerImage[]>
  fnRemoveImage: (iImageId: string) => Promise<void>
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

function fnCreateConfig(iMode: IAppConfig['imageCleanupMode'] = 'unused'): IAppConfig {
  return {
    portainerUrl: 'http://portainer.test',
    patToken: 'token',
    endpointId: '1',
    tlsVerify: true,
    imageCleanupMode: iMode,
    volumeCleanupMode: 'all-unused',
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

function fnImage(idOverrides: Partial<IDockerImage> = {}): IDockerImage {
  return {
    Id: 'sha256:abcdef1234567890',
    RepoTags: ['bench:latest'],
    Created: 1,
    Size: 1024,
    Labels: {},
    ...idOverrides,
  }
}

function fnCreateClient(iaImages: IDockerImage[], iaContainers: IDockerContainer[]): IImageClientStub {
  return {
    LaRemovedIds: [],
    async fnGetContainers(iAll = false): Promise<IDockerContainer[]> {
      expect(iAll).to.equal(true)

      return iaContainers
    },
    async fnGetImages(): Promise<IDockerImage[]> {
      return iaImages
    },
    async fnRemoveImage(iImageId: string): Promise<void> {
      this.LaRemovedIds.push(iImageId)
    },
  }
}

describe('cleanup images module', () => {
  it('should collect normalized image IDs used by containers', async () => {
    // Used-image collection strips sha256 prefixes for safe comparisons.
    const clClient = fnCreateClient([], [
      {Id: 'container-1', ImageID: 'sha256:used-image'},
    ])

    const LaUsedImageIds = await fnGetUsedImageIds(clClient as never)

    expect([...LaUsedImageIds]).to.deep.equal(['used-image'])
  })

  it('should ignore containers without image IDs', async () => {
    // Missing ImageID values should not create invalid used-image entries.
    const clClient = fnCreateClient([], [{Id: 'container-1'}])

    const LaUsedImageIds = await fnGetUsedImageIds(clClient as never)

    expect(LaUsedImageIds.size).to.equal(0)
  })

  it('should detect images with no repo tags as dangling', () => {
    // Docker can report dangling images with an empty RepoTags list.
    expect(fnIsDanglingImage(fnImage({RepoTags: []}))).to.equal(true)
  })

  it('should detect none-tagged images as dangling', () => {
    // Docker can also report dangling images as <none>:<none>.
    expect(fnIsDanglingImage(fnImage({RepoTags: ['<none>:<none>']}))).to.equal(true)
  })

  it('should not mark tagged images as dangling', () => {
    // Normal tagged images should not be treated as dangling.
    expect(fnIsDanglingImage(fnImage({RepoTags: ['bench:latest']}))).to.equal(false)
  })

  it('should scan unused images in unused mode', async () => {
    // Unused mode accepts any image not referenced by containers.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnImage()], [])

    const LaCandidates = await fnScanImages(clClient as never, fnCreateConfig('unused'), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(1)
    expect(LdReport.images.candidates).to.have.length(1)
  })

  it('should skip images used by containers', async () => {
    // In-use images must never become deletion candidates.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const LdImage = fnImage({Id: 'sha256:used-image'})
    const clClient = fnCreateClient([LdImage], [{Id: 'container-1', ImageID: 'sha256:used-image'}])

    const LaCandidates = await fnScanImages(clClient as never, fnCreateConfig('unused'), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
    expect(clLogger.LaInfos.join('\n')).to.include('image is used by at least one container')
  })

  it('should scan dangling images in dangling mode', async () => {
    // Dangling mode only accepts images with no usable tag.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnImage({RepoTags: ['<none>:<none>']})], [])

    const LaCandidates = await fnScanImages(clClient as never, fnCreateConfig('dangling'), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(1)
  })

  it('should skip tagged images in dangling mode', async () => {
    // Tagged images are skipped when the operator chooses dangling-only cleanup.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnImage({RepoTags: ['bench:latest']})], [])

    const LaCandidates = await fnScanImages(clClient as never, fnCreateConfig('dangling'), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
  })

  it('should skip images with protected labels', async () => {
    // Protected labels prevent accidental removal of important images.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnImage({Labels: {keep: 'true'}})], [])

    const LaCandidates = await fnScanImages(clClient as never, fnCreateConfig('unused'), LdReport, clLogger as never)

    expect(LaCandidates).to.have.length(0)
  })

  it('should create readable image report records', async () => {
    // Report rows should include short IDs, tags, size, and reason.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([fnImage()], [])

    await fnScanImages(clClient as never, fnCreateConfig('unused'), LdReport, clLogger as never)

    expect(LdReport.images.candidates[0].id).to.equal('abcdef123456')
    expect(LdReport.images.candidates[0].repoTags).to.equal('bench:latest')
  })

  it('should delete confirmed image candidates', async () => {
    // Deletion should call Docker once for every confirmed image candidate.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([], [])
    const LaCandidates: ICandidate<IDockerImage>[] = [
      {resource: fnImage({Id: 'image-a'}), record: {id: 'image-a'}},
    ]

    await fnDeleteImageCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clClient.LaRemovedIds).to.deep.equal(['image-a'])
    expect(LdReport.images.deleted).to.have.length(1)
  })

  it('should record failed image deletions', async () => {
    // Delete failures should be stored in the report for operator review.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([], [])
    const LaCandidates: ICandidate<IDockerImage>[] = [
      {resource: fnImage({Id: 'bad-image'}), record: {id: 'bad-image'}},
    ]

    clClient.fnRemoveImage = async (): Promise<void> => {
      throw new Error('image delete failed')
    }

    await fnDeleteImageCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(LdReport.images.failed[0].error).to.equal('image delete failed')
  })

  it('should continue deleting images after one failure', async () => {
    // A failure on one image should not stop later image deletes.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([], [])
    const LaCandidates: ICandidate<IDockerImage>[] = [
      {resource: fnImage({Id: 'bad-image'}), record: {id: 'bad-image'}},
      {resource: fnImage({Id: 'good-image'}), record: {id: 'good-image'}},
    ]

    clClient.fnRemoveImage = async (iImageId: string): Promise<void> => {
      if (iImageId === 'bad-image') {
        throw new Error('image delete failed')
      }

      clClient.LaRemovedIds.push(iImageId)
    }

    await fnDeleteImageCandidates(clClient as never, LaCandidates, LdReport, clLogger as never)

    expect(clClient.LaRemovedIds).to.deep.equal(['good-image'])
  })

  it('should return empty scan results for empty image response', async () => {
    // Empty Docker image lists should produce no candidates.
    const LdReport = fnCreateReport()
    const clLogger = fnCreateLogger()
    const clClient = fnCreateClient([], [])

    const LaCandidates = await fnScanImages(clClient as never, fnCreateConfig(), LdReport, clLogger as never)

    expect(LaCandidates).to.deep.equal([])
  })
})
