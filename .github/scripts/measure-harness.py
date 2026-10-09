import json, os, pathlib, platform, re, subprocess, time
out = pathlib.Path('measurements'); out.mkdir()
env = dict(os.environ)
env['TINYCAST_TEST_JOBS'] = '4'
env['TINYCAST_TEST_TIMEOUT'] = '300'
work = pathlib.Path(env['RUNNER_TEMP']) / 'harness-measurement'
work.mkdir(); env['TMPDIR'] = str(work) + '/'
def command(*args):
    return subprocess.check_output(args, text=True).strip()
metadata = {'variant': env['VARIANT'], 'trial': int(env['TRIAL']),
    'sha': command('git', '-C', 'source', 'rev-parse', 'HEAD'),
    'runner_image': env.get('ImageVersion'), 'os': platform.platform(),
    'cpu': command('sysctl', '-n', 'machdep.cpu.brand_string'),
    'cores': command('sysctl', '-n', 'hw.ncpu'),
    'memory_bytes': command('sysctl', '-n', 'hw.memsize'),
    'xcode': command('xcodebuild', '-version'), 'swift': command('swiftc', '--version'),
    'node': command('node', '--version'), 'jobs': 4, 'harness_timeout_seconds': 300}
start = time.monotonic()
with (out / 'suite.log').open('w') as log:
    process = subprocess.Popen(['./Scripts/run-tests.sh'], cwd='source', env=env,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for line in process.stdout:
        print(line, end='', flush=True); log.write(line); log.flush()
    code = process.wait()
metadata.update(exit_code=code, wall_seconds=round(time.monotonic()-start, 3))
plain = re.sub(r'\x1b\[[0-9;]*m', '', (out / 'suite.log').read_text())
metadata['suite_summary'] = [l for l in plain.splitlines() if re.search(r'(PASSED|FAILED).*harness', l)]
metadata['harness_results'] = [l for l in plain.splitlines() if re.match(r'\[\s*\d+/\d+\]', l)]
(out / 'result.json').write_text(json.dumps(metadata, indent=2)+'\n')
with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
    summary.write(f"## {metadata['variant']} trial {metadata['trial']}\n\n")
    summary.write(f"Commit `{metadata['sha']}`; wall time **{metadata['wall_seconds']}s**; suite exit code **{code}**.\n\n")
    summary.write('\n'.join(metadata['suite_summary'])+'\n\nRaw logs and per-harness timings are in the artifact. Measurement completion does not mean the measured suite passed.\n')
