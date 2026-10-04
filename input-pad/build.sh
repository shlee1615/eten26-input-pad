#!/bin/zsh
set -eu
PAD_ROOT="${0:A:h}"
PROJECT_ROOT="${PAD_ROOT:h}"
UPSTREAM="$PROJECT_ROOT/vendor/McBopomofoWeb"
APP="$PROJECT_ROOT/build/倚天26輸入便箋.app"
if [[ ! -d "$UPSTREAM/node_modules" ]]; then
  (cd "$UPSTREAM"; npm ci --ignore-scripts --no-audit --no-fund)
fi
(cd "$UPSTREAM"; npm run build)
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
PAD_ARCH="$(uname -m)"
swiftc -O -target "$PAD_ARCH-apple-macos13.0" "$PAD_ROOT/main.swift" "$PAD_ROOT/settings-store.swift" "$PAD_ROOT/delivery-flow.swift" "$PAD_ROOT/return-policy.swift" "$PAD_ROOT/return-controller.swift" -o "$APP/Contents/MacOS/InputPad" -framework AppKit -framework WebKit -framework ApplicationServices
cp "$PAD_ROOT/index.html" "$PAD_ROOT/pad.css" "$PAD_ROOT/pad.js" "$PAD_ROOT/pad-core.js" "$APP/Contents/Resources/"
cp "$PAD_ROOT/pad-settings.js" "$PAD_ROOT/settings.html" "$PAD_ROOT/settings.js" "$PAD_ROOT/settings.css" "$PAD_ROOT/fonts.css" "$APP/Contents/Resources/"
cp "$PAD_ROOT/return-ui.js" "$APP/Contents/Resources/"
ditto "$PAD_ROOT/fonts" "$APP/Contents/Resources/fonts"
cp "$UPSTREAM/output/example/bundle.js" "$APP/Contents/Resources/"
cp "$UPSTREAM/output/example/bundle.js.LICENSE.txt" "$APP/Contents/Resources/Bundle-Licenses.txt"
cp "$UPSTREAM/LICENSE.txt" "$APP/Contents/Resources/McBopomofoWeb-LICENSE.txt"
mkdir -p "$APP/Contents/Resources/ThirdPartyLicenses"
for dependency in chinese_convert dayjs lodash lunar-typescript lz-string; do
  cp "$UPSTREAM/node_modules/$dependency/LICENSE" "$APP/Contents/Resources/ThirdPartyLicenses/$dependency.txt"
done
cp "$PAD_ROOT/使用說明.txt" "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>InputPad</string>
<key>CFBundleIdentifier</key><string>local.samlee.eten26pad</string>
<key>CFBundleName</key><string>倚天26輸入便箋</string>
<key>CFBundleDisplayName</key><string>倚天26輸入便箋</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.4.0</string>
<key>CFBundleVersion</key><string>9</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
PLIST
codesign --force --sign - "$APP"
print -r -- "$APP"
