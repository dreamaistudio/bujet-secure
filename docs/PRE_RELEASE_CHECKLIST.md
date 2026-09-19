# Budget Secure — Standing Pre-Release Checklist Protocol

This mandatory checklist must be executed before publishing **any** release of Budget Secure (Android or Windows).

---

## 1. Automated Cryptographic Audit

Run the pre-release cryptographic audit command:

```bash
npm run verify:release
# or
node scripts/verify-release.cjs
```

The script verifies:
- **Android Direct Release APK** is signed with `release.keystore` (`SHA-256: 0ae064e4e3da39e3add848e444496697a631fb2f3c86f584177a97f3c10cf16f`).
- **Android Store Release APK** is signed with the **exact same** `release.keystore` (`SHA-256: 0ae064e4e3da39e3add848e444496697a631fb2f3c86f584177a97f3c10cf16f`).
- **Windows Executable (`.exe`)** has a valid Authenticode signature from `Thisara Mahagamarachchi` (`Thumbprint: 6C45032AAFEECFAA850E6CAAAED33A78B0774B32`) and RFC 3161 timestamp.

> [!CAUTION]
> **Zero Tolerance Policy**: If `npm run verify:release` reports any failure or mismatch, **DO NOT PUBLISH** under any circumstance. Investigate and resolve signing errors first.

---

## 2. Android Pre-Release Protocol

### Step 2.1: Version Verification
Check [android/app/build.gradle](file:///c:/Users/thisara/Desktop/Android%20works/bujet%20plan%20app/android/app/build.gradle):
- `versionCode` has been incremented monotonically (e.g., `4` -> `5`).
- `versionName` matches the intended semver release tag (e.g., `"1.0.4"`).

Verify APK badging via `aapt2`:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\aapt2.exe" dump badging release\Budget-Secure-v1.0.4.apk | Select-String "package: "
```

### Step 2.2: Test Device Signature Continuity Check
> [!IMPORTANT]
> **Never mix Debug and Release builds on a test phone!**
> Android's `PackageManager` strictly forbids upgrading an app signed with `debug.keystore` using an APK signed with `release.keystore` (or vice-versa), throwing:
> `INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package com.thisara.budgetsecure signatures do not match previously installed version; ignoring!`
> This presents on device screens as *"App not installed as package conflicts with an existing package"*.

- **If the phone previously ran a debug build** (`assembleDebug`, `npx cap run`):
  Uninstall the old app completely from the test device once:
  ```bash
  adb uninstall com.thisara.budgetsecure
  ```
- **If testing an in-place upgrade**:
  Install the previous release APK first (e.g. v1.0.3), then install the new release APK (v1.0.4) on top using `adb install -r release\Budget-Secure-v1.0.4.apk`. Verify the upgrade succeeds without prompt or data loss.

### Step 2.3: Flavors & Distribution Targets
- **Direct Flavor APK** (`release/Budget-Secure-v1.0.X.apk`):
  - Target: Published to **GitHub Releases** for direct sideloading and in-app self-updating.
- **Store Flavor APK** (`release/Budget-Secure-Store-v1.0.X.apk`):
  - Target: Uploaded to **Uptodown App Store** and other third-party stores (omits self-update checks).
- **Store Flavor AAB** (`release/Budget-Secure-Store-v1.0.X.aab`):
  - Target: Uploaded to **Google Play Console**.

---

## 3. Windows Pre-Release Protocol

### Step 3.1: Authenticode & Timestamp Verification
Check signature status using PowerShell:
```powershell
Get-AuthenticodeSignature "release\Budget Secure Setup *.exe"
```
Or with SignTool:
```powershell
& "node_modules\@electron\windows-sign\vendor\signtool.exe" verify /pa /v "release\Budget Secure Setup *.exe"
```

### Step 3.2: SmartScreen Expectations
- The Windows installer is signed with a local developer certificate (`bujet_signing_cert.pfx`).
- When downloaded via a browser, Windows tags the installer with the *Mark of the Web* (`ZoneId=3`).
- Because it is not an expensive commercial EV certificate, Windows Defender SmartScreen displays:
  *"Windows protected your PC — Microsoft Defender SmartScreen prevented an unrecognized app from starting"*.
- **This is expected and normal behavior**. Users follow [INSTALLATION_GUIDE.md](../INSTALLATION_GUIDE.md) (*More info -> Run anyway*).
- Confirm the executable is properly signed and timestamped so it is **never** treated as an untrusted unsigned binary.

---

## 4. Release Checklist Sign-Off

| Check | Requirement | Verified By |
| :--- | :--- | :--- |
| [ ] | `npm run build && npx cap copy android` executed | Build pipeline |
| [ ] | Both direct and store release APKs compiled cleanly | Gradle |
| [ ] | `npm run verify:release` passes with 0 errors | Pre-release script |
| [ ] | SHA-256 fingerprints match `0ae064e4e3da39e3add848e444496697a631fb2f3c86f584177a97f3c10cf16f` | `apksigner` |
| [ ] | In-place upgrade tested on Android test device | QA / Manual Test |
| [ ] | Windows Setup `.exe` Authenticode thumbprint matches `6C45032AAFEECFAA850E6CAAAED33A78B0774B32` | `signtool` |
| [ ] | GitHub Release published with correct version tag and release notes | GitHub |
| [ ] | Store APK delivered for Uptodown upload | Distribution |
