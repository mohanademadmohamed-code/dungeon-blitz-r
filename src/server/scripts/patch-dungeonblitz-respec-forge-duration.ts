import * as path from "path";
import {
  applyPatchesToBody,
  BytePatch,
  classIndexByName,
  disassemble,
  ensureBackup,
  Instruction,
  methodIdxForTrait,
  parseAbc,
  parseSwf,
  PatchError,
  writeSwf,
  writeU30,
} from "./swfPatchUtils";

const DEFAULT_SWF = path.resolve(
  __dirname,
  "..",
  "..",
  "client",
  "content",
  "localhost",
  "p",
  "cbp",
  "DungeonBlitz.swf",
);

const RESPEC_FORGE_SECONDS = 259200;

function parseArgs(argv: string[]): { swfPath: string; verify: boolean } {
  let swfPath = DEFAULT_SWF;
  let verify = false;

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--swf" || arg === "-s") {
      swfPath = path.resolve(argv[++index] || "");
      continue;
    }
    if (arg === "--verify" || arg === "--dry-run") {
      verify = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage:",
        "  ts-node src/server/scripts/patch-dungeonblitz-respec-forge-duration.ts [--verify] [--swf <path>]",
        "",
        "Patches DungeonBlitz.swf so the Respec Stone special forge progress",
        "uses three days instead of the old four-day class_64.const_1073 value.",
      ].join("\n"));
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { swfPath, verify };
}

function u30Name(abc: ReturnType<typeof parseAbc>, inst: Instruction | undefined): string | null {
  const operand = inst?.operands[0];
  if (!operand || operand[0] !== "u30") {
    return null;
  }
  return abc.multinameNames[operand[1]] ?? null;
}

function pushIntValue(abc: ReturnType<typeof parseAbc>, inst: Instruction | undefined): number | null {
  const operand = inst?.operands[0];
  if (!inst || inst.opcode !== 0x2d || !operand || operand[0] !== "u30") {
    return null;
  }
  return abc.intValues[operand[1]] ?? null;
}

function nopPaddedPushInt(valueIndex: number, oldLength: number): Buffer {
  const pushInt = Buffer.concat([Buffer.from([0x2d]), writeU30(valueIndex)]);
  if (pushInt.length > oldLength) {
    throw new PatchError(`Respec forge duration replacement is too long: ${pushInt.length} > ${oldLength}`);
  }
  return Buffer.concat([pushInt, Buffer.alloc(oldLength - pushInt.length, 0x02)]);
}

function findPatches(swfPath: string): { patches: BytePatch[]; oldCount: number; patchedCount: number } {
  const ctx = parseSwf(swfPath);
  const abc = parseAbc(ctx);
  const classIndex = classIndexByName(abc, "class_86");
  if (classIndex === null) {
    throw new PatchError("Could not find class_86.");
  }

  const methodIdx = methodIdxForTrait(
    [...abc.instances[classIndex].traits, ...(abc.classTraits[classIndex] ?? [])],
    abc,
    "GetTimeAfterBonuses",
  );
  if (methodIdx === null) {
    throw new PatchError("Could not find class_86.GetTimeAfterBonuses.");
  }

  const methodBody = abc.methodBodies.get(methodIdx);
  if (!methodBody) {
    throw new PatchError("Could not find class_86.GetTimeAfterBonuses body.");
  }

  const threeDayIndex = abc.intValues.findIndex((value) => value === RESPEC_FORGE_SECONDS);
  if (threeDayIndex < 0) {
    throw new PatchError(`Could not find int constant ${RESPEC_FORGE_SECONDS}.`);
  }

  const code = ctx.body.subarray(methodBody.codeStart, methodBody.codeStart + methodBody.codeLen);
  const instructions = disassemble(code, "class_86.GetTimeAfterBonuses");
  const patches: BytePatch[] = [];
  let oldCount = 0;
  let patchedCount = 0;

  for (let index = 0; index < instructions.length - 2; index += 1) {
    const first = instructions[index];
    const second = instructions[index + 1];
    const third = instructions[index + 2];

    if (
      first.opcode === 0x60 &&
      u30Name(abc, first) === "class_64" &&
      second.opcode === 0x66 &&
      u30Name(abc, second) === "const_1073" &&
      third.opcode === 0x48
    ) {
      const oldLength = first.size + second.size;
      patches.push({
        key: `class_86.GetTimeAfterBonuses.respecForgeDuration.${methodBody.codeStart + first.offset}`,
        start: methodBody.codeStart + first.offset,
        end: methodBody.codeStart + second.offset + second.size,
        data: nopPaddedPushInt(threeDayIndex, oldLength),
        detail: "return three days for Respec Stone extended forge duration",
      });
      oldCount += 1;
      continue;
    }

    if (
      pushIntValue(abc, first) === RESPEC_FORGE_SECONDS &&
      second.opcode === 0x02 &&
      third.opcode === 0x02 &&
      instructions[index + 3]?.opcode === 0x48
    ) {
      patchedCount += 1;
    }
  }

  return { patches, oldCount, patchedCount };
}

function patchSwf(swfPath: string, verify: boolean): void {
  const firstPass = findPatches(swfPath);
  if (verify) {
    if (firstPass.oldCount > 0 || firstPass.patchedCount !== 1) {
      throw new PatchError(
        `Respec forge duration patch missing: old=${firstPass.oldCount}, patched=${firstPass.patchedCount}`,
      );
    }
    console.log("Respec forge duration patch verified.");
    return;
  }

  if (firstPass.patches.length === 0) {
    if (firstPass.patchedCount === 1) {
      console.log("Respec forge duration patch already applied.");
      return;
    }
    throw new PatchError(
      `Expected one Respec forge duration patch point, found old=${firstPass.oldCount}, patched=${firstPass.patchedCount}`,
    );
  }

  if (firstPass.patches.length !== 1) {
    throw new PatchError(`Expected one Respec forge duration patch, found ${firstPass.patches.length}`);
  }

  const ctx = parseSwf(swfPath);
  ensureBackup(swfPath);
  const { body, delta } = applyPatchesToBody(ctx.body, firstPass.patches);
  if (delta !== 0) {
    throw new PatchError(`Unexpected Respec forge duration patch size delta: ${delta}`);
  }
  writeSwf(ctx, body, delta);

  const secondPass = findPatches(swfPath);
  if (secondPass.oldCount > 0 || secondPass.patchedCount !== 1) {
    throw new PatchError(
      `Respec forge duration patch did not verify after write: old=${secondPass.oldCount}, patched=${secondPass.patchedCount}`,
    );
  }

  console.log("Respec forge duration patch applied.");
}

const args = parseArgs(process.argv);
patchSwf(args.swfPath, args.verify);
