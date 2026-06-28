import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { refreshActiveProfileCredential, useProfile } from "./auth.js";
import { clearExpiredQuota, loadState, saveState } from "./config.js";
import { findRealCodex } from "./processes.js";
import { QuotaTail, wait } from "./quota_tail.js";
import { recordQuotaForProfile, scanCodexSessions } from "./quota.js";
import { snapshotSessionFiles, waitForMatchingSession, findMatchingSession } from "./session_match.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const supervisorPath = join(packageRoot, "bin", "cdxx-supervisor");

async function findNativeSupervisor() {
  await access(supervisorPath, constants.X_OK);
  return supervisorPath;
}

async function runNativeCodexSession(args) {
  const realCodex = await findRealCodex();
  const supervisor = await findNativeSupervisor();
  return await new Promise((resolve, reject) => {
    const child = spawn(supervisor, args, {
      stdio: "inherit",
      cwd: process.cwd(),
      env: {
        ...process.env,
        CDXX_REAL_CODEX: realCodex,
        CDXX_CLI_PATH: fileURLToPath(new URL("./cli.js", import.meta.url)),
        CDXX_NODE_PATH: process.execPath,
      },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
}

function spawnCodex(command, args) {
  const child = spawn(command, args, { stdio: "inherit", cwd: process.cwd(), env: process.env });
  const exit = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 128 : 1)));
  });
  return { child, exit };
}

async function saveMatchedSession(matchedSession) {
  if (!matchedSession?.sessionId) return;
  const state = await loadState();
  state.lastSession = {
    sessionId: matchedSession.sessionId,
    file: matchedSession.file,
    timestamp: matchedSession.timestamp,
    cwd: matchedSession.cwd,
    matchedAt: new Date().toISOString(),
  };
  const active = state.profiles.find((profile) => profile.name === state.activeProfile);
  if (active) active.lastSession = state.lastSession;
  await saveState(state);
}

function describeReset(profile) {
  return profile.quotaResetAt ? `; reset at ${profile.quotaResetAt}` : "";
}

async function pickFailoverProfile(exhaustedName) {
  const state = await loadState();
  if (!state.settings?.autoswitch) return undefined;
  return pickNextProfile(state, exhaustedName);
}

function stopChildForFailover(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, 5000).unref();
}

async function monitorMatchedSession(matchedSession, child, profileName, signal) {
  if (!matchedSession?.file) return undefined;
  const tail = new QuotaTail(matchedSession.file, {
    offset: Math.max(0, matchedSession.previousSize ?? 0),
  });
  while (!signal.aborted) {
    const summary = await tail.readAdded();
    if (summary?.tokenCountRecords) {
      const profile = await recordQuotaForProfile(summary, profileName);
      if (profile?.quotaStatus === "exhausted") {
        console.error(`[cdxx] Profile '${profile.name}' reached quota${describeReset(profile)}.`);
        const next = await pickFailoverProfile(profile.name);
        if (next && matchedSession.sessionId) {
          console.error(`[cdxx] Switching to '${next.name}' and resuming ${matchedSession.sessionId}.`);
          stopChildForFailover(child);
          return {
            sessionId: matchedSession.sessionId,
            fromProfile: profile.name,
            toProfile: next.name,
          };
        }
        if (!next) console.error("[cdxx] Autoswitch is off or no selectable profile was found.");
        return undefined;
      }
    }
    await wait(500, signal);
  }
  return undefined;
}

async function runCodexOnce(realCodex, args) {
  const started = Date.now();
  const profileName = (await loadState()).activeProfile;
  const before = await snapshotSessionFiles();
  const { child, exit } = spawnCodex(realCodex, args);
  const matchAbort = new AbortController();
  const monitorAbort = new AbortController();
  let matchedSession;
  let monitorPromise;
  let failover;

  const matchPromise = waitForMatchingSession({
    before,
    cwd: process.cwd(),
    startMs: started,
    timeoutMs: 30000,
    signal: matchAbort.signal,
  }).then(async (match) => {
    matchedSession = match;
    await saveMatchedSession(match);
    if (match?.file) {
      monitorPromise = monitorMatchedSession(match, child, profileName, monitorAbort.signal).then((result) => {
        failover = result;
        return result;
      });
    }
    return match;
  }).catch(() => undefined);

  const code = await exit;
  matchAbort.abort();
  monitorAbort.abort();
  await matchPromise.catch(() => undefined);
  if (monitorPromise) await monitorPromise.catch(() => undefined);

  matchedSession = await findMatchingSession({
    before,
    cwd: process.cwd(),
    startMs: started,
  }).catch(() => matchedSession);
  await saveMatchedSession(matchedSession);

  await refreshActiveProfileCredential();
  const summary = await scanCodexSessions({ sinceMs: started - 5000 });
  const profile = await recordQuotaForProfile(summary, profileName);
  if (!failover && profile?.quotaStatus === "exhausted") {
    console.error(`[cdxx] Profile '${profile.name}' reached quota${describeReset(profile)}.`);
    const next = await pickFailoverProfile(profile.name);
    if (next && matchedSession?.sessionId) {
      failover = {
        sessionId: matchedSession.sessionId,
        fromProfile: profile.name,
        toProfile: next.name,
      };
    } else if (next) {
      console.error(`[cdxx] Autoswitched future Codex runs to '${next.name}'.`);
      await useProfile(next.name);
    } else {
      console.error("[cdxx] Autoswitch is off or no selectable profile was found.");
    }
  }

  return { code, failover };
}

export async function runCodexSession(args) {
  try {
    return await runNativeCodexSession(args);
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "EACCES") throw error;
    console.error("[cdxx] Native supervisor is missing; falling back to JS supervisor.");
  }
  const realCodex = await findRealCodex();
  let currentArgs = args;
  let attempts = 0;
  for (;;) {
    const { code, failover } = await runCodexOnce(realCodex, currentArgs);
    if (!failover) return code;
    attempts += 1;
    if (attempts > 10) {
      console.error("[cdxx] Stopping after 10 quota failover attempts.");
      return code;
    }
    await useProfile(failover.toProfile);
    currentArgs = ["resume", failover.sessionId];
  }
}

export function pickNextProfile(state, currentName = state.activeProfile) {
  const profiles = [...state.profiles].sort((left, right) => left.name.localeCompare(right.name));
  if (!profiles.length) return undefined;
  for (const profile of profiles) clearExpiredQuota(profile);
  const start = Math.max(0, profiles.findIndex((profile) => profile.name === currentName));
  for (let step = 1; step <= profiles.length; step += 1) {
    const candidate = profiles[(start + step) % profiles.length];
    if (candidate.disabled) continue;
    if (candidate.quotaStatus === "exhausted") continue;
    return candidate;
  }
  return undefined;
}

export async function codexAuthExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
