import { spawn, execFileSync } from 'node:child_process';
import { access, cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { agentForComputer } from '@midscene/computer';
export type DesktopAgent = Awaited<ReturnType<typeof agentForComputer>>;

export async function openCase(id: string, onTeardown: (cleanup: () => Promise<void>) => void, signal: AbortSignal): Promise<DesktopAgent> {
  if (process.platform !== 'darwin') throw new Error('Tinycast E2E requires macOS 26');
  if (process.env.MIDSCENE_DESKTOP_ENABLED !== '1') throw new Error('Set MIDSCENE_DESKTOP_ENABLED=1 on a dedicated test desktop');
  for (const key of ['MIDSCENE_MODEL_API_KEY', 'MIDSCENE_MODEL_NAME', 'MIDSCENE_MODEL_BASE_URL', 'MIDSCENE_MODEL_FAMILY']) {
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  }
  const app = path.resolve(process.env.TINYCAST_APP_PATH ?? '../../build/Build/Products/Debug/Tinycast Dev.app');
  const sourcePlist = path.join(app, 'Contents/Info.plist');
  await access(sourcePlist);
  const executable = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', sourcePlist], { encoding: 'utf8' }).trim();
  if (!executable || path.basename(executable) !== executable) throw new Error('Invalid app executable');
  const out = path.resolve('midscene_run');
  await mkdir(out, { recursive: true });
  const world = `midscene-${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const bundle = `com.tinycast.app.midscene.${world}`;
  const fixtureBundle = `com.tinycast.fixture.${world}`;
  const support = path.join(homedir(), 'Library/Application Support', bundle);
  const work = await mkdtemp(path.join(tmpdir(), 'tinycast-midscene-'));
  const copy = path.join(work, 'Tinycast E2E.app');
  const fixture = path.join(work, 'Applications/E2E Lantern.app');
  const ownerTool = path.join(work, 'owned-application');
  let ownerToolReady = false;
  let child: ReturnType<typeof spawn> | undefined;
  let agent: DesktopAgent | undefined;
  const ownedFixturePids = () => ownerToolReady
    ? JSON.parse(execFileSync(ownerTool, ['inspect', fixtureBundle, fixture], { encoding: 'utf8', timeout: 10_000 })) as number[]
    : [];

  onTeardown(async () => {
    try {
      const publicationErrors: unknown[] = [];
      try {
        await writeFile(path.join(out, `${id}-runtime.json`), JSON.stringify({
          world, bundle, pid: child?.pid, fixtureBundle, fixturePids: ownedFixturePids(),
          support, searchScopes: [path.dirname(fixture)],
        }, null, 2));
      } catch (error) { publicationErrors.push(error); }
      if (agent) {
        try {
          await writeFile(path.join(out, `${id}.png`), Buffer.from((await agent.interface.screenshotBase64()).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
        } catch (error) { publicationErrors.push(error); }
        try {
          await writeFile(path.join(out, `${id}.html`), agent.reportHTMLString({ inlineScreenshots: true }));
        } catch (error) { publicationErrors.push(error); }
      }
      if (publicationErrors.length) throw new AggregateError(publicationErrors, 'Case artifact publication failed');
    } finally {
      await agent?.destroy().catch(() => undefined);
      if (child?.pid && child.exitCode === null) {
        const exited = once(child, 'exit'); child.kill('SIGTERM');
        const timer = setTimeout(() => child?.kill('SIGKILL'), 5000);
        await exited; clearTimeout(timer);
      }
      if (ownerToolReady) execFileSync(ownerTool, ['stop', fixtureBundle, fixture], { timeout: 15_000 });
      await rm(work, { recursive: true, force: true });
      for (const domain of [bundle, fixtureBundle]) {
        for (const folder of ['Application Support', 'Caches', 'WebKit', 'HTTPStorages']) {
          await rm(path.join(homedir(), 'Library', folder, domain), { recursive: true, force: true });
        }
        await rm(path.join(homedir(), 'Library/Saved Application State', `${domain}.savedState`), { recursive: true, force: true });
        try { execFileSync('defaults', ['delete', domain], { stdio: 'ignore' }); } catch {}
      }
      await rm(path.join(homedir(), '.config', `tinycast-midscene.${world}`), { recursive: true, force: true });
    }
  });

  await cp(app, copy, { recursive: true });
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleIdentifier ${bundle}`, path.join(copy, 'Contents/Info.plist')]);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', copy], { stdio: 'pipe' });
  await mkdir(path.join(fixture, 'Contents/MacOS'), { recursive: true });
  await writeFile(path.join(fixture, 'Contents/Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${fixtureBundle}</string><key>CFBundleName</key><string>E2E Lantern</string><key>CFBundleDisplayName</key><string>E2E Lantern</string><key>CFBundleExecutable</key><string>Lantern</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
  execFileSync('xcrun', ['swiftc', '-swift-version', '6', 'fixtures/Lantern.swift', '-o', path.join(fixture, 'Contents/MacOS/Lantern')], { stdio: 'pipe' });
  execFileSync('xcrun', ['swiftc', '-swift-version', '6', 'fixtures/OwnedApplication.swift', '-o', ownerTool], { stdio: 'pipe' });
  ownerToolReady = true;
  execFileSync('codesign', ['--force', '--sign', '-', fixture], { stdio: 'pipe' });
  await mkdir(support, { recursive: true });
  await writeFile(path.join(support, 'onboarded'), '');
  for (const key of ['clipboardEnabled', 'clipboardTextSearchEnabled', 'calendarEnabled', 'snippetsEnabled', 'supportReminders', 'settingsFileEnabled', 'extensionsEnabled', 'appleShortcutsEnabled', 'aiEnabled', 'mcpEnabled', 'fileSearchEnabled', 'showInMenuBar', 'launcherShowsSuggestions']) {
    execFileSync('defaults', ['write', bundle, key, '-bool', 'false']);
  }
  execFileSync('defaults', ['write', bundle, 'launcherSearchScopes', '-array', path.dirname(fixture)]);
  execFileSync('defaults', ['write', bundle, 'appearance', '-string', 'dark']);
  const appEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('MIDSCENE_')));
  child = spawn(path.join(copy, 'Contents/MacOS', executable), ['-AppleLanguages', '(en)', '-AppleLocale', 'en_US'], {
    env: { ...appEnv, TINYCAST_E2E_VISIBLE: '1' }, stdio: 'ignore',
  });
  let launchError: Error | undefined;
  child.on('error', error => { launchError = error; });
  let focused = false;
  const focusDeadline = Date.now() + 30_000;
  while (Date.now() < focusDeadline) {
    if (launchError) throw launchError;
    if (child.exitCode !== null || signal.aborted) throw new Error('Tinycast exited before readiness');
    try {
      const pid = execFileSync('osascript', ['-e', `tell application "System Events"
        tell (first process whose unix id is ${child.pid})
          set frontmost to true
          perform action "AXRaise" of window 1
        end tell
        return unix id of first process whose frontmost is true
      end tell`], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (pid === String(child.pid)) { focused = true; break; }
    } catch {}
    await delay(100);
  }
  if (!focused) throw new Error('Could not bring the owned Tinycast palette to the foreground; use a Debug build with its E2E launch seam');
  agent = await agentForComputer({
    generateReport: true, reportFileName: id, autoPrintReportMsg: false, replanningCycleLimit: 12,
    aiContexts: { default: 'You are testing an isolated Tinycast native macOS launcher palette with English text. Operate only the visible Tinycast palette and its E2E Lantern fixture application. Never use Dock, Spotlight, global hotkeys, external websites, clipboard copy/paste, or any other app. Do not quit or relaunch Tinycast. If the test palette is unavailable, report failure.' },
  });
  return agent;
}
