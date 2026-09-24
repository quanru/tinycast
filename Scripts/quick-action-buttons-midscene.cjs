const { execFile, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { mkdir, readFile, writeFile } = require('node:fs/promises');
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
  const buffer = screenshotBuffer(screenshot);
  await writeFile(path.join(outputDir, `${name}.png`), buffer);
  return createHash('sha256').update(buffer).digest('hex');
}

async function saveWindowScreenshot(helper, bundleID, outputDir, name) {
  const bounds = windowBounds(helper, bundleID);
  const outputPath = path.join(outputDir, `${name}.png`);
  execFileSync('/usr/sbin/screencapture', ['-x', '-l', String(bounds.id), outputPath]);
  const buffer = await readFile(outputPath);
  return {
    base64: `data:image/png;base64,${buffer.toString('base64')}`,
    hash: createHash('sha256').update(buffer).digest('hex'),
  };
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
    interactionMode: 'aiAct hover with deterministic hover and held-mouse fallback',
    scenario: 'Translation result buttons should visually distinguish hover from mouse-down',
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
      groupDescription: 'Translation result buttons should visibly distinguish hover and press',
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
      let point = buttonPoint(windowBounds(helper, bundleID), testCase.button);
      await agent.aiAct(
        `Move the pointer over the ${testCase.button} button without clicking it.`,
      );
      // aiAct is intentionally exercised, but an imprecise model action must not
      // make the pixel-level evidence flaky by accidentally activating the button.
      if (windowCount(helper, bundleID) === 0) {
        await restartPanel(appPath, processName, helper, bundleID);
      }
      point = buttonPoint(windowBounds(helper, bundleID), testCase.button);
      await agent.callActionInActionSpace('Hover', {
        locate: {
          prompt: `${testCase.button} button in the Tinycast Translate result panel`,
          locatedPixelResult: { center: point },
        },
      });
      await sleep(500);
      await saveScreenshot(device, outputDir, `${testCase.name}-hover-desktop`);
      const hoverFrame = await saveWindowScreenshot(
        helper, bundleID, outputDir, `${testCase.name}-hover`);
      const reportFrames = [{
        base64: hoverFrame.base64,
        description: `${testCase.button}: hover state before mouse-down`,
      }];
      const pressedFrames = [];
      const observer = await agent.startObserving({
        intervalMs: 200,
        maxFrames: 12,
        watchdogMs: 10_000,
      });
      let observation;
      try {
        execFileSync(helper, ['mouse-down', bundleID, String(point[0]), String(point[1])]);
        for (let frameIndex = 1; frameIndex <= 5; frameIndex += 1) {
          await sleep(120);
          const frame = await saveWindowScreenshot(
            helper,
            bundleID,
            outputDir,
            `${testCase.name}-pressed-${frameIndex}`,
          );
          pressedFrames.push(frame);
          reportFrames.push({
            base64: frame.base64,
            description: `${testCase.button}: held mouse-down frame ${frameIndex}/5`,
          });
        }
      } finally {
        execFileSync(helper, ['mouse-up', bundleID, String(point[0]), String(point[1])]);
        observation = await observer.stop();
      }
      await sleep(500);
      let observationInsight;
      let observationInsightError;
      try {
        observationInsight = await observation.aiAsk(
          `Describe whether the ${testCase.button} button visibly changes from hover to a distinct pressed appearance during this sequence.`,
        );
      } catch (error) {
        observationInsightError = error instanceof Error ? error.message : String(error);
      } finally {
        await observation.dispose();
      }
      await agent.recordToReport(`${testCase.button} hover and held-press frames`, {
        content:
          'Window-only captures sampled throughout mouse-down; use the report timeline to compare frames.',
        screenshots: reportFrames,
      });
      const pressedHashes = pressedFrames.map((frame) => frame.hash);
      summary.observations[testCase.name] = {
        worked: testCase.worked(),
        hoverHash: hoverFrame.hash,
        pressedHashes,
        hoverAndPressedAreIdentical: pressedHashes.every(
          (pressedHash) => pressedHash === hoverFrame.hash),
        observedFrameCount: observation.frameCount,
        observationInsight,
        observationInsightError,
        panelWindowCount: windowCount(helper, bundleID),
      };
      await saveScreenshot(device, outputDir, `${testCase.name}-released`);
    }

    summary.modelCalls = agent.metrics.calls;
    const unexpected = expectedWorking === null ? [] : Object.entries(summary.observations)
      .filter(([, observation]) => observation.hoverAndPressedAreIdentical === expectedWorking);
    if (unexpected.length) {
      throw new Error(
        `Unexpected visual feedback outcomes: ${JSON.stringify(summary.observations)}`,
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
