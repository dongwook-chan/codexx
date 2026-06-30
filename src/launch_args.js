import { effectiveYoloMode, loadState } from "./config.js";

export const codexTargetCapabilities = {
  yoloFlag: "--dangerously-bypass-approvals-and-sandbox",
  foreignYoloFlags: ["--dangerously-skip-permissions"],
};

export function buildCodexLaunchArgs(args, state) {
  for (const flag of codexTargetCapabilities.foreignYoloFlags) {
    if (args.includes(flag)) {
      throw new Error(
        `${flag} is an agy option. For Codex use ${codexTargetCapabilities.yoloFlag}.`,
      );
    }
  }

  const result = [...args];
  if (
    effectiveYoloMode(state)
    && !result.includes(codexTargetCapabilities.yoloFlag)
  ) {
    result.unshift(codexTargetCapabilities.yoloFlag);
  }
  return result;
}

export async function buildCodexLaunchArgsFromState(args) {
  return buildCodexLaunchArgs(args, await loadState());
}
