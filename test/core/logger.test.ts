import {expect} from 'chai'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import winston from 'winston'

import {fnCreateLogger} from '../../src/logger.js'

function fnWithTempCwd(fnTest: (iTempDir: string) => void): void {
  // Logger tests run in a temp cwd so they do not depend on the developer's logs folder.
  const LOriginalCwd = process.cwd()
  const LTempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lensinfra-logger-'))

  try {
    process.chdir(LTempDir)
    fnTest(LTempDir)
  } finally {
    process.chdir(LOriginalCwd)
    fs.rmSync(LTempDir, {recursive: true, force: true})
  }
}

describe('cleanup logger module', () => {
  it('should create logs directory in the current workspace', () => {
    // The logger should prepare disk logging before any cleanup message is written.
    fnWithTempCwd((LTempDir) => {
      const clLogger = fnCreateLogger()

      expect(fs.existsSync(path.join(LTempDir, 'logs'))).to.equal(true)
      clLogger.close()
    })
  })

  it('should configure console and file transports', () => {
    // Console remains quiet for normal info logs while file logging keeps the full run trace.
    fnWithTempCwd(() => {
      const clLogger = fnCreateLogger()
      const LaTransportNames = clLogger.transports.map((LdTransport) => LdTransport.constructor.name)

      expect(LaTransportNames).to.include('Console')
      expect(LaTransportNames).to.include('File')
      clLogger.close()
    })
  })

  it('should keep the default logger level as info', () => {
    // Info level is needed for detailed cleanup records on disk.
    fnWithTempCwd(() => {
      const clLogger = fnCreateLogger()

      expect(clLogger.level).to.equal('info')
      clLogger.close()
    })
  })

  it('should write cleanup logs using the current date stamp', () => {
    // Log file names are grouped by calendar day for operator review.
    fnWithTempCwd(() => {
      const clLogger = fnCreateLogger()
      const LToday = new Date().toISOString().slice(0, 10)
      const clFileTransport = clLogger.transports.find(
        (LdTransport) => LdTransport instanceof winston.transports.File,
      ) as winston.transports.FileTransportInstance | undefined

      expect(clFileTransport?.filename).to.equal(`cleanup-${LToday}.log`)
      clLogger.close()
    })
  })
})
