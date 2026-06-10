/**
 * Module: Stack Health Index
 *
 * Responsibility:
 * - Orchestrate validation, inspection, health ACK, reports, and console output.
 * - Expose stack-health command entrypoints for oclif command files.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

import {Logger} from 'pino'
import {fnLoadConfig, fnMaskKnownSecrets, fnValidateConfig} from './config.js'
import {clDockerGatewayClient} from './docker-gateway-client.js'
import {fnCreateLogger} from './logger.js'
import {clPortainerClient} from './portainer-client.js'
import {fnWriteHealthReport} from './reports/report-writer.js'
import {AppConfig, HealthReport, ReportService, ReportStack} from './types.js'
import {fnResolveEndpoint, ResolvedEndpoint} from './validation/endpoint-validator.js'
import {fnFilterBenchStacks} from './validation/stack-validator.js'
import {fnValidateServicesForStack} from './validation/service-validator.js'

const GsColorReset = '\u001b[0m'
const GsColorGreen = '\u001b[32m'
const GsColorYellow = '\u001b[33m'
const GsColorRed = '\u001b[31m'
const GsColorCyan = '\u001b[36m'
const GsColorBold = '\u001b[1m'


/**
 * Runs the stack-health command entrypoint.
 */
export async function fnRunHealthCheck(): Promise<void> {
  await fnRunSafely(fnRunHealthCheckCore)
}

/**
 * Runs a stack-health action with config validation, logging, and safe error masking.
 */
async function fnRunSafely(iAction: (iConfig: AppConfig, clLogger: Logger) => Promise<void>): Promise<void> {
  const LdConfig = fnLoadConfig()
  const clLogger = fnCreateLogger(LdConfig)

  try {
    const LaFailed = fnValidateConfig(LdConfig)

    if (LaFailed.length > 0) {
      for (const LsMessage of LaFailed) {
        clLogger.error({error: LsMessage}, 'config validation failed')
      }

      throw new Error(`Configuration validation failed:\n- ${LaFailed.join('\n- ')}`)
    }

    clLogger.info(
      {
        LdConfigSnapshot: {
          portainerUrl: LdConfig.portainerUrl,
          portainerAuthMode: LdConfig.portainerAuthMode,
          portainerEndpointId: LdConfig.portainerEndpointId,
          allowSelfSignedCert: LdConfig.allowSelfSignedCert,
          stackNameFilter: LdConfig.stackNameFilter ?? '',
          stackLabelFilter: LdConfig.stackLabelFilter ?? '',
          reportDir: LdConfig.reportDir,
          logDir: LdConfig.logDir,
        },
      },
      'config validation passed',
    )

    await iAction(LdConfig, clLogger)
  } catch (iError) {
    const LsMessage = fnMaskKnownSecrets(iError, LdConfig)

    clLogger.error({error: LsMessage}, 'command failed')
    console.error(LsMessage)

    process.exitCode = 1
  } finally {
    clLogger.flush()
  }
}
/**
 * Runs the stack-health validation workflow after configuration has passed.
 */
async function fnRunHealthCheckCore(iConfig: AppConfig, clLogger: Logger): Promise<void> {
  const LsStartedAt = new Date().toISOString()

  fnPrintStep('Loading configuration', 'OK')

  const clPortainerApiClient = new clPortainerClient(iConfig)

  fnPrintStep('Connecting to Portainer API', '...')

  await clPortainerApiClient.fnPing()

  fnPrintStep('Connecting to Portainer API', 'OK')
  fnPrintStep('Resolving endpoint and Docker gateway', '...')

  const LdEndpoint = await fnResolveEndpoint(iConfig, clPortainerApiClient, clLogger)

  const clDockerGatewayApiClient = new clDockerGatewayClient(iConfig, LdEndpoint.id)

  await clDockerGatewayApiClient.fnVersion()

  fnPrintStep(`Using endpoint ${LdEndpoint.name} (ID: ${LdEndpoint.id})`, 'OK')

  clLogger.info({endpoint: LdEndpoint}, 'health check: scanning started')

  fnPrintStep('Scanning stacks, services, tasks, and containers', '...')

  const [LaStacks, LaServices, LaTasks, LaContainers] = await Promise.all([
    clPortainerApiClient.fnGetStacks(),
    clDockerGatewayApiClient.fnGetServices(),
    clDockerGatewayApiClient.fnGetTasks(),
    clDockerGatewayApiClient.fnGetContainers(),
  ])

  clLogger.info(
    {
      stackCount: LaStacks.length,
      serviceCount: LaServices.length,
      taskCount: LaTasks.length,
      containerCount: LaContainers.length,
    },
    'health check: Docker and Portainer resources fetched',
  )

  const LaCandidates = fnFilterBenchStacks(LaStacks, LaServices, LaContainers, iConfig, LdEndpoint.id)

  fnPrintStep(`Stacks selected for validation: ${LaCandidates.length}`, 'OK')

  const LaResults: ReportStack[] = []

  for (const LdStack of LaCandidates) {
    const LaItems = await fnValidateServicesForStack(
      LdStack.Name,
      LaServices,
      LaTasks,
      LaContainers,
      clDockerGatewayApiClient,
      clLogger,
    )

    const LsStatus = fnClassifyStack(LaItems)

    clLogger.info(
      {
        stackName: LdStack.Name,
        stackStatus: LsStatus,
        serviceCount: LaItems.length,
      },
      'stack scan complete',
    )

    LaResults.push({
      stackName: LdStack.Name,
      status: LsStatus,
      services: LaItems,
    })
  }

  const LdReport = fnBuildReport(LsStartedAt, LdEndpoint, LaResults)
  const LsPath = await fnWriteHealthReport(iConfig.reportDir, LdReport)

  clLogger.info({summary: LdReport.summary, reportPath: LsPath}, 'health check complete')

  fnPrintHealthSummary(LdReport, LsPath)
}

function fnClassifyStack(iServices: ReportService[]): ReportStack['status'] {
  if (iServices.some((iService) => fnIsCriticalService(iService))) {
    return 'critical'
  }

  if (iServices.some((iService) => fnIsWarningService(iService))) {
    return 'warning'
  }

  return 'healthy'
}

function fnIsCriticalService(iService: ReportService): boolean {
  return (
    ['failed', 'unavailable', 'stopped'].includes(iService.status) ||
    iService.migrationStatus === 'failed' ||
    iService.containers.some((iContainer) => {
      if (iContainer.health === 'unhealthy' || iContainer.state === 'dead') {
        return true
      }

      return iContainer.state === 'exited' && iService.status !== 'running' && iService.status !== 'complete'
    })
  )
}

function fnIsWarningService(iService: ReportService): boolean {
  return (
    ['partial', 'ready', 'preparing', 'restarting', 'unknown'].includes(iService.status) ||
    ['running', 'pending', 'unknown'].includes(iService.migrationStatus) ||
    iService.containers.some((iContainer) => iContainer.health === 'starting' || iContainer.state === 'missing')
  )
}

function fnBuildReport(iStartedAt: string, iEndpoint: ResolvedEndpoint, iStacks: ReportStack[]): HealthReport {
  const LaItems = iStacks.flatMap((iStack) => iStack.services)
  const LaContainers = LaItems.flatMap((iService) => iService.containers)

  return {
    startedAt: iStartedAt,
    finishedAt: new Date().toISOString(),
    endpoint: {
      id: iEndpoint.id,
      name: iEndpoint.name,
    },
    summary: {
      totalStacks: iStacks.length,
      healthyStacks: iStacks.filter((iStack) => iStack.status === 'healthy').length,
      warningStacks: iStacks.filter((iStack) => iStack.status === 'warning').length,
      criticalStacks: iStacks.filter((iStack) => iStack.status === 'critical').length,
      totalServices: LaItems.length,
      runningServices: LaItems.filter((iService) => iService.status === 'running').length,
      partialServices: LaItems.filter((iService) => iService.status === 'partial').length,
      readyServices: LaItems.filter((iService) => iService.status === 'ready').length,
      preparingServices: LaItems.filter((iService) => iService.status === 'preparing').length,
      completedServices: LaItems.filter((iService) => iService.status === 'complete').length,
      failedServices: LaItems.filter((iService) => iService.status === 'failed').length,
      unavailableServices: LaItems.filter((iService) => iService.status === 'unavailable').length,
      migrationServices: LaItems.filter((iService) => iService.migrationStatus !== 'not-migration').length,
      completedMigrations: LaItems.filter((iService) => iService.migrationStatus === 'complete').length,
      failedMigrations: LaItems.filter((iService) => iService.migrationStatus === 'failed').length,
      pendingMigrations: LaItems.filter((iService) => ['pending', 'running', 'unknown'].includes(iService.migrationStatus)).length,
      totalContainers: LaContainers.length,
      healthyContainers: LaContainers.filter((iContainer) => iContainer.health === 'healthy').length,
      unhealthyContainers: LaContainers.filter((iContainer) => iContainer.health === 'unhealthy').length,
      unknownHealthContainers: LaContainers.filter((iContainer) => iContainer.health === 'unknown').length,
    },
    stacks: iStacks,
  }
}

function fnPrintHealthSummary(iReport: HealthReport, iReportPath: string): void {
  const LaFailed = fnCollectIssues(iReport)
  const LbSuccess = LaFailed.length === 0 && iReport.summary.criticalStacks === 0 && iReport.summary.warningStacks === 0

  console.log('')
  console.log(fnColor('Bench Stack Health ACK', 'cyan'))
  console.log(fnColor('======================', 'cyan'))
  console.log('')
  console.log(`Endpoint: ${iReport.endpoint.name} (ID: ${iReport.endpoint.id})`)
  console.log(
    `Result: ${
      LbSuccess
        ? fnColor('ALL GOOD - all selected stack services are running and migrations are complete', 'green')
        : fnColor('ATTENTION REQUIRED', 'red')
    }`,
  )

  console.log('')
  fnPrintSectionTitle('Summary')
  fnPrintTable(
    ['Area', 'Good', 'Warn', 'Fail', 'Total'],
    [
      [
        'Stacks',
        fnColorCount(iReport.summary.healthyStacks, 'green'),
        fnColorCount(iReport.summary.warningStacks, 'yellow'),
        fnColorCount(iReport.summary.criticalStacks, 'red'),
        String(iReport.summary.totalStacks),
      ],
      [
        'Services',
        fnColorCount(iReport.summary.runningServices + iReport.summary.completedServices, 'green'),
        fnColorCount(
          iReport.summary.readyServices + iReport.summary.preparingServices + iReport.summary.partialServices,
          'yellow',
        ),
        fnColorCount(iReport.summary.failedServices + iReport.summary.unavailableServices, 'red'),
        String(iReport.summary.totalServices),
      ],
      [
        'Migrations',
        fnColor(`${iReport.summary.completedMigrations} complete`, 'green'),
        fnColorCount(iReport.summary.pendingMigrations, 'yellow'),
        fnColorCount(iReport.summary.failedMigrations, 'red'),
        String(iReport.summary.migrationServices),
      ],
      [
        'Containers',
        fnColorCount(iReport.summary.totalContainers - iReport.summary.unhealthyContainers, 'green'),
        fnColor('unknown: ' + String(iReport.summary.unknownHealthContainers), 'yellow'),
        fnColorCount(iReport.summary.unhealthyContainers, 'red'),
        String(iReport.summary.totalContainers),
      ],
    ],
  )

  fnPrintStackDetails(iReport)

  console.log('')
  fnPrintSectionTitle('Issues')

  if (LaFailed.length === 0) {
    console.log(`${fnBadge('healthy')} No failed, unavailable, ready, preparing, unhealthy, or incomplete migration items found.`)
  } else {
    for (const LsMessage of LaFailed) {
      console.log(fnColorIssueLine(LsMessage))
    }
  }

  fnPrintFinalSummary(iReport, LaFailed, LbSuccess)

  console.log('')
  console.log(fnColor('Report:', 'cyan'))
  console.log(fnColor(iReportPath, 'cyan'))
}

function fnCollectIssues(iReport: HealthReport): string[] {
  const LaFailed: string[] = []

  for (const LdStack of iReport.stacks) {
    for (const LdService of LdStack.services) {
      if (LdService.status !== 'running' && LdService.status !== 'complete') {
        LaFailed.push(
          `[${fnIssueLevel(LdService)}] ${LdStack.stackName} / ${LdService.serviceName}: ${LdService.status}, ${LdService.runningReplicas}/${LdService.desiredReplicas} replicas running`,
        )
      }

      if (LdService.migrationStatus !== 'not-migration' && LdService.migrationStatus !== 'complete') {
        LaFailed.push(
          `[${LdService.migrationStatus === 'failed' ? 'FAIL' : 'WARN'}] ${LdStack.stackName} / ${
            LdService.serviceName
          }: migration ${LdService.migrationStatus}`,
        )
      }

      for (const LdContainer of LdService.containers) {
        if (
          LdContainer.health === 'unhealthy' ||
          ['dead', 'restarting', 'missing'].includes(LdContainer.state) ||
          (LdContainer.state === 'exited' && LdService.status !== 'running' && LdService.status !== 'complete')
        ) {
          const LsMessage = LdContainer.health === 'unhealthy' || ['exited', 'dead'].includes(LdContainer.state)
            ? 'FAIL'
            : 'WARN'

          LaFailed.push(
            `[${LsMessage}] ${LdStack.stackName} / ${LdContainer.containerName}: ${LdContainer.state}${
              LdContainer.health !== 'unknown' ? `, ${LdContainer.health}` : ''
            }`,
          )
        }
      }
    }
  }

  return LaFailed
}

function fnPrintStackDetails(iReport: HealthReport): void {
  console.log('')
  fnPrintSectionTitle('Stack Results')

  if (iReport.stacks.length === 0) {
    console.log(`${fnBadge('warning')} No stacks matched the current filters.`)
    return
  }

  const LaItems = iReport.stacks.map((iStack) => {
    const LdResult = fnStackServiceCounts(iStack)

    return [
      fnBadge(iStack.status),
      iStack.stackName,
      String(iStack.services.length),
      String(LdResult.LnRunning),
      String(LdResult.LnComplete),
      String(LdResult.LnWarning),
      String(LdResult.LnFailed),
      `${LdResult.LnMigrationComplete}/${LdResult.LnMigrationTotal}`,
    ]
  })

  fnPrintTable(['State', 'Stack', 'Services', 'Running', 'Done', 'Warn', 'Fail', 'Migrations'], LaItems)

  console.log('')
  fnPrintSectionTitle('Service Results')

  for (const LdStack of iReport.stacks) {
    console.log('')
    console.log(`${fnBadge(LdStack.status)} ${fnColorByStackStatus(LdStack.stackName, LdStack.status)}`)

    if (LdStack.services.length === 0) {
      console.log(`  ${fnBadge('warning')} no services found for this stack`)
      continue
    }

    const LaResults = LdStack.services.map((iService) => [
      fnBadge(iService.status),
      iService.serviceName,
      fnStatusText(iService),
      iService.status === 'complete' ? 'n/a' : `${iService.runningReplicas}/${iService.desiredReplicas}`,
      fnMigrationText(iService),
      fnServiceNotesText(iService),
    ])

    fnPrintTable(['State', 'Service', 'Status', 'Replicas', 'Migration', 'Notes'], LaResults)
  }
}

function fnStackServiceCounts(iStack: ReportStack): {
  LnRunning: number
  LnComplete: number
  LnWarning: number
  LnFailed: number
  LnMigrationComplete: number
  LnMigrationTotal: number
} {
  const LnRunning = iStack.services.filter((iService) => iService.status === 'running').length
  const LnComplete = iStack.services.filter((iService) => iService.status === 'complete').length
  const LnWarning = iStack.services.filter((iService) =>
    ['partial', 'ready', 'preparing', 'restarting', 'unknown'].includes(iService.status),
  ).length
  const LnFailed = iStack.services.filter((iService) =>
    ['failed', 'unavailable', 'stopped'].includes(iService.status),
  ).length
  const LnMigrationComplete = iStack.services.filter((iService) => iService.migrationStatus === 'complete').length
  const LnMigrationTotal = iStack.services.filter((iService) => iService.migrationStatus !== 'not-migration').length

  return {LnRunning, LnComplete, LnWarning, LnFailed, LnMigrationComplete, LnMigrationTotal}
}

function fnStatusText(iService: ReportService): string {
  if (iService.status === 'complete') return fnColor('complete', 'green')
  if (iService.status === 'running') return fnColor('running', 'green')
  if (['failed', 'unavailable', 'stopped'].includes(iService.status)) return fnColor(iService.status, 'red')

  return fnColor(iService.status, 'yellow')
}

function fnMigrationText(iService: ReportService): string {
  if (iService.migrationStatus === 'not-migration') return '-'
  if (iService.migrationStatus === 'complete') return fnColor('complete', 'green')
  if (iService.migrationStatus === 'failed') return fnColor('failed', 'red')

  return fnColor(iService.migrationStatus, 'yellow')
}

function fnServiceNotesText(iService: ReportService): string {
  if (iService.status === 'running') return fnColor('current OK', 'green')
  if (iService.status === 'complete') return fnColor('completed', 'green')
  if (iService.notes.length === 0) return '-'

  return iService.notes
    .map((iMessage) => iMessage.replace(`${iService.serviceName} is failed`, 'migration failed'))
    .map((iMessage) => iMessage.replace(`${iService.serviceName} is complete`, 'migration complete'))
    .map((iMessage) => iMessage.replace('task history only, current service is OK: ', 'history: '))
    .map((iMessage) => iMessage.replace('migration check: ', ''))
    .map((iMessage) => iMessage.replace(' replicas running', ' replicas'))
    .join('; ')
}

function fnPrintFinalSummary(iReport: HealthReport, iIssues: string[], iSuccess: boolean): void {
  console.log('')
  fnPrintSectionTitle('Final Summary')

  if (iSuccess) {
    console.log(fnColor('All selected stacks are OK.', 'green'))
    console.log(
      fnColor(
        `${iReport.summary.runningServices} services are running and ${iReport.summary.completedServices} one-time services are complete.`,
        'green',
      ),
    )
    console.log(fnColor(`Migrations are complete: ${iReport.summary.completedMigrations}/${iReport.summary.migrationServices}.`, 'green'))
    console.log(fnColor('No current failed, preparing, ready, unavailable, or unhealthy items need action.', 'green'))
    return
  }

  console.log(fnColor('Action is needed before this environment can be considered fully healthy.', 'red'))
  console.log(`Current issue count: ${fnColorCount(iIssues.length, 'red')}.`)
  console.log(
    `Warnings: ${fnColorCount(iReport.summary.warningStacks, 'yellow')} stack(s). Critical: ${fnColorCount(
      iReport.summary.criticalStacks,
      'red',
    )} stack(s).`,
  )
  console.log('Check the Issues section above first, then open the JSON report for full details.')
}

function fnPrintTable(iHeaders: string[], iRows: string[][]): void {
  const LaItems = [iHeaders, ...iRows]
  const LaResults = iHeaders.map((iHeader, iIndex) =>
    Math.max(...LaItems.map((iRow) => fnVisibleLength(iRow[iIndex] ?? ''))),
  )

  const fnFormatRow = (iRow: string[]): string =>
    `| ${iRow.map((iCell, iIndex) => fnPadRight(iCell, LaResults[iIndex])).join(' | ')} |`

  const LsName = fnFormatRow(iHeaders)
  const LsMessage = `| ${LaResults.map((iWidth) => '-'.repeat(iWidth)).join(' | ')} |`

  console.log(LsName)
  console.log(LsMessage)

  for (const LaCandidates of iRows) {
    console.log(fnFormatRow(LaCandidates))
  }
}

function fnPadRight(iMessage: string, iWidth: number): string {
  const LnCount = fnVisibleLength(iMessage)

  return iMessage + ' '.repeat(Math.max(0, iWidth - LnCount))
}

function fnPrintSectionTitle(iMessage: string): void {
  console.log(fnColor(iMessage, 'cyan', true))
  console.log(fnColor('-'.repeat(fnVisibleLength(iMessage)), 'cyan'))
}

function fnColorByStackStatus(iMessage: string, iStatus: ReportStack['status']): string {
  if (iStatus === 'healthy') return fnColor(iMessage, 'green')
  if (iStatus === 'critical') return fnColor(iMessage, 'red')

  return fnColor(iMessage, 'yellow')
}

function fnColorCount(iCount: number, iColor: 'green' | 'yellow' | 'red' | 'cyan'): string {
  return fnColor(String(iCount), iColor)
}

function fnColorIssueLine(iMessage: string): string {
  if (iMessage.startsWith('[FAIL]')) return fnColor(iMessage, 'red')
  if (iMessage.startsWith('[WARN]')) return fnColor(iMessage, 'yellow')

  return fnColor(iMessage, 'green')
}

function fnColor(iMessage: string, iColor: 'green' | 'yellow' | 'red' | 'cyan', iBold = false): string {
  const LsColor = iColor === 'green'
    ? GsColorGreen
    : iColor === 'yellow'
      ? GsColorYellow
      : iColor === 'red'
        ? GsColorRed
        : GsColorCyan

  const LsMessage = iBold ? GsColorBold : ''

  return `${LsMessage}${LsColor}${iMessage}${GsColorReset}`
}

function fnVisibleLength(iMessage: string): number {
  return iMessage.replace(/\u001b\[[0-9;]*m/g, '').length
}

function fnBadge(iStatus: ReportStack['status'] | ReportService['status']): string {
  if (iStatus === 'healthy' || iStatus === 'running' || iStatus === 'complete') return fnColor('[OK]', 'green')

  if (iStatus === 'critical' || iStatus === 'failed' || iStatus === 'unavailable' || iStatus === 'stopped') {
    return fnColor('[FAIL]', 'red')
  }

  return fnColor('[WARN]', 'yellow')
}

function fnIssueLevel(iService: ReportService): 'FAIL' | 'WARN' {
  return ['failed', 'unavailable', 'stopped'].includes(iService.status) ? 'FAIL' : 'WARN'
}

function fnPrintStep(iMessage: string, iStatus: 'OK' | '...' | 'WARN'): void {
  const LsStatus = iStatus === 'OK' ? fnColor('[OK]', 'green') : iStatus === 'WARN' ? fnColor('[WARN]', 'yellow') : fnColor('[...]', 'yellow')

  console.log(`${LsStatus} ${iMessage}`)
}
