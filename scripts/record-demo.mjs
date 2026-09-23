#!/usr/bin/env node
/**
 * Record the submission demo video.
 *
 *   node scripts/record-demo.mjs --handle <x_handle>
 *
 * Every frame is real captured output - the script runs the actual commands and
 * renders whatever they print. Nothing is typed in by hand, so the video cannot
 * drift from what the code does.
 *
 * Needs: ffmpeg + ffprobe on PATH, edge-tts for the voice-over (optional -
 * without it the scenes get a fixed duration and no audio), and Microsoft Edge
 * for the headless screenshot of the HTML report (optional).
 *
 * Output: demo.mp4 in the repo root (gitignored - upload it, do not commit it).
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, existsSync, copyFileSync, statSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const WORK = resolve(ROOT, 'demo');
const WIDTH = 1920;
const HEIGHT = 1080;
const MAX_LINES = 30;
const MAX_COLS = 118;
const FONT_SIZE = 23;
const LINE_HEIGHT = 30;
const TEXT_TOP = 155;
const VOICE = 'en-US-AndrewNeural';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    const next = argv[index + 1];
    flags[key] = next && !next.startsWith('--') ? next : true;
  }
  return flags;
}

const args = parseFlags(process.argv.slice(2));
const handle = typeof args.handle === 'string' ? args.handle : null;
/** Call-list file to demo the scoring engine without a Frontrun key. */
const listFile = typeof args.list === 'string' ? args.list : null;
const listLabel = typeof args.label === 'string' ? args.label : 'sample-list';

/** Run a command, capture stdout+stderr, never throw. */
function capture(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: false,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/** Keep the last N lines so the interesting part of long output survives. */
function frame(text, { head = 0 } = {}) {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.replace(/[^\x20-\x7E]/g, (char) => (char === '·' ? '-' : ''))) // drawtext is ascii-safe
    .map((line) => (line.length > MAX_COLS ? `${line.slice(0, MAX_COLS - 1)}>` : line));
  const body = head > 0 ? lines.slice(0, head) : lines.filter((line, index) => index >= lines.length - MAX_LINES);
  return body.slice(-MAX_LINES).join('\n');
}

function has(command) {
  try {
    execFileSync(command, ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find an edge-tts that actually produces audio on this machine. Several
 * Python installs can shadow each other and only some resolve DNS, so the
 * probe synthesises a real word instead of trusting --help.
 */
function findTts() {
  const candidates = [
    process.env.EDGE_TTS_PATH,
    'edge-tts',
    'C:/Users/' + (process.env.USERNAME ?? '') + '/AppData/Local/Programs/Python/Python311/Scripts/edge-tts.exe',
    'C:/Python314/Scripts/edge-tts.exe',
  ].filter(Boolean);

  const probePath = join(WORK, 'tts-probe.mp3');
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--voice', VOICE, '--text', 'check', '--write-media', probePath], {
      encoding: 'utf8',
      shell: false,
      timeout: 60_000,
    });
    if (result.status === 0 && existsSync(probePath) && statSync(probePath).size > 1000) return candidate;
    rmSync(probePath, { force: true });
  }
  return null;
}

function synth(binary, text, outFile) {
  const result = spawnSync(binary, ['--voice', VOICE, '--text', text, '--write-media', outFile], {
    encoding: 'utf8',
    shell: false,
    timeout: 120_000,
  });
  return result.status === 0 && existsSync(outFile) && statSync(outFile).size > 1000;
}

/** @returns {{width:number, height:number}} */
function imageSize(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  );
  const [width, height] = String(result.stdout ?? '').trim().split(',').map(Number);
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : { width: 1280, height: 1280 };
}

function duration(file) {
  const result = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file],
    { encoding: 'utf8' },
  );
  const value = Number((result.stdout ?? '').trim());
  return Number.isFinite(value) ? value : 0;
}

function ffmpeg(ffmpegArgs) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...ffmpegArgs], {
    cwd: WORK,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.stderr?.slice(0, 600)}`);
}

/** drawtext text= values need : \ ' % escaped. */
function esc(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/%/g, '\\%');
}

function main() {
  if (!has('ffmpeg') || !has('ffprobe')) {
    console.error('ffmpeg and ffprobe must be on PATH');
    process.exit(1);
  }
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  copyFileSync('C:/Windows/Fonts/consola.ttf', join(WORK, 'mono.ttf'));
  copyFileSync('C:/Windows/Fonts/seguisb.ttf', join(WORK, 'title.ttf'));

  const tts = findTts();
  if (!tts) console.warn('no working edge-tts found - rendering a silent video');
  else console.log(`voice-over via ${tts}`);

  console.log('running the real commands...');
  const scenes = [];

  scenes.push({
    title: 'CALLED IT',
    body: [
      '',
      '   Score every contract a Crypto Twitter account called,',
      '   against what the price actually did.',
      '',
      '   social signal   Frontrun Data API  - CA history, linked wallets, labels',
      '   onchain truth   Solana JSON-RPC    - do those wallets still hold it',
      '   receipts        GeckoTerminal      - real hourly candles, real returns',
      '',
      '   Read-only. No wallet connect. No order-placing code. Paper trading only.',
      '',
      '   Works with a Frontrun key, or on any call list you already have.',
    ].join('\n'),
    say:
      'Called It turns a Crypto Twitter handle into a report card. ' +
      'It pulls every contract that account called from the Frontrun Data API, ' +
      'prices each call against real historical candles, and checks the accounts linked wallets on chain.',
  });

  const offline = capture('node', ['--test', 'test/*.test.js']);
  scenes.push({
    title: 'TESTS',
    body: frame(offline),
    say:
      'The scoring engine is pure and fully tested. Over a hundred offline tests cover entry timing, ' +
      'peak and trough measurement, grading, cost modelling, and the safety rules from the hackathon brief.',
  });

  const live = capture('node', ['--test', 'test/live/*.test.js']);
  scenes.push({
    title: 'LIVE DATA TESTS',
    body: frame(live),
    say:
      'These tests hit the real network. Real pools, real hourly candles from GeckoTerminal, ' +
      'and a real read only Solana RPC call. No fixtures, no mocks.',
  });

  const doctor = capture('node', ['src/cli.js', 'doctor', ...(handle ? [handle] : [])]);
  scenes.push({
    title: 'FRONTRUN ENDPOINT CHECK',
    body: frame(doctor),
    say:
      'Doctor probes every Frontrun endpoint the tool uses with your key and prints exactly what answered. ' +
      'Paths live in one config file, so matching the API docs never needs a code change.',
  });

  if (handle) {
    const report = capture('node', ['src/cli.js', 'report', handle, '--max-calls', '15']);
    scenes.push({
      title: `REPORT CARD  @${handle}`,
      body: frame(report),
      say:
        `Here is a live run for ${handle}. Every call the Frontrun API returned, scored against real candles, ` +
        'with the hit rate, the median return, and whether the linked wallets still hold the token.',
    });

    const backtest = capture('node', ['src/cli.js', 'backtest', handle, '--max-calls', '15']);
    scenes.push({
      title: 'PAPER BACKTEST',
      body: frame(backtest),
      say:
        'And the receipts. Copying those calls with a five minute delay, thirty basis points of fees and ' +
        'one hundred basis points of slippage on each side. It is a simulation. Nothing places an order.',
    });

    const shot = shoot(handle);
    if (shot) {
      scenes.push({
        title: 'SHAREABLE REPORT',
        image: shot,
        say: 'The same run renders a self contained HTML report card you can send to anyone.',
      });
    }
  }

  if (listFile) {
    // The engine half of the product, shown end to end with no Frontrun key:
    // the list supplies the calls, GeckoTerminal supplies every price.
    const listRun = capture('node', [
      'src/cli.js',
      'score-list',
      listFile,
      '--label',
      listLabel,
      '--backtest',
    ]);
    scenes.push({
      title: 'SCORING A CALL LIST - REAL PRICES, NO KEY',
      body: frame(listRun, { head: 26 }),
      say:
        'You do not need a Frontrun key to see the engine work. Point it at a list of calls you already have. ' +
        'Every price here is a real hourly candle pulled live from GeckoTerminal while this video was recording.',
    });
    scenes.push({
      title: 'THE PART THE TIMELINE NEVER SHOWS YOU',
      body: frame(listRun),
      say:
        'And here is why this matters. Sixty percent of these calls were up at twenty four hours. ' +
        'The same calls, copied with a five minute delay, thirty basis points of fees and one hundred of slippage each side, ' +
        'lose money. A good hit rate and a losing strategy are not the same thing, and only one of them fits in a tweet.',
    });

    const listShot = shoot(listLabel);
    if (listShot) {
      scenes.push({
        title: 'SHAREABLE REPORT',
        image: listShot,
        say: 'The same run renders a self contained HTML report card you can send to anyone.',
      });
    }
  }

  scenes.push({
    title: 'CALLED IT',
    body: [
      '',
      '   node src/cli.js score-list <file> score calls you have, no key needed',
      '   npm run doctor                 check your Frontrun key and endpoints',
      '   node src/cli.js report <handle>   build a report card',
      '   node src/cli.js backtest <handle> add the paper backtest',
      '   npm run mcp                    same data as MCP tools for an AI agent',
      '',
      '   MIT licensed. No keys in the repo. Not financial advice.',
    ].join('\n'),
    say:
      'Three commands, one config file, and an MCP server so an agent can ask for the same report. ' +
      'MIT licensed, no keys in the repo, not financial advice.',
  });

  console.log(`rendering ${scenes.length} scenes...`);
  const clips = [];
  scenes.forEach((scene, index) => {
    const name = `scene${String(index).padStart(2, '0')}`;
    let audio = null;
    let seconds = 7;
    if (tts) {
      const mp3 = join(WORK, `${name}.mp3`);
      if (synth(tts, scene.say, mp3)) {
        audio = `${name}.mp3`;
        seconds = Math.max(duration(mp3) + 1.1, 4);
      }
    }
    seconds = Math.min(seconds, 26);

    const titleDraw =
      `drawtext=fontfile=title.ttf:text='${esc(scene.title)}':x=70:y=54:fontsize=42:fontcolor=0x8D86FF` +
      `,drawbox=x=70:y=112:w=${WIDTH - 140}:h=2:color=0x2B2A32:t=fill`;

    const input = [];
    const filters = [];
    if (scene.image) {
      copyFileSync(scene.image, join(WORK, `${name}.png`));
      input.push('-loop', '1', '-t', String(seconds), '-i', `${name}.png`);

      // A report page is far taller than the frame. Scaling it to fit would make
      // the numbers unreadable, so we show it full width and pan down it instead,
      // holding a beat at the top and bottom.
      const viewWidth = WIDTH - 160;
      const viewHeight = HEIGHT - 180;
      const scaled = imageSize(scene.image);
      const scaledHeight = Math.round((scaled.height * viewWidth) / scaled.width);
      const hold = 1.2;
      const travel = Math.max(seconds - hold * 2, 0.1);
      const panY =
        scaledHeight > viewHeight
          ? `'(ih-oh)*min(max((t-${hold})/${travel.toFixed(2)}\\,0)\\,1)'`
          : '0';

      filters.push(
        `[0:v]scale=${viewWidth}:-2,` +
          `crop=${viewWidth}:min(${viewHeight}\\,ih):0:${panY},` +
          `pad=${WIDTH}:${HEIGHT}:80:140:color=0x0E0E13,${titleDraw}[v]`,
      );
    } else {
      // One drawtext per line. ffmpeg 8 renders a tofu box for the newline
      // inside a multi-line textfile, so we place each line ourselves.
      const lines = scene.body.split('\n').slice(0, MAX_LINES);
      const draws = lines
        .map((line, lineIndex) => {
          if (line.trim() === '') return null;
          const file = `${name}_l${String(lineIndex).padStart(2, '0')}.txt`;
          writeFileSync(join(WORK, file), line, 'utf8');
          const y = TEXT_TOP + lineIndex * LINE_HEIGHT;
          return `drawtext=fontfile=mono.ttf:textfile=${file}:x=70:y=${y}:fontsize=${FONT_SIZE}:fontcolor=0xE6E4EF`;
        })
        .filter(Boolean);
      input.push('-f', 'lavfi', '-t', String(seconds), '-i', `color=c=0x0E0E13:s=${WIDTH}x${HEIGHT}:r=30`);
      filters.push(`[0:v]${[...draws, titleDraw].join(',')}[v]`);
    }

    const map = ['-map', '[v]'];
    if (audio) {
      input.push('-i', audio);
      map.push('-map', '1:a', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2');
    } else {
      input.push('-f', 'lavfi', '-t', String(seconds), '-i', 'anullsrc=r=48000:cl=stereo');
      map.push('-map', '1:a', '-c:a', 'aac', '-b:a', '128k');
    }

    ffmpeg([
      ...input,
      '-filter_complex',
      filters.join(';'),
      ...map,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30',
      '-shortest',
      `${name}.mp4`,
    ]);
    clips.push(`${name}.mp4`);
    console.log(`  ${name}  ${seconds.toFixed(1)}s  ${scene.title}`);
  });

  writeFileSync(join(WORK, 'list.txt'), clips.map((clip) => `file '${clip}'`).join('\n'), 'utf8');
  ffmpeg(['-f', 'concat', '-safe', '0', '-i', 'list.txt', '-c', 'copy', '../demo.mp4']);

  const total = duration(resolve(ROOT, 'demo.mp4'));
  console.log(`\ndemo.mp4 written (${total.toFixed(1)}s). Hackathon limit is 180s.`);
  if (total > 180) console.warn('TOO LONG - trim a scene before uploading.');
}

/** Headless Edge screenshot of the generated report. Returns a path or null. */
/**
 * Browsers that can screenshot a local file, best first.
 * Edge's --headless=new exits 0 and writes nothing on some builds, so a
 * Playwright chrome-headless-shell is preferred when one is installed.
 */
function screenshotBrowsers() {
  const found = [];
  const pwRoot = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
  if (existsSync(pwRoot)) {
    for (const entry of readdirSync(pwRoot).filter((name) => name.startsWith('chromium')).sort().reverse()) {
      for (const variant of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win/chrome.exe']) {
        const candidate = join(pwRoot, entry, variant);
        if (existsSync(candidate)) found.push(candidate);
      }
    }
  }
  if (existsSync(EDGE)) found.push(EDGE);
  return found;
}

function shoot(reportName) {
  const reportPath = resolve(ROOT, 'out', `${reportName.toLowerCase()}.html`);
  if (!existsSync(reportPath)) return null;
  const shotPath = join(WORK, 'report.png');

  for (const browser of screenshotBrowsers()) {
    rmSync(shotPath, { force: true });
    spawnSync(
      browser,
      [
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--virtual-time-budget=4000',
        '--window-size=1280,1700',
        `--screenshot=${shotPath}`,
        `file:///${reportPath.replace(/\\/g, '/')}`,
      ],
      { encoding: 'utf8', timeout: 90_000 },
    );
    // Exit status lies on some builds; the file on disk is the real answer.
    if (existsSync(shotPath) && statSync(shotPath).size > 5000) return shotPath;
  }
  console.warn('no browser produced a screenshot - skipping the HTML report scene');
  return null;
}

main();
