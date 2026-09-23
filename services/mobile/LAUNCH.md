# Launch the Kea Energy mobile app

This is the quick-start reference for developers and coding harnesses. The canonical
React Native app is this directory, `services/mobile`. Do not launch an older downloaded
ZIP or `work/mobile-latest` copy.

## Fastest path: Expo Go demo

Demo mode uses the app's built-in demonstration data and does not require the API.

From the repository root:

```powershell
cd services/mobile
npm ci
npm run start -- --lan --clear
```

Scan the terminal QR code with Expo Go. LAN mode is fastest when the phone and computer
are on the same ordinary Wi-Fi network.

If the Wi-Fi blocks devices from reaching each other, use an Expo tunnel instead:

```powershell
cd services/mobile
npx expo whoami
npm install --global @expo/ngrok@^4.1.0
npm run start -- --tunnel --clear --port 8082
```

Run `npx expo login` only when `npx expo whoami` reports that no Expo account is signed
in. Tunnel startup can take about a minute while Metro rebuilds its cache. Wait for both
`Tunnel ready` and an `exp://...exp.direct` address before giving the QR code to a tester.

## Choose the correct connection mode

| Situation | Command |
|---|---|
| Phone and computer on normal home Wi-Fi | `npm run start -- --lan --clear` |
| Campus, guest, hotel, or managed Wi-Fi | `npm run start -- --tunnel --clear --port 8082` |
| Android emulator | `npm run android` |
| iOS simulator on macOS | `npm run ios` |
| Browser-only layout check | `npm run web` |

Tunnel mode does not require the phone and computer to be on the same Wi-Fi. LAN mode
does. Do not use `localhost` as a physical phone's API address because it refers to the
phone itself.

## Run against the local API

The app stays in demo mode unless `EXPO_PUBLIC_USE_REAL_DATA` is explicitly set to
`true`. Start the API in a separate terminal, then launch Expo with the computer's Wi-Fi
address.

Windows PowerShell example:

```powershell
# Terminal 1, from the repository root
make api-dev

# Terminal 2, from services/mobile
$env:EXPO_PUBLIC_USE_REAL_DATA = "true"
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.50:8000"
npm run start -- --lan --clear
```

Replace `192.168.1.50` with the computer's active IPv4 address from:

```powershell
ipconfig
```

For persistent local values, copy `.env.example` to `.env.local` and edit the copy.
Never place private API keys or server secrets in an `EXPO_PUBLIC_*` variable because
Expo bundles those values into the client.

## Checks before handing the app to a tester

```powershell
npm run typecheck
npm run lint
npm test
```

Confirm that Metro is listening when a QR code does not open:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8081,8082 -ErrorAction SilentlyContinue
```

If Expo Go still shows an old bundle, stop Metro with `Ctrl+C`, close the project in
Expo Go, then restart with `--clear` and scan the new QR code.

## Windows/Codex Node fallback

If PowerShell cannot find `node` but the Codex bundled runtime is present, run Expo
directly with that runtime:

```powershell
$node = "C:\Users\Nzadi\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
& $node .\node_modules\expo\bin\cli start --tunnel --clear --port 8082
```

Run the command from `services/mobile`. Use the normal `npm run start` command whenever
Node is already on `PATH`.

## Files that stay local

Do not commit `node_modules/`, `.expo/`, `.env.local`, generated QR images, or Metro cache
files. Creating a new EAS project is not required for Expo Go development or this demo.
