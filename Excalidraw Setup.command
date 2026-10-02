#!/bin/zsh
cd -- "${0:A:h}" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  /usr/bin/osascript -e 'display dialog "Install Node.js 22 or newer, then run npm install in this project before opening setup again." buttons {"OK"} with title "Excalidraw Codeblocks"'
  exit 1
fi
node scripts/setup-mac.mjs
