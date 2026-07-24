#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
MACOS_DIR="$PROJECT_DIR/macos"
OUTPUT_DIR="$MACOS_DIR/build"
DERIVED_DIR="$MACOS_DIR/.derivedData"

XCODEBUILD=$(command -v xcodebuild || true)
if [ -z "$XCODEBUILD" ] || ! "$XCODEBUILD" -version >/dev/null 2>&1; then
  XCODEBUILD=""
  for candidate in \
    "/Applications/Xcode.app" \
    "/Applications/Xcode-beta.app" \
    "$HOME/Applications/Xcode.app" \
    "$HOME/Applications/Xcode-beta.app" \
    "$HOME"/Downloads/Xcode*.app
  do
    tool="$candidate/Contents/Developer/usr/bin/xcodebuild"
    if [ -x "$tool" ]; then
      XCODEBUILD="$tool"
      break
    fi
  done
fi

if [ -z "$XCODEBUILD" ]; then
  echo "Полный Xcode не найден. Установите Xcode или укажите его через xcode-select." >&2
  exit 1
fi

cd "$PROJECT_DIR"
npm run macos:sync
mkdir -p "$OUTPUT_DIR"

"$XCODEBUILD" \
  -project "$MACOS_DIR/openhand.xcodeproj" \
  -scheme openhand \
  -configuration Release \
  -derivedDataPath "$DERIVED_DIR" \
  CONFIGURATION_BUILD_DIR="$OUTPUT_DIR" \
  ARCHS="arm64 x86_64" \
  ONLY_ACTIVE_ARCH=NO \
  CODE_SIGNING_ALLOWED=NO \
  build

/usr/bin/codesign --force --deep --sign - "$OUTPUT_DIR/OpenHand.app"
/usr/bin/codesign --verify --deep --strict "$OUTPUT_DIR/OpenHand.app"

echo "Готово: $OUTPUT_DIR/OpenHand.app"
