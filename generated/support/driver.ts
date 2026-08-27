/**
 * Runtime bridge for generated POM tests.
 * It will NOT be overwritten by `testpilot pom` — edit it freely.
 *
 * The platform below is only a default: TESTPILOT_PLATFORM wins when set, so
 * one scaffold serves every platform without being edited.
 *
 *   TESTPILOT_PLATFORM=android TESTPILOT_DEVICE=sm-s918b \
 *     node --import tsx/esm --test generated/tests/*.spec.ts
 *
 * TESTPILOT_DEVICE names an entry of <platform>.devices, and is required once
 * the config lists more than one — same rule as the runner's --device.
 *
 * Accounts come from the same place the runner reads them — testpilot.config.json
 * plus the gitignored secrets file — so no credential is needed in the environment.
 * TESTPILOT_ENV selects which environment's accounts and build apply.
 */

import { createPomPageContext } from '../../src/pom/context.js';

export function createPageContext() {
  return createPomPageContext({ defaultPlatform: 'android' });
}
