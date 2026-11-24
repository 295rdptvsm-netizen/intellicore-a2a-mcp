#!/usr/bin/env node
// Print a free trial key. Run: node examples/trial-key.mjs
import { IntelliCoreA2A } from '../sdk/node/intellicore-a2a.js';

const trial = await IntelliCoreA2A.trial({ agent: 'trial-key-example' });
process.stdout.write(`${trial.key}\n`);
console.error(`credits ${trial.credits} · expires ${trial.expires_at} · plan ${trial.plan}`);
console.error('export INTELLICORE_A2A_KEY=' + trial.key);
