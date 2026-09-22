const { execFile, execFileSync } = require('node:child_process');
const { mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');

process.env.MIDSCENE_MODEL_NAME = 'unused-ci-model';
process.env.MIDSCENE_MODEL_API_KEY = 'unused-ci-key';
process.env.MIDSCENE_MODEL_BASE_URL = 'http://127.0.0.1:1/v1';
process.env.MIDSCENE_MODEL_FAMILY = 'qwen3-vl';
process.env.MIDSCENE_MODEL_RETRY_COUNT = '0';
process.env.MIDSCENE_REPORT_QUIET = 'true';

const { ComputerAgent, ComputerDevice, checkComputerEnvironment } = require('@midscene/computer');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function focusedField(helper, bundleID) {
  const output = execFileSync(helper, ['focused-field', bundleID], { encoding: 'utf8' });
  return JSON.parse(output);
}

async function waitForFocusedField(helper, bundleID, predicate, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    try {
      last = focusedField(helper, bundleID);
      if (predicate(last)) return last;
    } catch (error) {
      last = { error: String(error) };
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for focused field: ${JSON.stringify(last)}`);
}

function labelOf(field) {
  return [field.description, field.title, field.placeholder, ...(field.screenText || [])]
    .filter(Boolean)
    .join(' | ');
}

function screenshotBuffer(dataURL) {
  const match = /^data:image\/\w+;base64,(.+)$/s.exec(dataURL);
  if (!match) throw new Error('Screenshot is not a base64 data URL');
  return Buffer.from(match[1], 'base64');
}

async function main() {
  const appPath = required('APP_PATH');
  const bundleID = required('APP_BUNDLE_ID');
  const label = required('EVIDENCE_LABEL');
  const expectedPlaceholder = required('EXPECTED_PLACEHOLDER');
  const helper = required('IME_CI_HELPER');
  const outputDir = path.resolve(required('EVIDENCE_OUTPUT_DIR'));
  const reportFileName = `ime-backspace-${label}`;
  const summary = { label, appPath, bundleID, expectedPlaceholder };
  let device;
  let agent;

  await mkdir(outputDir, { recursive: true });
  try {
    summary.environment = await checkComputerEnvironment();
    if (!summary.environment.available) {
      throw new Error(`Midscene desktop is unavailable: ${JSON.stringify(summary.environment)}`);
    }

    execFile('/usr/bin/open', ['-n', '-F', appPath], (error) => {
      if (error) process.stderr.write(`open failed: ${error}\n`);
    });
    await sleep(4_000);

    device = new ComputerDevice({ keyboardTypeDelay: 120 });
    await device.connect();
    agent = new ComputerAgent(device, {
      groupName: `Tinycast IME Backspace ${label}`,
      groupDescription: 'Chinese Pinyin composition should retain Backspace in AI Chat',
      reportFileName,
      autoPrintReportMsg: false,
      generateReport: true,
      waitAfterAction: 500,
    });

    await agent.callActionInActionSpace('KeyboardPress', { keyName: 'F12' });
    const launcher = await waitForFocusedField(
      helper,
      bundleID,
      (field) => labelOf(field).includes('Search for apps and commands'),
    );
    summary.launcher = launcher;

    await agent.callActionInActionSpace('KeyboardPress', { keyName: 'Tab' });
    const chat = await waitForFocusedField(
      helper,
      bundleID,
      (field) => labelOf(field).includes('Ask anything'),
    );
    summary.chatBeforeComposition = chat;

    await agent.callActionInActionSpace('Input', { value: 'nihao', mode: 'typeOnly' });
    await sleep(500);
    summary.composing = focusedField(helper, bundleID);

    await agent.callActionInActionSpace('KeyboardPress', { keyName: 'Backspace' });
    const result = await waitForFocusedField(
      helper,
      bundleID,
      (field) => labelOf(field).includes(expectedPlaceholder),
    );
    summary.afterBackspace = result;
    summary.observedPlaceholder = labelOf(result);

    const screenshot = await device.screenshotBase64();
    await writeFile(path.join(outputDir, 'after-backspace.png'), screenshotBuffer(screenshot));
    summary.modelCalls = agent.metrics.calls;
    if (summary.modelCalls !== 0) {
      throw new Error(`Expected deterministic Midscene actions, got ${summary.modelCalls} model calls`);
    }
  } catch (error) {
    summary.error = error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
    throw error;
  } finally {
    if (agent) await agent.destroy().catch((error) => { summary.destroyError = String(error); });
    else if (device) await device.destroy().catch((error) => { summary.destroyError = String(error); });
    await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
