import {expect} from 'chai'
import inquirer from 'inquirer'

import {GdPortainerCleanupTestApi} from '../../src/portainer-cleanup.js'
import {ICandidate, ICleanupReport, IDockerContainer} from '../../src/types.js'

type TPrompt = typeof inquirer.prompt

const fnOriginalPrompt = inquirer.prompt.bind(inquirer)

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

function fnCandidate(iId: string): ICandidate<IDockerContainer> {
  return {
    resource: {
      Id: iId,
      State: 'exited',
    },
    record: {
      id: iId,
      name: iId,
    },
  }
}

function fnInstallPromptStub(iConfirmation: string): void {
  // Prompt stubbing lets us test confirmation planning without interactive input.
  ;(inquirer as unknown as {prompt: TPrompt}).prompt = (async () => ({
    LConfirmation: iConfirmation,
  })) as unknown as TPrompt
}

describe('portainer cleanup helper module', () => {
  afterEach(() => {
    ;(inquirer as unknown as {prompt: TPrompt}).prompt = fnOriginalPrompt
  })

  it('should clip long values for console tables', () => {
    // Long table cells are shortened so terminal output remains readable.
    const LText = GdPortainerCleanupTestApi.fnClip('abcdefghijklmnopqrstuvwxyz', 10)

    expect(LText).to.equal('abcdefg...')
  })

  it('should render empty table values as dash', () => {
    // Empty fields should be visible instead of disappearing in console tables.
    const LText = GdPortainerCleanupTestApi.fnClip(undefined, 10)

    expect(LText).to.equal('-')
  })

  it('should format byte values as human-readable units', () => {
    // Image tables use compact byte formatting for operator scanning.
    expect(GdPortainerCleanupTestApi.fnFormatBytes(1536)).to.equal('1.5 KB')
  })

  it('should render missing byte values as dash', () => {
    // Missing Docker size values should not show misleading zero-byte text.
    expect(GdPortainerCleanupTestApi.fnFormatBytes()).to.equal('-')
  })

  it('should treat undefined stack status as active', () => {
    // Older Portainer versions can omit status, so undefined remains accepted.
    const LbActive = GdPortainerCleanupTestApi.fnIsStackActive({Id: 1, Name: 'bench'})

    expect(LbActive).to.equal(true)
  })

  it('should treat numeric active stack status as active', () => {
    // Current Portainer responses use status 1 for active stacks.
    const LbActive = GdPortainerCleanupTestApi.fnIsStackActive({Id: 1, Name: 'bench', Status: 1})

    expect(LbActive).to.equal(true)
  })

  it('should treat inactive stack status as inactive', () => {
    // Non-active stacks are excluded from active-stack cleanup matching.
    const LbActive = GdPortainerCleanupTestApi.fnIsStackActive({Id: 1, Name: 'bench', Status: 2})

    expect(LbActive).to.equal(false)
  })

  it('should parse comma separated skip indexes', () => {
    // User skip input is 1-based and comma-separated in the cleanup prompt.
    const LaIndexes = GdPortainerCleanupTestApi.fnParseIndexList('1, 3, 2', 3)

    expect(LaIndexes).to.deep.equal([1, 3, 2])
  })

  it('should remove duplicate skip indexes while preserving order', () => {
    // Duplicate indexes should not duplicate skipped records.
    const LaIndexes = GdPortainerCleanupTestApi.fnParseIndexList('2,2,1', 3)

    expect(LaIndexes).to.deep.equal([2, 1])
  })

  it('should reject skip indexes outside the candidate range', () => {
    // Out-of-range input should be rejected before deletion confirmation.
    expect(() => GdPortainerCleanupTestApi.fnParseIndexList('4', 3)).to.throw(
      'Use comma-separated indexes between 1 and 3',
    )
  })

  it('should add skipped candidates to the matching report section', () => {
    // Dry-run and user-skip decisions are persisted in the same report shape.
    const LdReport = fnCreateReport()

    GdPortainerCleanupTestApi.fnSkipCandidates(LdReport, 'containers', [fnCandidate('container-1')], 'dry-run')

    expect(LdReport.containers.skipped).to.deep.equal([
      {id: 'container-1', name: 'container-1', reason: 'dry-run'},
    ])
  })

  it('should return all candidates when under max delete count', async () => {
    // Normal deletion planning should not ask for DEL ALL when the selected count is within the limit.
    const LaCandidates = [fnCandidate('one'), fnCandidate('two')]

    const LdPlan = await GdPortainerCleanupTestApi.fnPlanLimitedDeletion('containers', LaCandidates, 2)

    expect(LdPlan.LaLimited).to.deep.equal(LaCandidates)
    expect(LdPlan.LaOverflow).to.deep.equal([])
    expect(LdPlan.LDeleteOverflow).to.equal(false)
  })

  it('should split overflow candidates when DEL ALL is not confirmed', async () => {
    // Only the first MAX_DELETE_COUNT resources should proceed without DEL ALL.
    fnInstallPromptStub('NO')
    const LaCandidates = [fnCandidate('one'), fnCandidate('two'), fnCandidate('three')]

    const LdPlan = await GdPortainerCleanupTestApi.fnPlanLimitedDeletion('containers', LaCandidates, 2)

    expect(LdPlan.LaLimited.map((LdCandidate) => LdCandidate.record.id)).to.deep.equal(['one', 'two'])
    expect(LdPlan.LaOverflow.map((LdCandidate) => LdCandidate.record.id)).to.deep.equal(['three'])
    expect(LdPlan.LDeleteOverflow).to.equal(false)
  })

  it('should allow overflow candidates when DEL ALL is confirmed', async () => {
    // DEL ALL is the explicit confirmation path for deleting beyond MAX_DELETE_COUNT.
    fnInstallPromptStub('DEL ALL')
    const LaCandidates = [fnCandidate('one'), fnCandidate('two'), fnCandidate('three')]

    const LdPlan = await GdPortainerCleanupTestApi.fnPlanLimitedDeletion('volumes', LaCandidates, 2)

    expect(LdPlan.LaOverflow).to.have.length(1)
    expect(LdPlan.LDeleteOverflow).to.equal(true)
  })

  it('should create summary rows from report sections', () => {
    // Final summary rows are derived from report section counts only.
    const LdReport = fnCreateReport()
    LdReport.images.candidates.push({id: 'image-1'})
    LdReport.images.deleted.push({id: 'image-1'})
    LdReport.images.failed.push({id: 'image-2'})

    const LdSummary = GdPortainerCleanupTestApi.fnSummaryRow('images', LdReport.images)

    expect(LdSummary).to.deep.equal({
      resource: 'images',
      candidates: 1,
      deleted: 1,
      skipped: 0,
      failed: 1,
    })
  })
})
