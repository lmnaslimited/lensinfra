import {Config} from '@oclif/core'
import {expect} from 'chai'

import clHealthCheckCommand, {fnSetHealthCheckRunnerForTest} from '../../src/commands/check.js'

interface ICheckHarness {
  clCommand: clHealthCheckCommand
  LaRunnerCalls: string[]
}

async function fnCreateCheckHarness(): Promise<ICheckHarness> {
  const LdConfig = await Config.load()
  const LaRunnerCalls: string[] = []
  const clCommand = new clHealthCheckCommand([], LdConfig)

  fnSetHealthCheckRunnerForTest(async () => {
    LaRunnerCalls.push('run')
  })

  return {
    clCommand,
    LaRunnerCalls,
  }
}

describe('clHealthCheckCommand', () => {
  afterEach(() => {
    fnSetHealthCheckRunnerForTest()
  })

  it('should expose check command description', () => {
    expect(clHealthCheckCommand.description).to.equal('Validate active Bench stack service availability and container health')
  })

  it('should not define command flags', () => {
    expect(clHealthCheckCommand.flags).to.equal(undefined)
  })

  it('should call health check runner once', async () => {
    const LdHarness = await fnCreateCheckHarness()

    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls).to.deep.equal(['run'])
  })

  it('should not call runner before run executes', async () => {
    const LdHarness = await fnCreateCheckHarness()

    expect(LdHarness.LaRunnerCalls).to.deep.equal([])
  })

  it('should await health check runner completion', async () => {
    const LdHarness = await fnCreateCheckHarness()
    const LaEvents: string[] = []

    fnSetHealthCheckRunnerForTest(async () => {
      LaEvents.push('runner-start')
      await Promise.resolve()
      LaEvents.push('runner-end')
    })

    await LdHarness.clCommand.run()

    expect(LaEvents).to.deep.equal(['runner-start', 'runner-end'])
  })

  it('should propagate health check runner errors', async () => {
    const LdHarness = await fnCreateCheckHarness()
    let LErrorMessage = ''

    fnSetHealthCheckRunnerForTest(async () => {
      throw new Error('health check failed')
    })

    try {
      await LdHarness.clCommand.run()
    } catch (idError) {
      LErrorMessage = idError instanceof Error ? idError.message : String(idError)
    }

    expect(LErrorMessage).to.equal('health check failed')
  })

  it('should support repeated health check runs', async () => {
    const LdHarness = await fnCreateCheckHarness()

    await LdHarness.clCommand.run()
    await LdHarness.clCommand.run()

    expect(LdHarness.LaRunnerCalls).to.deep.equal(['run', 'run'])
  })

  it('should return undefined after successful run', async () => {
    const LdHarness = await fnCreateCheckHarness()

    const LResult = await LdHarness.clCommand.run()

    expect(LResult).to.equal(undefined)
  })

  it('should allow test runner override to be replaced', async () => {
    const LdHarness = await fnCreateCheckHarness()
    const LaEvents: string[] = []

    fnSetHealthCheckRunnerForTest(async () => {
      LaEvents.push('first')
    })

    fnSetHealthCheckRunnerForTest(async () => {
      LaEvents.push('second')
    })

    await LdHarness.clCommand.run()

    expect(LaEvents).to.deep.equal(['second'])
  })

  it('should reset health check runner through default setter', () => {
    fnSetHealthCheckRunnerForTest()

    expect(fnSetHealthCheckRunnerForTest).to.be.a('function')
  })

  it('should keep argv empty for direct command instance', async () => {
    const LdHarness = await fnCreateCheckHarness()

    expect(LdHarness.clCommand.argv).to.deep.equal([])
  })

  it('should keep command id unset for direct command instance', async () => {
    const LdHarness = await fnCreateCheckHarness()

    expect(LdHarness.clCommand.id).to.equal(undefined)
  })

  it('should expose command config on instance', async () => {
    const LdHarness = await fnCreateCheckHarness()

    expect(LdHarness.clCommand.config).to.exist
  })

  it('should use the same config object passed to constructor', async () => {
    const LdConfig = await Config.load()
    const clCommand = new clHealthCheckCommand([], LdConfig)

    expect(clCommand.config).to.equal(LdConfig)
  })

  it('should not require parse for check command', async () => {
    const LdHarness = await fnCreateCheckHarness()
    let LParseCalled = false

    ;(LdHarness.clCommand as unknown as {parse: () => Promise<never>}).parse = async () => {
      LParseCalled = true
      return {} as never
    }

    await LdHarness.clCommand.run()

    expect(LParseCalled).to.equal(false)
  })

  it('should call runner after run starts', async () => {
    const LdHarness = await fnCreateCheckHarness()
    const LaEvents: string[] = ['before-run']

    fnSetHealthCheckRunnerForTest(async () => {
      LaEvents.push('runner')
    })

    await LdHarness.clCommand.run()
    LaEvents.push('after-run')

    expect(LaEvents).to.deep.equal(['before-run', 'runner', 'after-run'])
  })

  it('should preserve custom runner error messages', async () => {
    const LdHarness = await fnCreateCheckHarness()
    let LErrorMessage = ''

    fnSetHealthCheckRunnerForTest(async () => {
      throw new Error('custom health failure')
    })

    try {
      await LdHarness.clCommand.run()
    } catch (idError) {
      LErrorMessage = idError instanceof Error ? idError.message : String(idError)
    }

    expect(LErrorMessage).to.equal('custom health failure')
  })

  it('should not write to process exit code on successful wrapper run', async () => {
    const LdHarness = await fnCreateCheckHarness()
    const LOriginalExitCode = process.exitCode

    await LdHarness.clCommand.run()

    expect(process.exitCode).to.equal(LOriginalExitCode)
  })

  it('should preserve runner side effects', async () => {
    const LdHarness = await fnCreateCheckHarness()
    const LdState = {
      completed: false,
    }

    fnSetHealthCheckRunnerForTest(async () => {
      LdState.completed = true
    })

    await LdHarness.clCommand.run()

    expect(LdState.completed).to.equal(true)
  })

  it('should run without command arguments', async () => {
    const LdHarness = await fnCreateCheckHarness()

    await LdHarness.clCommand.run()

    expect(LdHarness.clCommand.argv).to.deep.equal([])
  })
})
