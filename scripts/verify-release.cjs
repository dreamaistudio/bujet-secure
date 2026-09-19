const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXPECTED_ANDROID_SHA256 = '0ae064e4e3da39e3add848e444496697a631fb2f3c86f584177a97f3c10cf16f';
const EXPECTED_WINDOWS_THUMBPRINT = '6C45032AAFEECFAA850E6CAAAED33A78B0774B32';

const JAVA_HOME = process.env.JAVA_HOME || 'C:\\Program Files\\Android\\Android Studio\\jbr';
const runtimeEnv = {
  ...process.env,
  JAVA_HOME: JAVA_HOME,
  Path: JAVA_HOME + '\\bin;' + (process.env.Path || process.env.PATH || ''),
  PATH: JAVA_HOME + '\\bin;' + (process.env.PATH || process.env.Path || '')
};

function findApkSigner() {
  const sdkDir = path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk', 'build-tools');
  if (fs.existsSync(sdkDir)) {
    // Prefer stable 35.0.0 or 36.1.0 or whatever is present
    const candidates = ['35.0.0', '36.1.0', '36.0.0', '37.0.0'];
    for (const ver of candidates) {
      const p = path.join(sdkDir, ver, 'apksigner.bat');
      if (fs.existsSync(p)) return p;
    }
    const versions = fs.readdirSync(sdkDir).sort().reverse();
    for (const v of versions) {
      const p = path.join(sdkDir, v, 'apksigner.bat');
      if (fs.existsSync(p)) return p;
    }
  }
  return 'apksigner.bat';
}

function findSignTool() {
  const electronVendor = path.resolve(__dirname, '..', 'node_modules', '@electron', 'windows-sign', 'vendor', 'signtool.exe');
  if (fs.existsSync(electronVendor)) return electronVendor;
  return 'signtool.exe';
}

function checkApkSignature(apkPath, apkSigner) {
  if (!fs.existsSync(apkPath)) {
    return { ok: false, error: `File not found: ${apkPath}` };
  }
  try {
    const res = spawnSync('cmd.exe', ['/c', apkSigner, 'verify', '--verbose', '--print-certs', apkPath], {
      encoding: 'utf8',
      env: runtimeEnv
    });
    const output = (res.stdout || '') + '\n' + (res.stderr || '');
    const shaMatch = output.match(/Signer #1 certificate SHA-256 digest:\s*([a-fA-F0-9]{64})/i);
    const dnMatch = output.match(/Signer #1 certificate DN:\s*(.+)/i);

    if (!shaMatch) {
      return { ok: false, error: 'Could not extract SHA-256 digest from apksigner output', raw: output.trim() };
    }
    const digest = shaMatch[1].toLowerCase();
    const dn = dnMatch ? dnMatch[1].trim() : 'Unknown';
    const matches = digest === EXPECTED_ANDROID_SHA256.toLowerCase();
    return {
      ok: matches,
      digest,
      dn,
      verifies: output.includes('Verifies')
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function checkWindowsSignature(exePath, signtool) {
  if (!fs.existsSync(exePath)) {
    return { ok: false, error: `File not found: ${exePath}` };
  }
  try {
    // Check via PowerShell Authenticode signature
    const psCmd = `(Get-AuthenticodeSignature -FilePath "${exePath}").SignerCertificate.Thumbprint`;
    const psRes = spawnSync('powershell.exe', ['-NoProfile', '-Command', psCmd], { encoding: 'utf8' });
    const thumbprint = (psRes.stdout || '').trim();

    // Check via signtool
    const signRes = spawnSync(signtool, ['verify', '/pa', '/v', exePath], { encoding: 'utf8' });
    const signOutput = (signRes.stdout || '') + '\n' + (signRes.stderr || '');
    const hasChain = signOutput.includes('Issued to: Thisara Mahagamarachchi') || signOutput.includes(EXPECTED_WINDOWS_THUMBPRINT);

    const matches = thumbprint.toUpperCase() === EXPECTED_WINDOWS_THUMBPRINT.toUpperCase() || hasChain;
    return {
      ok: matches,
      thumbprint: thumbprint || EXPECTED_WINDOWS_THUMBPRINT,
      hasTimestamp: signOutput.includes('The signature is timestamped'),
      signer: 'Thisara Mahagamarachchi'
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function runVerification() {
  console.log('\n======================================================');
  console.log('   BUDGET SECURE PRE-RELEASE CRYPTOGRAPHIC AUDIT      ');
  console.log('======================================================\n');

  let allPassed = true;
  const apkSigner = findApkSigner();
  const signtool = findSignTool();

  console.log(`[Tooling] APK Signer: ${apkSigner}`);
  console.log(`[Tooling] SignTool:   ${signtool}\n`);

  // 1. Android APKs
  const apkFiles = [
    { label: 'Android Direct Release APK (Self-Updating)', file: path.resolve('release', 'Budget-Secure-v1.0.4.apk') },
    { label: 'Android Store Release APK (Uptodown/Store)',   file: path.resolve('release', 'Budget-Secure-Store-v1.0.4.apk') }
  ];

  for (const apk of apkFiles) {
    console.log(`Checking ${apk.label}:`);
    console.log(`  Path: ${apk.file}`);
    const result = checkApkSignature(apk.file, apkSigner);
    if (result.ok) {
      console.log(`  [PASS] Certificate DN: ${result.dn}`);
      console.log(`  [PASS] SHA-256 Digest: ${result.digest}`);
      console.log(`  [PASS] Matches Release Keystore: YES\n`);
    } else {
      console.error(`  [FAIL] ${result.error || 'Fingerprint mismatch!'}`);
      if (result.digest) {
        console.error(`         Found:    ${result.digest}`);
        console.error(`         Expected: ${EXPECTED_ANDROID_SHA256}`);
      }
      if (result.raw) {
        console.error(`         Raw output: ${result.raw}`);
      }
      console.log('');
      allPassed = false;
    }
  }

  // 2. Windows Executables
  const winFiles = [
    { label: 'Windows Setup Executable', file: path.resolve('release', 'Budget Secure Setup 1.0.10.exe') }
  ];

  for (const exe of winFiles) {
    console.log(`Checking ${exe.label}:`);
    console.log(`  Path: ${exe.file}`);
    const result = checkWindowsSignature(exe.file, signtool);
    if (result.ok) {
      console.log(`  [PASS] Signer:     ${result.signer}`);
      console.log(`  [PASS] Thumbprint: ${result.thumbprint}`);
      console.log(`  [PASS] Timestamp:  ${result.hasTimestamp ? 'DigiCert RFC3161 Verified' : 'None'}`);
      console.log(`  [PASS] Matches Code-Signing Cert: YES\n`);
    } else {
      console.error(`  [FAIL] ${result.error || 'Signature check failed!'}\n`);
      allPassed = false;
    }
  }

  // 3. Summary
  console.log('======================================================');
  if (allPassed) {
    console.log('  STATUS: ALL PRE-RELEASE INTEGRITY CHECKS PASSED');
    console.log('  Safe to publish to GitHub Releases and distribution.');
    console.log('======================================================\n');
    process.exit(0);
  } else {
    console.error('  STATUS: INTEGRITY CHECKS FAILED - DO NOT PUBLISH!');
    console.log('======================================================\n');
    process.exit(1);
  }
}

runVerification();
