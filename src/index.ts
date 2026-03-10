import * as core from '@actions/core';

import { runAction } from './action.js';

runAction().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  core.setFailed(message);
});
