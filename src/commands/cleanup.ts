/**
 * Module: Cleanup Command
 *
 * Responsibility:
 * - Register the cleanup command with oclif.
 * - Delegate cleanup orchestration to the cleanup module.
 *
 * Notes:
 * - Part of LENSINFRA oclif CLI.
 * - Do not change runtime behavior.
 */

/**
 * Command: lensinfra cleanup
 *
 * Purpose:
 * - Cleans confirmed containers, volumes, and images in Portainer.
 *
 * Safety:
 * - Supports dry-run preview and requires cleanup confirmation before deletion.
 */

import {Command, Flags} from '@oclif/core'
import {fnRunCleanup} from '../portainer-cleanup.js'

/**
 * oclif command class for the cleanup workflow.
 */
export default class clCleanupCommand extends Command {
  static description = 'Clean containers, volumes, and images in Portainer'

  static flags = {
    dryRun: Flags.boolean({
      description: 'Scan and preview without deleting',
      default: false,
    }),
  }

  async run(): Promise<void> {
    const {flags} = await this.parse(clCleanupCommand)

    await fnRunCleanup({
      dryRun: flags.dryRun,
    })
  }
}
