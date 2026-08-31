# Contributing to BMO

Thanks for taking a look. BMO is a self-hosted AI companion, which shapes what
"contributing" means here: most people will run it on their own hardware, with their own
model, on their own network. Changes that make that easier are the most valuable ones.

## Before you start

Run the setup check — it verifies your install and names the fix for anything broken:

```bash
python3 scripts/check_setup.py
```

## Development

```bash
# backend (auto-reloads)
source venv/bin/activate
uvicorn server:app --reload --port 18789

# frontend (hot reload on :5173)
npm run dev
```

`server.py` serves the built `dist/` directly, so for backend-only work you can skip the
dev server and just `npm run build` once.

## Before opening a PR

```bash
npm run lint                     # must pass clean
python3 -m compileall -q server.py memory_manager.py device_auth.py scripts/
python3 scripts/check_setup.py   # end-to-end sanity
```

CI runs ESLint plus a Python import check. That import check exists because `server.py`
only fails at *import* time, not at build time — a decorator referencing a dependency
defined further down the file will pass every other check and then refuse to boot.

## Things worth knowing

**Model behavior is a feature, not a detail.** BMO reports tool results — weather, shell
output — back to the user. Some small models embellish: during development one invented a
kernel version rather than reporting the real one. If you change how tool results are
summarized, test it against a real tool call and compare the output to what the tool
actually returned.

**The context window is a shared budget.** `SOUL.md` costs roughly 960 tokens on every
single message, memory facts about 30 each. Anything you add to the system prompt is paid
for on every turn, forever. Measure before adding.

**Escalation sends user data off-device.** Anything routed to the cloud leaves the user's
machine and costs them money. It must respect `escalation_mode` — and `off` means off,
with no convenience flag able to override it.

**Anything `VITE_`-prefixed ends up in the client bundle in plaintext**, including any
published APK. Never read a secret through one that shouldn't be public.

**Destructive operations need an undo.** Memory consolidation archives rather than
deletes, and refuses implausible merges, because a model silently discarding what BMO
learned is unrecoverable otherwise. Hold new destructive paths to the same standard.

### Adding a Capacitor plugin

`BUILD SUCCESSFUL` does not mean the plugin is in your APK. A stale Gradle cache can
report `compileDebugKotlin UP-TO-DATE` while producing an **empty** `classes.jar` — the
plugin's manifest still merges, so Android tries to start a component whose class isn't
in the dex and the app crashes on launch with `ClassNotFoundException`. That happened
here with `@capacitor/local-notifications`.

After adding a plugin, check the class actually shipped:

```bash
unzip -p android/app/build/outputs/apk/debug/app-debug.apk classes*.dex \
  | grep -c YourPluginClassName
```

If it's missing, `rm -rf node_modules/@scope/plugin/android/build` and rebuild. CI is
unaffected — it builds from a clean checkout every time.

### Notifications must not ask for an exact alarm

`LocalNotifications.schedule()` defaults `isExactNotification` to **true**, and that flag
is checked *before* the schedule is looked at. On Android 12+ an app without
`SCHEDULE_EXACT_ALARM` gets sent to the "Alarms & reminders" settings screen — the call
still resolves successfully, and nothing is posted. That permission is separate from the
notification prompt, so a user who granted notifications sees BMO bounce them to a
settings page and never notify. Passing `schedule: { at: ... }` has the same effect via
AlarmManager, even a few hundred milliseconds out.

BMO notifies about things that already happened, so it never needs an exact alarm. Pass
`isExactNotification: false` and omit `schedule` entirely. Verify by *delivery*, never by
the promise resolving:

```bash
adb shell dumpsys notification | grep pkg=io.github.theofiledes.more
```

## Style

Match the surrounding code — it's plain React and plain FastAPI, no framework beyond
that. Comments should explain *why*, especially where something looks odd; a fair amount
of this codebase is shaped by specific model or platform behavior that isn't obvious from
reading it.

## Security

Please don't open a public issue for a vulnerability. BMO executes shell commands by
design, so the interesting bugs are the ones that let someone reach that without
authorization. Report those privately to the maintainer first.
