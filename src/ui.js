import { formatReset } from "./quota.js";

function pad(value, width) {
  const text = String(value ?? "");
  return text.length >= width ? text : `${text}${" ".repeat(width - text.length)}`;
}

export function printProfiles(state) {
  const rows = state.profiles.map((profile) => ({
    active: state.activeProfile === profile.name ? "*" : "",
    name: profile.name,
    email: profile.email ?? profile.accountId ?? "",
    status: profile.disabled ? "disabled" : (profile.quotaStatus ?? "unknown"),
    reset: formatReset(profile.quotaResetAt),
    primary: profile.lastUsage?.maxPrimary ?? "",
    secondary: profile.lastUsage?.maxSecondary ?? "",
    selected: profile.selectionCount ?? 0,
  }));
  const headers = ["", "name", "account", "status", "reset", "primary", "secondary", "switches"];
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...rows.map((row) => String(Object.values(row)[index] ?? "").length),
  ));
  console.log(headers.map((header, index) => pad(header, widths[index])).join("  "));
  console.log(widths.map((width) => "-".repeat(width)).join("  "));
  for (const row of rows) {
    console.log(Object.values(row).map((value, index) => pad(value, widths[index])).join("  "));
  }
}

export function printScanSummary(summary) {
  console.log(`files: ${summary.scannedFiles}`);
  console.log(`token_count records: ${summary.tokenCountRecords}`);
  if (summary.current) {
    console.log(`current primary: ${summary.current.primary}%`);
    console.log(`current secondary: ${summary.current.secondary}%`);
  }
  console.log(`historical max primary: ${summary.maxPrimary}%`);
  console.log(`historical max secondary: ${summary.maxSecondary}%`);
  if (summary.planType) console.log(`plan: ${summary.planType}`);
  if (summary.lastCredits) {
    console.log(`credits: has=${summary.lastCredits.has_credits ?? ""} balance=${summary.lastCredits.balance ?? ""}`);
  }
  console.log(`currently exhausted: ${summary.exhausted ? "yes" : "no"}`);
  console.log(`historical exhausted events: ${summary.exhaustedEvents}`);
  if (summary.exhausted && summary.reason) console.log(`reason: ${summary.reason}`);
  if (summary.exhausted && summary.resetAt) console.log(`reset: ${summary.resetAt} (${formatReset(summary.resetAt)})`);
  const recent = summary.highWatermarks.slice(-8);
  if (recent.length) {
    console.log("");
    console.log("recent high-water marks:");
    for (const event of recent) {
      console.log(`${event.timestamp} primary=${event.primary}% secondary=${event.secondary}% ${event.file}:${event.line}`);
    }
  }
}
