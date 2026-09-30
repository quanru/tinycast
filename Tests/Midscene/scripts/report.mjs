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
  const cases = await collect();
  const knownArtifacts = new Set(cases.flatMap(c => [`${c.id}.html`, `${c.id}.png`]));
  const candidates = new Map();
  const warnings = [];
  const results = new Map();
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory() && e.name !== 'framework') await walk(file);
      else if (e.name === 'results.json') {
        for (const r of JSON.parse(await readFile(file, 'utf8'))) {
          if (results.has(r.id)) throw new Error(`Duplicate case result: ${r.id}`);
          results.set(r.id, { ...r, dir });
        }
      } else if (e.isFile() && knownArtifacts.has(e.name)) {
        candidates.set(e.name, [...(candidates.get(e.name) ?? []), file]);
      }
    }
  }
  await walk(directory);
  let complete = results.size === cases.length;
  const htmlPaths = [];
  const url = file => `${baseUrl.replace(/\/$/, '')}/${path.relative(directory, file).split(path.sep).map(encodeURIComponent).join('/')}`;
  function artifact(id, extension) {
    const files = candidates.get(`${id}.${extension}`) ?? [];
    if (files.length > 1) {
      warnings.push(`Ambiguous ${id}.${extension}: ${files.map(file => path.relative(directory, file)).join(', ')}. Files are retained; no report was selected.`);
      return null;
    }
    return files[0] ?? null;
  }
  const lines = ['| Case | Result | Screenshot | Native report |', '| --- | --- | --- | --- |'];
  for (const c of cases) {
    const r = results.get(c.id);
    const report = artifact(c.id, 'html');
    const screenshot = artifact(c.id, 'png');
    if (report) htmlPaths.push(report);
    if (r?.status !== 'passed' || !report || !screenshot) complete = false;
    lines.push(`| ${escape(c.title)} | ${r ? escape(r.status) : 'missing'} | ${screenshot && baseUrl ? `[![screenshot](${url(screenshot)})](${url(screenshot)})` : 'unavailable'} | ${report ? (baseUrl ? `[${c.id}](${url(report)})` : `\`${path.relative(directory, report)}\``) : 'unavailable'} |`);
  }
  if (warnings.length) lines.unshift(...warnings.map(escape), '');
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
