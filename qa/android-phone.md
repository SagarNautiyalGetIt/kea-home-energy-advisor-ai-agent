# Android phone validation · KEA-246

This is the teammate runbook for [on-phone Sparky](../docs/design/on-phone-sparky.md) and [Home Visual Highlight](../services/mobile/src/components/visual-highlight.tsx). Use a **physical arm64 Android phone** and a native Kea development APK. Expo Go does not include the `llama.rn` inference library. Power Clash is already on `main`; its checks below cover integration with the two new features.

If you keep the source repository inside the Friday Vault, create an isolated checkout under `~/.cache/vault-builds/` first. `npm ci` and Expo prebuild generate many files and must stay outside the Vault.

The model is downloaded by the app after opt-in. It is **not** in the PR or APK. Allow at least 1 GiB free storage and use Wi-Fi for its 428,970,080-byte download. The current local model guard also requires at least 3 GiB reported RAM. A lower-capability phone should show an unsupported state and retain connected Sparky.

## 1. Prepare the machine and phone

Install Node/npm, JDK 17 or newer, the Android SDK command-line tools, Platform Tools (`adb`), and an Android NDK. Set `JAVA_HOME` and `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) and put their `bin`/`platform-tools` directories on `PATH`. The Expo-generated project requests NDK 27.1.12297006 by default. The helper can use a different **already installed** NDK with `--ndk-version=...`; this edits only ignored generated `android/build.gradle`.

On the phone, enable Developer options and USB debugging, connect by USB, and accept the computer's authorization prompt. Do this on a trusted machine. `doctor` refuses an unauthorized phone and requires `--serial=DEVICE` if more than one device is attached.

From this PR branch:

```bash
cd services/mobile
npm ci
npm test
npm run typecheck
npm run lint
npm run android:phone -- doctor
npm run android:phone -- build
npm run android:phone -- install
```

`build` runs Expo prebuild, installs/checks the SHA-256-pinned `llama.rn` native artifacts, assembles an **arm64-only** APK for a physical phone with at most two Gradle workers, and verifies `lib/arm64-v8a/librnllama.so` is packaged. The APK and generated `android/` directory stay untracked. Run lint/tests before the build, rather than at the same time on a memory-limited machine. If the default NDK is unavailable but 28.2.13676358 is installed, use `npm run android:phone -- build --ndk-version=28.2.13676358`. Check the installed version first; the helper refuses an absent NDK. `install` uses `adb install -r` and does not erase app data. If the phone has a differently signed Kea build, resolve that explicitly rather than silently uninstalling it.

To inspect an APK before installing, run `npm run android:phone -- verify-apk`. To verify a separately built APK, pass `--apk=/absolute/path/to/app-debug.apk`.

## 2. Start the demo API and Metro

Use a synthetic account only. In a separate terminal at the repository root, create the API virtual environment outside the repository, then bind the demo API to the trusted local network:

```bash
task_api_venv="${XDG_CACHE_HOME:-$HOME/.cache}/vault-builds/kea-agent/api-venv"
python3 -m venv "$task_api_venv"
"$task_api_venv/bin/pip" install -e 'services/api[dev]'
KEA_DEMO_LOGINS=1 KEA_PERSIST=0 PYTHONPATH="$PWD/services/api" \
  "$task_api_venv/bin/uvicorn" app.main:app \
  --host 0.0.0.0 --port 8000
```

Stop the API after testing. Do not expose this demo server on an untrusted network. If `pip install -e` fails because the machine cannot resolve dependencies, use the repository's documented API setup path in `STARTUP.md` and record the deviation.

In a third terminal, set the API origin using the computer's LAN address. The command asks for the exact address, so there is no copyable fake value:

```bash
cd services/mobile
printf 'Phone-reachable API origin (http://LAN-IP:8000): '
IFS= read -r EXPO_PUBLIC_API_URL
export EXPO_PUBLIC_API_URL
npm run android:phone -- doctor
npm run start -- --dev-client --lan
```

Open `http://<the-entered-LAN-IP>:8000/api/health` in the **phone browser** too. The helper's health check only proves the computer can reach the API. Open the installed Kea app, select the Metro development server, and sign in with the synthetic July demo account from the root README. If the app cannot reach Metro, check that both devices are on the same Wi-Fi and that the phone can open the API health URL. Do not put credentials or API keys in `EXPO_PUBLIC_` variables.

## 3. Record phone results

For each screen, tap through at a normal pace and then repeat with Android **Remove animations** enabled in Accessibility settings. Take screenshots with `npm run android:phone -- screenshot`; they are saved only under `~/.cache/kea-energy/android-evidence/`. Review screenshots before sharing, as they can contain account content.

| Check | Expected result |
| --- | --- |
| Home visual highlight | Tap Solar, Home, EV, Battery, then Grid source cards. Only the corresponding scene element gains a gentle pulse. Solar is green, battery blue, grid amber; paths stay aligned with the house illustration. The selected card and scene agree. |
| Visual accessibility | Labels remain readable, the selected source is identifiable without color alone, and reduced motion avoids a distracting pulse. Check a narrow phone and landscape/rotation behavior where supported. |
| Power Clash | Open from Home; suburb and category selection update the sample rank/score explanation together, with selection haptics. Location denial still allows manual demo suburb selection. No real credit or verified carbon claim is presented. |
| On-phone Sparky install | Settings → Sparky AI shows capability and model status. Opt in and install over Wi-Fi; progress, verification, installed, remove, and update states are visible. A cancelled or interrupted install does not claim readiness. |
| Offline general question | After the model is installed, disconnect network access and ask a general energy education question. The answer is labelled **On this phone · general guidance · no account data**. Record response latency and any memory/thermal issue. |
| Offline account question | While offline, ask about this account's bill, tariff, meter, carbon offset, or reward. Kea must say it cannot verify that account answer offline; it must not invent figures. Reconnect and check the normal API path separately. |

For each animated screen, reset Android frame counters, interact for at least 20 seconds, then collect the frame summary:

```bash
npm run android:phone -- frames-start
npm run android:phone -- frames-report
```

The JSON report stays beside the screenshots. Record device refresh rate and test conditions. The report shows Android UI frame durations against a 16.67 ms budget; it does **not** by itself prove end-to-end 60 fps or JS responsiveness. Capture a screen recording and inspect any visible stutter before making a smoothness claim.

## 4. Paste this result into the PR

```text
Tester / second machine:
Commit SHA:
Phone model, Android version, ABI, RAM, free storage, refresh rate:
Build command and installed NDK:
APK native-library verification: PASS / FAIL
API and Metro reachable from phone: PASS / FAIL
Home highlight (Solar / Home / EV / Battery / Grid):
Reduced motion and haptics:
Power Clash and location-denied fallback:
Sparky model download, SHA verification, cancel, update, remove:
Offline general response and time to first answer:
Offline account-question boundary:
Frame report path / median / p95 / over-budget percent:
Screenshot or recording links after privacy review:
Failures, reproduction steps, and device logs with personal data removed:
```

Do not check the physical-device or second-machine boxes on the PR until another teammate supplies the evidence. This runbook does not validate iOS or production account data.
