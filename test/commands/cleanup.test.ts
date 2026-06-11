import {Config} from '@oclif/core'
import {expect} from 'chai'

import clCleanupCommand, {fnSetCleanupRunnerForTest} from '../../src/commands/cleanup.js'

interface ICleanupRunnerCall {
  dryRun?: boolean
}

interface ICleanupHarness {
  clCommand: clCleanupCommand
  LaParseCalls: unknown[]
  LaRunnerCalls: ICleanupRunnerCall[]
}

async function fnCreateCleanupHarness(iDryRun?: boolean): Promise<ICleanupHarness> {
  const LdConfig = await Config.load()
  const LaParseCalls: unknown[] = []
  const LaRunnerCalls: ICleanupRunnerCall[] = []
  const clCommand = new clCleanupCommand([], LdConfig)

  ;(clCommand as unknown as {parse: (iCommandClass: unknown) => Promise<never>}).parse = async (iCommandClass: unknown) => {
    LaParseCalls.push(iCommandClass)

    return {
      flags: {
        dryRun: iDryRun,
      },
    } as never
  }

  fnSetCleanupRunnerForTest(async (idOptions) => {
    LaRunnerCalls.push(idOptions)
  })

  return {
    clCommand,
    LaParseCalls,
    LaRunnerCalls,
  }
}

describe('clCleanupCommand', () => {
  afterEach(() => {
    fnSetCleanupRunnerForTest()
  })

  it('should expose cleanup command description', () => {
    expect(clCleanupCommand.description).to.equal('Clean containers, volumes, and images in Portainer')
  })

  it('should expose dryRun flag metadata', () => {
    expect(clCleanupCommand.flags.dryRun).to.exist
  })

  it('should describe dryRun flag as scan and preview', () => {
    expect(clCleanupCommand.flags.dryRun.description).to.equal('Scan and preview without deleting')
  })

  it('should keep dryRun flag default false', () => {
    expect(clCleanupCommand.flags.dryRun.default).to.equal(false)
  })

  it('should parse using clCleanupCommand class', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)

    await LdHarness.clCommand.run()

    expect(LdHarness.LaParseCalls[0]).to.equal(clCleanupCommand)
  })

  it('should call cleanup runner once', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)

    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls).to.have.length(1)
  })

  it('should pass dryRun false to cleanup runner', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)

    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls[0]).to.deep.equal({dryRun: false})
  })

  it('should pass dryRun true to cleanup runner', async () => {
    const LdHarness = await fnCreateCleanupHarness(true)

    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls[0]).to.deep.equal({dryRun: true})
  })

  it('should preserve undefined dryRun when parse returns no value', async () => {
    const LdHarness = await fnCreateCleanupHarness()

    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls[0]).to.deep.equal({dryRun: undefined})
  })

  it('should await cleanup runner completion', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)
    const LaEvents: string[] = []

    fnSetCleanupRunnerForTest(async (idOptions) => {
      LaEvents.push('runner-start')
      LdHarness.LaRunnerCalls.push(idOptions)
      await Promise.resolve()
      LaEvents.push('runner-end')
    })

    await LdHarness.clCommand.run()

    expect(LaEvents).to.deep.equal(['runner-start', 'runner-end'])
  })

  it('should propagate cleanup runner errors', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)
    let LErrorMessage = ''

    fnSetCleanupRunnerForTest(async () => {
      throw new Error('cleanup failed')
    })

    try {
      await LdHarness.clCommand.run()
    } catch (idError) {
      LErrorMessage = idError instanceof Error ? idError.message : String(idError)
    }

    expect(LErrorMessage).to.equal('cleanup failed')
  })

  it('should not call cleanup runner before run executes', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)

    expect(LdHarness.LaRunnerCalls).to.have.length(0)
  })

  it('should support repeated cleanup runs', async () => {
    const LdHarness = await fnCreateCleanupHarness(true)

    await LdHarness.clCommand.run()
    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls).to.have.length(2)
  })

  it('should create a fresh options object on each run', async () => {
    const LdHarness = await fnCreateCleanupHarness(true)

    await LdHarness.clCommand.run()
    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls[0]).to.not.equal(LdHarness.LaRunnerCalls[1])
  })

  it('should preserve dryRun value across repeated runs', async () => {
    const LdHarness = await fnCreateCleanupHarness(true)

    await LdHarness.clCommand.run()
    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls.map((LdCall) => LdCall.dryRun)).to.deep.equal([true, true])
  })

  it('should allow test runner override to be replaced', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)
    const LaEvents: string[] = []

    fnSetCleanupRunnerForTest(async () => {
      LaEvents.push('first')
    })

    fnSetCleanupRunnerForTest(async () => {
      LaEvents.push('second')
    })

    await LdHarness.clCommand.run()

    expect(LaEvents).to.deep.equal(['second'])
  })

  it('should reset cleanup runner through default setter', async () => {
    fnSetCleanupRunnerForTest()

    expect(fnSetCleanupRunnerForTest).to.be.a('function')
  })

  it('should return undefined after successful run', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)

    const LResult = await LdHarness.clCommand.run()

    expect(LResult).to.equal(undefined)
  })

  it('should keep argv empty for direct command instance', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)

    expect(LdHarness.clCommand.argv).to.deep.equal([])
  })

  it('should keep command id unset for direct command instance', async () => {
    const LdHarness = await fnCreateCleanupHarness(false)

    expect(LdHarness.clCommand.id).to.equal(undefined)
  })
})
