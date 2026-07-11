#!/usr/bin/env bash
#
# PDF Annotation Tool — Linux install-from-source script.
#
# Clones the repository from GitHub, installs npm dependencies, and compiles
# the Linux app (AppImage + .deb) entirely on your machine. Everything runs
# offline once dependencies are fetched.
#
# Quick start:
#
#   curl -fsSL https://raw.githubusercontent.com/pjb-auto/pdf-annotation-tool/main/scripts/install-linux.sh | bash
#
# Options (environment variables):
#   PDFTOOL_REPO    Git URL to clone            (default: the URL baked in below)
#   PDFTOOL_BRANCH  Branch/tag to check out     (default: main)
#   PDFTOOL_DIR     Target directory            (default: $HOME/pdf-annotation-tool)
#   PDFTOOL_MODE    "build" or "run"            (default: build)
#
# Examples:
#   PDFTOOL_MODE=run bash install-linux.sh
#   PDFTOOL_REPO=https://github.com/me/pdf-tool.git bash install-linux.sh

set -euo pipefail

# ---- Configuration -----------------------------------------------------------
REPO_URL="${PDFTOOL_REPO:-https://github.com/pjb-auto/pdf-annotation-tool.git}"
BRANCH="${PDFTOOL_BRANCH:-main}"
TARGET_DIR="${PDFTOOL_DIR:-$HOME/pdf-annotation-tool}"
MODE="${PDFTOOL_MODE:-build}"
MIN_NODE_MAJOR=18

# ---- Pretty output -----------------------------------------------------------
bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '\033[1;34m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[1;33m warning:\033[0m %s\n' "$1"; }
die()  { printf '\033[1;31m error:\033[0m %s\n' "$1" >&2; exit 1; }

# ---- Detect the system package manager --------------------------------------
detect_pm() {
  if   command -v apt-get >/dev/null 2>&1; then echo "apt";    return; fi
  if   command -v dnf     >/dev/null 2>&1; then echo "dnf";    return; fi
  if   command -v pacman  >/dev/null 2>&1; then echo "pacman"; return; fi
  if   command -v zypper  >/dev/null 2>&1; then echo "zypper"; return; fi
}

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
  SUDO="sudo"
fi

pm_install() {
  local pm="$1"; shift
  case "$pm" in
    apt)    $SUDO apt-get update -y && $SUDO apt-get install -y "$@" ;;
    dnf)    $SUDO dnf install -y "$@" ;;
    pacman) $SUDO pacman -Sy --noconfirm "$@" ;;
    zypper) $SUDO zypper install -y "$@" ;;
    *)      return 1 ;;
  esac
}

PM="$(detect_pm || true)"

# ---- Ensure git --------------------------------------------------------------
ensure_git() {
  if command -v git >/dev/null 2>&1; then return; fi
  info "git not found — attempting to install it"
  [ -n "$PM" ] && pm_install "$PM" git || die "Please install 'git' and re-run."
  command -v git >/dev/null 2>&1 || die "git installation failed. Install it manually and re-run."
}

# ---- Ensure Node.js >= MIN_NODE_MAJOR ---------------------------------------
node_major() {
  command -v node >/dev/null 2>&1 || { echo 0; return; }
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0
}

ensure_node() {
  local major; major="$(node_major)"
  if [ "$major" -ge "$MIN_NODE_MAJOR" ]; then
    info "Node.js $(node -v) detected"
    return
  fi

  info "Node.js >= ${MIN_NODE_MAJOR} required (found: $(command -v node >/dev/null 2>&1 && node -v || echo 'none'))"
  case "$PM" in
    apt)    pm_install apt nodejs npm || true ;;
    dnf)    pm_install dnf nodejs npm || true ;;
    pacman) pm_install pacman nodejs npm || true ;;
    zypper) pm_install zypper nodejs npm || true ;;
  esac

  major="$(node_major)"
  if [ "$major" -lt "$MIN_NODE_MAJOR" ]; then
    cat <<EOF

$(warn "Your distro's Node.js is missing or too old.")
Install Node.js ${MIN_NODE_MAJOR}+ using one of:

  • nvm (recommended, no root):
      curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
      exec \$SHELL -l
      nvm install --lts

  • NodeSource (Debian/Ubuntu):
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs

Then re-run this script.
EOF
    die "Node.js ${MIN_NODE_MAJOR}+ is required."
  fi
  info "Node.js $(node -v) ready"
}

# ---- Clone or update the repository -----------------------------------------
fetch_source() {
  if [ -d "$TARGET_DIR/.git" ]; then
    info "Updating existing checkout in $TARGET_DIR"
    git -C "$TARGET_DIR" fetch --depth 1 origin "$BRANCH"
    git -C "$TARGET_DIR" checkout "$BRANCH"
    git -C "$TARGET_DIR" reset --hard "origin/$BRANCH"
  else
    info "Cloning $REPO_URL (branch: $BRANCH) into $TARGET_DIR"
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$TARGET_DIR"
  fi
}

# ---- Install dependencies ----------------------------------------------------
install_deps() {
  info "Installing npm dependencies (this may take a minute)"
  cd "$TARGET_DIR"
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
}

# ---- Build or run ------------------------------------------------------------
build_app() {
  info "Building Linux artifacts (AppImage + .deb)"
  cd "$TARGET_DIR"
  npm run build:linux

  echo
  bold "Build complete. Artifacts in $TARGET_DIR/dist:"
  ls -1 "$TARGET_DIR/dist" 2>/dev/null | sed 's/^/  /' || true
  cat <<EOF

Run the portable AppImage:
  chmod +x "$TARGET_DIR"/dist/*.AppImage
  "$TARGET_DIR"/dist/*.AppImage

(If the AppImage complains about FUSE, install it — e.g. 'sudo apt-get install libfuse2' —
 or run with: ./PDF-Annotation-Tool-*.AppImage --appimage-extract-and-run)

Or install the .deb system-wide (Debian/Ubuntu):
  sudo apt install "$TARGET_DIR"/dist/*.deb
EOF
}

run_app() {
  info "Launching the app from source"
  cd "$TARGET_DIR"
  npm start
}

# ---- Main --------------------------------------------------------------------
main() {
  bold "PDF Annotation Tool — Linux installer"
  [ -n "$PM" ] && info "Package manager: $PM" || warn "No known package manager detected; auto-install of git/node is disabled."

  ensure_git
  ensure_node
  fetch_source
  install_deps

  case "$MODE" in
    run)   run_app ;;
    build) build_app ;;
    *)     die "Unknown PDFTOOL_MODE='$MODE' (expected 'build' or 'run')." ;;
  esac
}

main "$@"
