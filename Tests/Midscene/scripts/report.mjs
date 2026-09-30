import { mkdir, readdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collect } from './collect.mjs';
const escape = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
export async function assemble({ directory, baseUrl, summary, merge }) {
  await mkdir(directory, { recursive: true });
  // Remove only generated merge output; original case artifacts always survive.
  const native = path.join(directory, 'native');
  await rm(native, { recursive: true, force: true });
  await rm(`${native}.html`, { force: true });
  const results = new Map();
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) await walk(file);
      else if (e.name === 'results.json') {
        for (const r of JSON.parse(await readFile(file, 'utf8'))) {
          if (results.has(r.id)) throw new Error(`Duplicate case result: ${r.id}`);
          results.set(r.id, { ...r, dir });
        }
      }
    }
  }
  await walk(directory);
  const cases = await collect();
  let complete = results.size === cases.length;
  const htmlPaths = [];
  const url = file => `${baseUrl.replace(/\/$/, '')}/${path.relative(directory, file).split(path.sep).map(encodeURIComponent).join('/')}`;
  async function artifact(r, key) {
    if (!r?.[key] || !/^[a-z0-9-]+\.(html|png)$/.test(r[key])) return null;
    const file = path.join(r.dir, r[key]);
    try { await access(file); return file; } catch { return null; }
  }
  const lines = ['| Case | Result | Screenshot | Native report |', '| --- | --- | --- | --- |'];
  for (const c of cases) {
    const r = results.get(c.id);
    const report = await artifact(r, 'report');
    const screenshot = await artifact(r, 'screenshot');
    if (report) htmlPaths.push(report);
    if (r?.status !== 'passed' || !report || !screenshot) complete = false;
    lines.push(`| ${escape(c.title)} | ${r ? escape(r.status) : 'missing'} | ${screenshot && baseUrl ? `[![screenshot](${url(screenshot)})](${url(screenshot)})` : 'unavailable'} | ${report ? (baseUrl ? `[${c.id}](${url(report)})` : `\`${path.relative(directory, report)}\``) : 'unavailable'} |`);
  }
  let merged;
  try {
    if (!htmlPaths.length) throw new Error('No native HTML reports');
    merged = await merge({ htmlPaths, outputDir: directory, outputName: 'native', overwrite: true });
    await access(merged.mergedReportPath);
  } catch (error) {
    merged = undefined;
    complete = false;
    await rm(native, { recursive: true, force: true });
    await rm(`${native}.html`, { force: true });
    lines.unshift(`Native report merge failed: ${escape(error)}. Individual reports remain available.`, '');
  }
  if (merged && baseUrl) lines.unshift(`[Combined native report](${url(merged.mergedReportPath)})`, '');
  if (!baseUrl) lines.unshift('Download the report artifact to view the native HTML reports and PNG screenshots. Configure MIDSCENE_PAGES_URL and enable Pages publishing for inline images and exact hosted links.', '');
  if (!complete) lines.unshift('Run incomplete or failed; see individual reports and shard job logs.', '');
  await writeFile(summary, `${lines.join('\n')}\n`);
  return complete;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { mergeReportFiles } = await import('@midscene/core');
  const ok = await assemble({ directory: path.resolve(process.argv[2] ?? 'midscene_run'), baseUrl: process.env.MIDSCENE_REPORT_URL ?? '', summary: process.env.GITHUB_STEP_SUMMARY ?? 'summary.md', merge: mergeReportFiles });
  if (!ok) process.exitCode = 1;
}
