/**
 * Module: Check Command
 *
 * Responsibility:
 * - Register the stack-health check command with oclif.
 * - Delegate read-only validation to the stack-health module.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

/**
 * Command: lensinfra check
 *
 * Purpose:
 * - Validates active Bench stack service availability and container health.
 *
 * Safety:
 * - Read-only command; no Docker or Portainer resources are changed.
 */

import {Command} from '@oclif/core'
import {fnRunHealthCheck} from '../stack-health/index.js'

/**
 * oclif command class for the stack-health check workflow.
 */
export default class clHealthCheckCommand extends Command {
  static description = 'Validate active Bench stack service availability and container health'

  async run(): Promise<void> {
    await fnRunHealthCheck()
  }
}
