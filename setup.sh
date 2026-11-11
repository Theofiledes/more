#!/bin/bash
#
# BMO one-shot installer.
#
# Safe to re-run: every step checks before it acts, and nothing here deletes or
# overwrites anything you already have. In particular an existing .env is never
# touched — your API token and settings survive a re-run.
#
#   ./setup.sh            interactive; asks before installing anything system-wide
#   ./setup.sh --yes      assume yes to those prompts (for ssh / scripted runs)
#   ./setup.sh --no-model skip the multi-GB Ollama model download
#
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" || exit 1

ASSUME_YES=0
SKIP_MODEL=0
for arg in "$@"; do
    case "$arg" in
        --yes|-y)   ASSUME_YES=1 ;;
        --no-model) SKIP_MODEL=1 ;;
        --help|-h)  sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $arg (try --help)"; exit 2 ;;
    esac
done

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
STEP=0
step() { STEP=$((STEP + 1)); printf '\n%s[%d/8] %s%s\n' "$BOLD" "$STEP" "$1" "$RST"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$RST" "$1"; }
info() { printf '  %s%s%s\n' "$DIM" "$1" "$RST"; }
warn() { printf '  %s!%s %s\n' "$YEL" "$RST" "$1"; }
# %b, not %s: the failure messages embed \n so they can print a command on its own line.
die()  { printf '\n  %s✗ %b%s\n\n' "$RED" "$1" "$RST"; exit 1; }

# Ask before doing anything that touches the system outside this directory. Defaults to
# no: a stranger running an installer from the internet should have to opt in to sudo,
# and a non-interactive shell must never block on a prompt it can't answer.
confirm() {
    [ "$ASSUME_YES" = "1" ] && return 0
    [ -t 0 ] || return 1
    printf '  %s? %s [y/N] %s' "$YEL" "$1" "$RST"
    read -r reply
    [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}

# The command that installs $1 on this machine, or "" if we don't know how.
install_cmd() {
    case "$1" in
        curl|zstd)
            command -v apt-get >/dev/null && { echo "sudo apt-get install -y $1"; return; }
            command -v dnf     >/dev/null && { echo "sudo dnf install -y $1"; return; }
            command -v pacman  >/dev/null && { echo "sudo pacman -S --noconfirm $1"; return; }
            command -v brew    >/dev/null && { echo "brew install $1"; return; } ;;
        node)
            # Not apt: Debian/Ubuntu's nodejs is too old for the build (Ubuntu 24.04 ships
            # 18). install_node_nvm below handles those systems instead.
            command -v dnf     >/dev/null && { echo "sudo dnf install -y nodejs npm"; return; }
            command -v pacman  >/dev/null && { echo "sudo pacman -S --noconfirm nodejs npm"; return; }
            command -v brew    >/dev/null && { echo "brew install node"; return; } ;;
        python3)
            command -v apt-get >/dev/null && { echo "sudo apt-get install -y python3 python3-venv python3-pip"; return; }
            command -v dnf     >/dev/null && { echo "sudo dnf install -y python3 python3-pip"; return; }
            command -v pacman  >/dev/null && { echo "sudo pacman -S --noconfirm python python-pip"; return; }
            command -v brew    >/dev/null && { echo "brew install python"; return; } ;;
        ollama)
            # Ollama ships its own installer; there is no distro package worth preferring.
            [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null && { echo "brew install ollama"; return; }
            echo "curl -fsSL https://ollama.com/install.sh | sh" ;;
    esac
    echo ""
}

# Offer to run the install for $2, or print it and fail. $1 is the binary name.
require() {
    local bin="$1" label="$2" cmd
    command -v "$bin" >/dev/null 2>&1 && return 0
    cmd="$(install_cmd "$bin")"
    warn "$label is not installed."
    if [ -z "$cmd" ]; then
        die "Install $label, then re-run ./setup.sh"
    fi
    info "would run: $cmd"
    if confirm "Install $label now?"; then
        # pipefail: without it `curl ... | sh` "succeeds" when curl fails (sh exits 0 on
        # empty input), and the user gets a misleading "not on PATH" loop instead.
        bash -o pipefail -c "$cmd" || die "That failed. Install $label yourself, then re-run ./setup.sh"
        command -v "$bin" >/dev/null 2>&1 || die "$label still isn't on PATH. Open a new shell and re-run ./setup.sh"
        ok "$label installed"
    else
        die "Run this, then re-run ./setup.sh:\n\n      $cmd"
    fi
}

printf '\n%s🎮 BMO setup%s\n%s' "$BOLD" "$RST" "$DIM"
printf '   %s\n%s' "$(pwd)" "$RST"

# ---------------------------------------------------------------- 1. system deps
step "Checking system dependencies"
require python3 "Python 3"
PY_OK=$(python3 -c 'import sys; print(1 if sys.version_info >= (3,10) else 0)' 2>/dev/null || echo 0)
[ "$PY_OK" = "1" ] || die "Python 3.10+ is required (found $(python3 -V 2>&1))."
ok "python3 $(python3 -V 2>&1 | cut -d' ' -f2)"

# venv is a separate package on Debian/Ubuntu and its absence only shows up at step 2.
if ! python3 -c 'import venv' >/dev/null 2>&1; then
    warn "The python3 venv module is missing."
    cmd="sudo apt-get install -y python3-venv"
    command -v apt-get >/dev/null || cmd=""
    if [ -n "$cmd" ] && confirm "Install python3-venv now?"; then
        eval "$cmd" || die "Install the venv module for your Python, then re-run ./setup.sh"
    else
        die "Install the venv module for your Python, then re-run ./setup.sh"
    fi
fi

# Vite 8 needs Node 20.19+ or 22.12+ just to build the UI; older versions die with a
# cryptic "does not provide an export named 'styleText'". Capacitor 8 (APK builds) needs 22.
node_ok() {
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);
             process.exit(a>22||(a===22&&b>=12)||(a===20&&b>=19)?0:1)' >/dev/null 2>&1
}
load_nvm() {
    export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use >/dev/null 2>&1
    return 0
}
# nvm installs per-user into ~/.nvm, no sudo. Used where the distro's Node is too old.
NVM_INSTALL="curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
install_node_nvm() {
    info "would run: $NVM_INSTALL && nvm install   (Node $(cat .nvmrc) into ~/.nvm, no sudo)"
    confirm "Install Node $(cat .nvmrc) with nvm now?" \
        || die "Install Node 22 (https://nodejs.org or nvm), then re-run ./setup.sh"
    if ! command -v nvm >/dev/null 2>&1 && [ ! -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
        bash -o pipefail -c "$NVM_INSTALL" || die "The nvm install failed. Install Node 22 yourself, then re-run."
    fi
    load_nvm
    nvm install || die "'nvm install' failed. Install Node 22 yourself, then re-run."
    nvm use >/dev/null
}

require curl "curl"
command -v node >/dev/null 2>&1 || load_nvm   # nvm users: node isn't on PATH in scripts
if ! command -v node >/dev/null 2>&1; then
    if command -v apt-get >/dev/null 2>&1 || [ -z "$(install_cmd node)" ]; then
        warn "Node.js is not installed."
        install_node_nvm
    else
        require node "Node.js"
    fi
fi
if ! node_ok; then
    load_nvm
    if ! node_ok; then
        warn "Node $(node -v) is too old to build the web UI (needs 20.19+ or 22.12+)."
        install_node_nvm
        node_ok || die "Still on Node $(node -v). Open a new shell (so nvm loads) and re-run ./setup.sh"
    fi
fi
NODE_MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 22 ]; then
    warn "Node $(node -v) builds the web app but is too old for the Android APK (needs 22)."
else
    ok "node $(node -v)"
fi
command -v npm >/dev/null 2>&1 || die "npm is missing even though node is installed. Install npm, then re-run."

if ! command -v ollama >/dev/null 2>&1 && [ "$(uname)" = "Linux" ]; then
    require zstd "zstd"   # Ollama's Linux installer needs it to unpack
fi
require ollama "Ollama"
ok "ollama present"

# ---------------------------------------------------------------- 2. python env
step "Python environment"
# A venv points at the Python that made it. After an OS upgrade (3.12 -> 3.14, say) that
# interpreter is gone and the venv is dead weight: reusing it fails at pip, confusingly.
if [ -d venv ] && ! ./venv/bin/python3 -c 'import sys' >/dev/null 2>&1; then
    stale="venv.stale-$(date +%Y%m%d%H%M%S)"
    mv venv "$stale"
    warn "venv/ was built for a Python that's no longer installed. Moved it to $stale/ (safe to delete)."
fi
if [ -d venv ]; then
    ok "venv/ already exists — reusing it"
else
    python3 -m venv venv || die "Could not create the virtualenv."
    ok "created venv/"
fi
info "installing requirements.txt (quiet; this can take a minute)"
./venv/bin/python3 -m pip install --quiet --upgrade pip >/dev/null 2>&1
./venv/bin/python3 -m pip install --quiet -r requirements.txt || die "pip install failed. Scroll up for the reason."
ok "python dependencies installed"

# ---------------------------------------------------------------- 3. node deps
step "Frontend dependencies"
# Native build deps (rolldown's binary) are picked per Node version, so a node_modules
# installed under an older Node breaks the build after an upgrade. Stamp it.
STAMP=node_modules/.bmo-node-version
if [ -d node_modules ] && [ package-lock.json -ot node_modules ] \
   && [ "$(cat "$STAMP" 2>/dev/null)" = "$(node -v)" ]; then
    ok "node_modules/ is up to date"
else
    # npm ci is exact-from-lockfile and wipes node_modules first, which is what a
    # reproducible install wants. It refuses to run if the lockfile is out of sync, so
    # fall back rather than dead-ending someone mid-setup.
    npm ci >/dev/null 2>&1 || npm install >/dev/null 2>&1 || die "npm install failed. Run 'npm install' to see why."
    node -v > "$STAMP"
    ok "node dependencies installed"
fi

# ---------------------------------------------------------------- 4. configuration
step "Configuration"
if [ -f .env ]; then
    ok ".env already exists — left untouched"
    # -E, not a BRE with \+: that's a GNU extension, and BSD grep (macOS) reads it as a
    # literal plus, so the check would silently never fire and a blank token go unwarned.
    if ! grep -qE '^(BMO_MASTER_TOKEN|API_TOKEN|VITE_BMO_API_KEY)=.+' .env; then
        warn "but BMO_MASTER_TOKEN looks empty. BMO will refuse to start."
        info "fix: put a random secret on that line (python3 -c \"import secrets;print(secrets.token_urlsafe(32))\")"
    fi
else
    cp .env.example .env || die "Could not create .env"
    python3 - <<'PY' || exit 1
import pathlib, re, secrets
env = pathlib.Path(".env")
env.write_text(re.sub(r"(?m)^BMO_MASTER_TOKEN=.*$",
                      "BMO_MASTER_TOKEN=" + secrets.token_urlsafe(32),
                      env.read_text()))
PY
    ok "created .env with a fresh API token"
fi

# ---------------------------------------------------------------- 5. model
step "Local model"
if ! curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null 2>&1; then
    info "starting ollama..."
    # Detached like wake-bmo.sh's server, so it outlives this terminal (no systemd on
    # WSL or in containers, where the installer can't start a service).
    if command -v setsid >/dev/null 2>&1; then SETSID=setsid; else SETSID=""; fi
    nohup $SETSID ollama serve >/dev/null 2>&1 & disown
    sleep 3
fi
if ! curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null 2>&1; then
    warn "Ollama isn't responding on :11434. Start it with 'ollama serve', then re-run."
elif curl -s http://localhost:11434/api/tags | grep -q '"name"'; then
    ok "a model is already installed"
elif [ "$SKIP_MODEL" = "1" ]; then
    warn "no model installed, skipping (--no-model). BMO can't answer until you pull one."
else
    warn "No Ollama model installed yet."
    info "qwen2.5:3b is ~2GB and is a good default on a 4GB GPU."
    if confirm "Download qwen2.5:3b now?"; then
        ollama pull qwen2.5:3b || warn "Pull failed — run 'ollama pull qwen2.5:3b' yourself."
    else
        warn "Skipped. Run 'ollama pull qwen2.5:3b' before starting BMO."
    fi
fi

# ---------------------------------------------------------------- 6. commit guard
step "Commit guard"
# BMO's auto-checkpoint stages everything with `git add -A`, and POST /v1/git/push
# commits and pushes to origin unattended — which is how 19 phone photos, GPS EXIF
# and all, once landed in this repo's history. githooks/pre-commit blocks image data
# by content. Only meaningful inside a git checkout, so skip it in a tarball install.
if [ -d .git ]; then
    if [ "$(git config core.hooksPath)" = "githooks" ]; then
        ok "commit guard already active"
    else
        git config core.hooksPath githooks && chmod +x githooks/pre-commit 2>/dev/null
        ok "commit guard installed (blocks committing photos; --no-verify overrides)"
    fi
else
    info "not a git checkout — skipping the commit guard"
fi

# ---------------------------------------------------------------- 7. build
step "Building the web UI"
if ! npm run build > .build.log 2>&1; then
    tail -n 20 .build.log | sed 's/^/    /'
    die "The frontend build failed (last lines above; full log in .build.log)."
fi
rm -f .build.log
ok "dist/ built"

# ---------------------------------------------------------------- 8. verify
step "Verifying"
# --install-only: the server isn't running yet on a first install, and reporting that as
# a failure made a good install exit 1 (and read as broken to scripts and agents).
./venv/bin/python3 scripts/check_setup.py --install-only
CHECK_RC=$?

printf '\n%s──────────────────────────────────────────────%s\n' "$DIM" "$RST"
if [ "$CHECK_RC" -eq 0 ]; then
    printf '%s🎮 BMO is installed.%s  Wake him, then run the full check:\n\n' "$BOLD" "$RST"
    printf '    ./wake-bmo.sh\n    ./venv/bin/python3 scripts/check_setup.py\n\n'
else
    printf '%sSetup finished, but the checks above failed.%s Fix them and re-run ./setup.sh\n\n' "$BOLD" "$RST"
fi
exit "$CHECK_RC"
