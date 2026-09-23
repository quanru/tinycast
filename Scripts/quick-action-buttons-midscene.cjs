const { execFile, execFileSync } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

for (const name of ['MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_API_KEY']) {
  if (!process.env[name]) throw new Error(`${name} is required: this evidence run must use aiAct`);
}
process.env.MIDSCENE_MODEL_RETRY_COUNT = '0';
process.env.MIDSCENE_REPORT_QUIET = 'true';

const { ComputerAgent, ComputerDevice, checkComputerEnvironment } = require('@midscene/computer');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const translatedText = 'Bonjour from Tinycast';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function screenshotBuffer(dataURL) {
  const match = /^data:image\/\w+;base64,(.+)$/s.exec(dataURL);
  if (!match) throw new Error('Screenshot is not a base64 data URL');
  return Buffer.from(match[1], 'base64');
}

function windowCount(helper, bundleID) {
  return Number(execFileSync(helper, ['visible-window-count', bundleID], { encoding: 'utf8' }).trim());
}

function windowBounds(helper, bundleID) {
  const output = execFileSync(helper, ['window-bounds', bundleID], { encoding: 'utf8' }).trim();
  const bounds = JSON.parse(output);
  if (!bounds) throw new Error('Tinycast result panel has no visible window bounds');
  return bounds;
}

function defaultValue(bundleID, key) {
  try {
    return execFileSync('/usr/bin/defaults', ['read', bundleID, key], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function deleteDefault(bundleID, key) {
  try {
    execFileSync('/usr/bin/defaults', ['delete', bundleID, key], { stdio: 'ignore' });
  } catch {}
}

async function waitForWindowCount(helper, bundleID, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let count = 0;
  while (Date.now() < deadline) {
    count = windowCount(helper, bundleID);
    if (predicate(count)) return count;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for Tinycast window count; last count: ${count}`);
}

async function waitForDefault(bundleID, key, expected, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (defaultValue(bundleID, key) === expected) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${key} to become ${expected}`);
}

function stopApp(processName) {
  try {
    execFileSync('/usr/bin/killall', [processName], { stdio: 'ignore' });
  } catch {}
}

async function launchPanel(appPath, helper, bundleID) {
  execFile('/usr/bin/open', ['-n', '-F', appPath], (error) => {
    if (error) process.stderr.write(`open failed: ${error}\n`);
  });
  await waitForWindowCount(helper, bundleID, (count) => count > 0);
  await waitForDefault(bundleID, 'quickActionButtonsCIReady', '1');
  await sleep(250);
}

async function restartPanel(appPath, processName, helper, bundleID) {
  stopApp(processName);
  await waitForWindowCount(helper, bundleID, (count) => count === 0);
  deleteDefault(bundleID, 'quickActionButtonsCIReady');
  await launchPanel(appPath, helper, bundleID);
}

function buttonPoint(bounds, button) {
  // Exercise the pill's padding rather than its Text child: movable-window hit testing differs there.
  const rightInset = { Copy: 146, Replace: 84, Dismiss: 222 }[button];
  return [bounds.x + bounds.width - rightInset, bounds.y + bounds.height - 29];
}

async function saveScreenshot(device, outputDir, name) {
  const screenshot = await device.screenshotBase64();
  await writeFile(path.join(outputDir, `${name}.png`), screenshotBuffer(screenshot));
}

async function main() {
  const appPath = required('APP_PATH');
  const bundleID = required('APP_BUNDLE_ID');
  const processName = required('APP_PROCESS_NAME');
  const helper = required('BUTTONS_CI_HELPER');
  const label = required('EVIDENCE_LABEL');
  const expectedWorkingValue = required('EXPECTED_WORKING');
  const expectedWorking = expectedWorkingValue === 'observe'
    ? null
    : expectedWorkingValue === 'true';
  const outputDir = path.resolve(required('EVIDENCE_OUTPUT_DIR'));
  const replaceMarkerKey = 'quickActionButtonsCIReplacedText';
  const dismissMarkerKey = 'quickActionButtonsCIDismissed';
  const summary = {
    label,
    expectedWorking,
    interactionMode: 'aiAct clicks with geometry fallback + deterministic outcome checks',
    scenario: 'Translation result panel Copy, Replace, and Dismiss buttons',
    observations: {},
  };
  let device;
  let agent;

  await mkdir(outputDir, { recursive: true });
  try {
    summary.environment = await checkComputerEnvironment();
    if (!summary.environment.available) {
      throw new Error(`Midscene desktop is unavailable: ${JSON.stringify(summary.environment)}`);
    }

    device = new ComputerDevice({ inputStrategy: 'sequential' });
    await device.connect();
    agent = new ComputerAgent(device, {
      groupName: `Tinycast quick action buttons ${label}`,
      groupDescription: 'Translation result buttons should respond to pointer clicks',
      reportFileName: `quick-action-buttons-${label}`,
      autoPrintReportMsg: false,
      generateReport: true,
      waitAfterAction: 500,
    });

    const cases = [
      {
        name: 'copy',
        button: 'Copy',
        reset: () => execFileSync('/usr/bin/pbcopy', [], { input: 'clipboard sentinel' }),
        worked: () => execFileSync('/usr/bin/pbpaste', [], { encoding: 'utf8' }) === translatedText,
      },
      {
        name: 'replace',
        button: 'Replace',
        reset: () => deleteDefault(bundleID, replaceMarkerKey),
        worked: () => defaultValue(bundleID, replaceMarkerKey) === translatedText,
      },
      {
        name: 'dismiss',
        button: 'Dismiss',
        reset: () => deleteDefault(bundleID, dismissMarkerKey),
        worked: () => defaultValue(bundleID, dismissMarkerKey) === '1',
      },
    ];

    for (const testCase of cases) {
      testCase.reset();
      await restartPanel(appPath, processName, helper, bundleID);
      await saveScreenshot(device, outputDir, `${testCase.name}-before`);
      await agent.aiAct(
        `Click the ${testCase.button} button in the Tinycast Translate result panel exactly once.`,
      );
      await sleep(750);
      const aiActWorked = testCase.worked();
      let fallbackUsed = false;
      if (!aiActWorked) {
        fallbackUsed = true;
        if (windowCount(helper, bundleID) === 0) {
          await restartPanel(appPath, processName, helper, bundleID);
        }
        const point = buttonPoint(windowBounds(helper, bundleID), testCase.button);
        await agent.callActionInActionSpace('Tap', {
          locate: {
            prompt: `${testCase.button} button in the Tinycast Translate result panel`,
            locatedPixelResult: { center: point },
          },
        });
        await sleep(750);
      }
      summary.observations[testCase.name] = {
        worked: testCase.worked(),
        aiActWorked,
        fallbackUsed,
        panelWindowCount: windowCount(helper, bundleID),
      };
      await saveScreenshot(device, outputDir, `${testCase.name}-after`);
    }

    const actual = Object.fromEntries(
      Object.entries(summary.observations).map(([name, observation]) => [name, observation.worked]),
    );
    summary.modelCalls = agent.metrics.calls;
    const unexpected = expectedWorking === null
      ? []
      : Object.entries(actual).filter(([, worked]) => worked !== expectedWorking);
    if (unexpected.length) {
      throw new Error(
        `Unexpected button outcomes: ${JSON.stringify(actual)}, expected each to be ${expectedWorking}`,
      );
    }
    if (summary.modelCalls < 3) {
      throw new Error(`Expected at least three aiAct model calls, got ${summary.modelCalls}`);
    }
  } catch (error) {
    summary.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
    if (device) {
      try {
        await saveScreenshot(device, outputDir, 'failure');
      } catch (screenshotError) {
        summary.screenshotError = String(screenshotError);
      }
    }
    throw error;
  } finally {
    stopApp(processName);
    if (agent) await agent.destroy().catch((error) => { summary.destroyError = String(error); });
    else if (device) await device.destroy().catch((error) => { summary.destroyError = String(error); });
    await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
