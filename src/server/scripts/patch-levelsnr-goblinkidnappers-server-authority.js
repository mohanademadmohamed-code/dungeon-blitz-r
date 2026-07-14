const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_SWF = path.join('src', 'client', 'content', 'localhost', 'p', 'cbp', 'LevelsNR.swf');
const CLASS_NAMES = [
  'a_Room_Tutorial_01',
  'a_Room_Tutorial_02',
  'a_Room_Tutorial_05_ALT',
  'a_Room_NRM02RGoblinCaveBoss'
];

function parseArgs(argv) {
  const args = {
    swf: DEFAULT_SWF,
    ffdec: '',
    verify: false
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--swf' || arg === '--swf-path') {
      args.swf = argv[++index] || args.swf;
    } else if (arg === '--ffdec' || arg === '-f') {
      args.ffdec = argv[++index] || '';
    } else if (arg === '--verify' || arg === '--dry-run') {
      args.verify = true;
    } else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function usage() {
  console.log([
    'Usage:',
    '  node src/server/scripts/patch-levelsnr-goblinkidnappers-server-authority.js [--verify] [--swf <path>] [--ffdec <path>]',
    '',
    'Patches LevelsNR Goblin Kidnappers room scripts so chain, dummy, chest,',
    'and Tag Ugo boss decision points are routed through explicit visual-only',
    'server-authority helpers while preserving authored animation, dialogue,',
    'camera, and sound cues.'
  ].join('\n'));
}

function resolveRepoRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function resolvePath(repoRoot, maybeRelative) {
  return path.isAbsolute(maybeRelative) ? maybeRelative : path.join(repoRoot, maybeRelative);
}

function detectFfdec(repoRoot, preferred) {
  const candidates = [];
  if (preferred) {
    candidates.push(resolvePath(repoRoot, preferred));
  }

  candidates.push(
    path.join(repoRoot, 'build', 'tools', 'ffdec_25.0.0', 'ffdec-cli.exe'),
    path.join(repoRoot, 'build', 'tools', 'ffdec_25.0.0', 'ffdec-cli.jar'),
    path.join(repoRoot, 'build', 'tools', 'ffdec_25.0.0', 'ffdec.jar'),
    path.join(repoRoot, 'build', 'ffdec_24.0.1', 'ffdec-cli.exe'),
    path.join(repoRoot, 'build', 'ffdec_24.0.1', 'ffdec-cli.jar'),
    'C:\\Program Files (x86)\\FFDec\\ffdec-cli.exe',
    'C:\\Program Files\\FFDec\\ffdec-cli.exe',
    '/Applications/FFDec.app/Contents/Resources/ffdec.sh',
    '/Applications/FFDec.app/Contents/Resources/ffdec.jar',
    '/Applications/FFDec.app/Contents/Resources/ffdec-cli.jar'
  );

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function runFfdec(ffdecPath, args) {
  const resolved = path.resolve(ffdecPath);
  const basename = path.basename(resolved).toLowerCase();

  if (basename.endsWith('.jar')) {
    execFileSync('java', ['-jar', resolved, '-cli', ...args], { stdio: 'inherit' });
    return;
  }

  execFileSync(resolved, ['-cli', ...args], { stdio: 'inherit' });
}

function exportRoomScripts(ffdecPath, workRoot, swfPath) {
  fs.rmSync(workRoot, { recursive: true, force: true });
  fs.mkdirSync(workRoot, { recursive: true });
  runFfdec(ffdecPath, ['-selectclass', CLASS_NAMES.join(','), '-export', 'script', workRoot, swfPath]);

  const scriptsDir = path.join(workRoot, 'scripts');
  for (const className of CLASS_NAMES) {
    const scriptPath = path.join(scriptsDir, `${className}.as`);
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`FFDec export did not produce ${scriptPath}`);
    }
  }

  return scriptsDir;
}

function eolOf(source) {
  return source.includes('\r\n') ? '\r\n' : '\n';
}

function normalizeBlock(block, eol) {
  return block.trim().replace(/\n/g, eol);
}

function findMethodRange(source, methodName) {
  const marker = `public function ${methodName}(`;
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find method ${methodName}`);
  }

  const braceStart = source.indexOf('{', start);
  if (braceStart === -1) {
    throw new Error(`Could not find method body for ${methodName}`);
  }

  let depth = 0;
  for (let index = braceStart; index < source.length; index += 1) {
    const ch = source[index];
    if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index + 1 };
      }
    }
  }

  throw new Error(`Could not find end of method ${methodName}`);
}

function replaceMethod(source, methodName, replacement) {
  const range = findMethodRange(source, methodName);
  return `${source.slice(0, range.start)}${replacement}${source.slice(range.end)}`;
}

function insertBeforeInternalSetter(source, insertion, label) {
  const marker = '      internal function __setProp_';
  const start = source.indexOf(marker);
  if (start === -1) {
    throw new Error(`Could not find helper insertion point for ${label}`);
  }
  const eol = eolOf(source);
  return `${source.slice(0, start)}${insertion}${eol}      ${eol}${source.slice(start)}`;
}

function patchTutorial01(source) {
  const eol = eolOf(source);
  let patched = source;

  if (!patched.includes('public function ServerAuthorityVisualCueDefeated(')) {
    patched = insertBeforeInternalSetter(
      patched,
      normalizeBlock(`
      public function ServerAuthorityVisualCueDefeated(param1:a_Cue) : Boolean
      {
         return Boolean(param1) && (param1.Defeated() || param1.Health() <= 0);
      }
    `, eol),
      'a_Room_Tutorial_01'
    );
  }

  patched = patched.replace(/this\.am_Chains\.Defeated\(\)/g, 'this.ServerAuthorityVisualCueDefeated(this.am_Chains)');
  verifyTutorial01(patched, 'patched a_Room_Tutorial_01');
  return patched;
}

function patchTutorial02(source) {
  const eol = eolOf(source);
  let patched = source;

  if (!patched.includes('public function ServerAuthorityVisualDummyDefeated(')) {
    const helper = normalizeBlock(`
      public function ServerAuthorityVisualDummyDefeated(param1:a_Cue) : Boolean
      {
         return Boolean(param1) && param1.bSpawned && (param1.Defeated() || param1.Health() <= 0);
      }
    `, eol);
    const dummyDefeated = normalizeBlock(`
      public function DummyDefeated(param1:a_Cue) : Boolean
      {
         return this.ServerAuthorityVisualDummyDefeated(param1);
      }
    `, eol);
    patched = replaceMethod(patched, 'DummyDefeated', `${helper}${eol}      ${eol}${dummyDefeated}`);
  }

  verifyTutorial02(patched, 'patched a_Room_Tutorial_02');
  return patched;
}

function patchTutorial05Alt(source) {
  const eol = eolOf(source);
  let patched = source;

  if (!patched.includes('public function ServerAuthorityVisualChestOpened(')) {
    patched = insertBeforeInternalSetter(
      patched,
      normalizeBlock(`
      public function ServerAuthorityVisualChestOpened(param1:a_Cue) : Boolean
      {
         return Boolean(param1) && (param1.Defeated() || param1.Health() <= 0);
      }
    `, eol),
      'a_Room_Tutorial_05_ALT'
    );
  }

  patched = patched.replace(
    'this.am_WaveBoss.Defeated() && !this.bChestOpened',
    'this.ServerAuthorityVisualChestOpened(this.am_WaveBoss) && !this.bChestOpened'
  );
  verifyTutorial05Alt(patched, 'patched a_Room_Tutorial_05_ALT');
  return patched;
}

function patchBossRoom(source) {
  const eol = eolOf(source);
  let patched = source;

  if (!patched.includes('public function ServerAuthorityVisualBossAtHealth(')) {
    patched = insertBeforeInternalSetter(
      patched,
      normalizeBlock(`
      public function ServerAuthorityVisualBossAtHealth(param1:a_Cue, param2:Number) : Boolean
      {
         return Boolean(param1) && param1.AtHealth(param2);
      }
      
      public function ServerAuthorityVisualCueDefeated(param1:a_Cue) : Boolean
      {
         return Boolean(param1) && (param1.Defeated() || param1.Health() <= 0);
      }
    `, eol),
      'a_Room_NRM02RGoblinCaveBoss'
    );
  }

  patched = patched.replace(/this\.am_Boss\.AtHealth\(0\.8\)/g, 'this.ServerAuthorityVisualBossAtHealth(this.am_Boss,0.8)');
  patched = patched.replace(/this\.am_Boss\.AtHealth\(0\.5\)/g, 'this.ServerAuthorityVisualBossAtHealth(this.am_Boss,0.5)');
  patched = patched.replace(/this\.am_Boss\.AtHealth\(0\.33\)/g, 'this.ServerAuthorityVisualBossAtHealth(this.am_Boss,0.33)');
  patched = patched.replace(/this\.am_Boss\.Defeated\(\)/g, 'this.ServerAuthorityVisualCueDefeated(this.am_Boss)');
  patched = patched.replace(/this\.am_Chains\.Defeated\(\)/g, 'this.ServerAuthorityVisualCueDefeated(this.am_Chains)');
  verifyBossRoom(patched, 'patched a_Room_NRM02RGoblinCaveBoss');
  return patched;
}

function verifyTutorial01(source, label) {
  requireMarkers(source, label, [
    'public function ServerAuthorityVisualCueDefeated(param1:a_Cue) : Boolean',
    'this.ServerAuthorityVisualCueDefeated(this.am_Chains)',
    'param1.Animate("am_ChainsTut","Remove",true);',
    'param1.CollisionOff("am_DynamicCollision_WaitingForHelp");'
  ]);
  rejectMarkers(source, label, ['this.am_Chains.Defeated()']);
}

function verifyTutorial02(source, label) {
  requireMarkers(source, label, [
    'public function ServerAuthorityVisualDummyDefeated(param1:a_Cue) : Boolean',
    'return this.ServerAuthorityVisualDummyDefeated(param1);',
    'this.am_Dummy1.Spawn();',
    'this.am_Dummy2.Spawn();',
    'this.am_Dummy3.Spawn();',
    'param1.CollisionOff("am_DynamicCollision_GateBlock");'
  ]);
  rejectMarkers(source, label, ['param1.OnDefeat()']);
}

function verifyTutorial05Alt(source, label) {
  requireMarkers(source, label, [
    'public function ServerAuthorityVisualChestOpened(param1:a_Cue) : Boolean',
    'this.ServerAuthorityVisualChestOpened(this.am_WaveBoss) && !this.bChestOpened',
    'param1.CollisionOff("am_DynamicCollision_PathBlock02");',
    'param1.PlayScript(this.Script_Ambush);'
  ]);
}

function verifyBossRoom(source, label) {
  requireMarkers(source, label, [
    'this.am_Boss.displayName = "Tag Ugo";',
    'public function ServerAuthorityVisualBossAtHealth(param1:a_Cue, param2:Number) : Boolean',
    'public function ServerAuthorityVisualCueDefeated(param1:a_Cue) : Boolean',
    'this.ServerAuthorityVisualBossAtHealth(this.am_Boss,0.8)',
    'this.ServerAuthorityVisualBossAtHealth(this.am_Boss,0.5)',
    'this.ServerAuthorityVisualBossAtHealth(this.am_Boss,0.33)',
    'this.ServerAuthorityVisualCueDefeated(this.am_Boss)',
    'this.ServerAuthorityVisualCueDefeated(this.am_Chains)',
    'param1.cutSceneStartBoss = [',
    'param1.cutSceneDefeatBoss = ['
  ]);
  rejectMarkers(source, label, [
    'this.am_Boss.AtHealth(0.8)',
    'this.am_Boss.AtHealth(0.5)',
    'this.am_Boss.AtHealth(0.33)',
    'this.am_Boss.Defeated()',
    'this.am_Chains.Defeated()'
  ]);
}

function requireMarkers(source, label, markers) {
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`${label} is missing required marker: ${marker}`);
    }
  }
}

function rejectMarkers(source, label, markers) {
  for (const marker of markers) {
    if (source.includes(marker)) {
      throw new Error(`${label} still contains forbidden marker: ${marker}`);
    }
  }
}

function patchScripts(scriptsDir) {
  const patchers = new Map([
    ['a_Room_Tutorial_01', patchTutorial01],
    ['a_Room_Tutorial_02', patchTutorial02],
    ['a_Room_Tutorial_05_ALT', patchTutorial05Alt],
    ['a_Room_NRM02RGoblinCaveBoss', patchBossRoom]
  ]);

  let changed = false;
  for (const [className, patcher] of patchers) {
    const scriptPath = path.join(scriptsDir, `${className}.as`);
    const original = fs.readFileSync(scriptPath, 'utf8');
    const patched = patcher(original);
    if (patched !== original) {
      fs.writeFileSync(scriptPath, patched, 'utf8');
      changed = true;
    }
  }
  return changed;
}

function verifyScripts(scriptsDir) {
  verifyTutorial01(fs.readFileSync(path.join(scriptsDir, 'a_Room_Tutorial_01.as'), 'utf8'), 'a_Room_Tutorial_01');
  verifyTutorial02(fs.readFileSync(path.join(scriptsDir, 'a_Room_Tutorial_02.as'), 'utf8'), 'a_Room_Tutorial_02');
  verifyTutorial05Alt(fs.readFileSync(path.join(scriptsDir, 'a_Room_Tutorial_05_ALT.as'), 'utf8'), 'a_Room_Tutorial_05_ALT');
  verifyBossRoom(fs.readFileSync(path.join(scriptsDir, 'a_Room_NRM02RGoblinCaveBoss.as'), 'utf8'), 'a_Room_NRM02RGoblinCaveBoss');
}

function patchSwf(repoRoot, ffdecPath, swfPath) {
  const workRoot = path.join(repoRoot, 'build', 'ffdec-goblinkidnappers-server-authority', path.basename(swfPath, path.extname(swfPath)));
  const patchedSwfPath = path.join(workRoot, `${path.basename(swfPath, path.extname(swfPath))}.patched.swf`);
  const scriptsDir = exportRoomScripts(ffdecPath, workRoot, swfPath);
  const changed = patchScripts(scriptsDir);
  verifyScripts(scriptsDir);

  if (!changed) {
    console.log(`SWF already contains the Goblin Kidnappers server authority room-source patch: ${swfPath}`);
    return;
  }

  runFfdec(ffdecPath, ['-importScript', swfPath, patchedSwfPath, scriptsDir]);
  fs.copyFileSync(patchedSwfPath, swfPath);
  console.log(`Patched Goblin Kidnappers server authority room sources in ${swfPath}`);
}

function verifySwf(repoRoot, ffdecPath, swfPath) {
  const workRoot = path.join(repoRoot, 'build', 'ffdec-goblinkidnappers-server-authority-verify', path.basename(swfPath, path.extname(swfPath)));
  const scriptsDir = exportRoomScripts(ffdecPath, workRoot, swfPath);
  verifyScripts(scriptsDir);
  console.log(`Verified Goblin Kidnappers server authority room-source patch in ${swfPath}`);
}

function main() {
  const repoRoot = resolveRepoRoot();
  const args = parseArgs(process.argv);
  const swfPath = resolvePath(repoRoot, args.swf);
  const ffdecPath = detectFfdec(repoRoot, args.ffdec);

  if (!ffdecPath) {
    throw new Error('FFDec not found. Pass --ffdec or restore the repo-bundled FFDec tool.');
  }

  if (args.verify) {
    verifySwf(repoRoot, ffdecPath, swfPath);
    return;
  }

  patchSwf(repoRoot, ffdecPath, swfPath);
  verifySwf(repoRoot, ffdecPath, swfPath);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
