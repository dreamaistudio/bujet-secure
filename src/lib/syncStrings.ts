/**
 * Single source of truth for all user-facing strings in the QR sync pairing guide.
 * Exported as a plain object so the whole guide can later be translated (e.g. to Sinhala)
 * by editing this single file.
 *
 * Rules:
 * - NO technical jargon (no WebSocket, LAN, socket, delta, protocol, payload, 127.0.0.1, token, error codes).
 * - Short sentences. One idea per line.
 * - Every error message tells the user what to DO.
 * - No Windows/firewall copy on Android.
 */
export const syncStrings = {
  desktop: {
    panelTitle: "Connect Your Phone",
    panelSubtitle: "Follow these steps to connect your phone to this computer over Wi-Fi.",

    // Step 1
    step1Title: "Connect both devices to the same Wi-Fi",
    step1PcOn: "This PC is on:",
    step1SameWifiNote: "Your phone must be on this same Wi-Fi network.",
    step1Satisfied: "Network detected",
    step1Warning: "No Wi-Fi or network connection detected. Connect this PC to Wi-Fi to continue.",

    // Step 2
    step2Title: "Allow Budget Secure through Windows Firewall",
    step2Allowed: "Allowed",
    step2Instruction: "Windows must allow your phone to reach this PC. Click Allow — you'll see a Windows permission popup, choose Yes.",
    step2Button: "Allow in Firewall",
    step2Allowing: "Allowing...",
    // Shown above the paired card when Windows is the reason the phone cannot
    // reach this PC directly
    firewallAwayTitle: "Windows Firewall is blocking the direct link",
    firewallAwayInstruction: "Even on the same Wi-Fi, Windows can stop your phone from reaching this PC directly, so changes take the slower way through the internet. Click Allow — you'll see a Windows permission popup, choose Yes.",

    // Step 3
    step3Title: "Open Budget Secure on your phone",
    step3Instruction: "Install Budget Secure on your Android phone if you haven't yet, then open it.",

    // Step 4
    step4Title: "On your phone: Settings > Connect to PC > Scan QR Code",
    step4Instruction: "Follow these steps on your phone while looking at this screen.",

    // Step 5
    step5Title: "Point your phone camera at this QR code",
    step5Distance: "Hold your phone about 20-30 cm from the screen.",
    step5CantScan: "Can't scan the code?",
    step5ManualHeading: "Type these into your phone under Settings > Connect to PC > Enter manually.",
    step5IpLabel: "IP address",
    step5PortLabel: "Port",
    step5CodeLabel: "Code",
    copy: "Copy",
    copied: "Copied",

    // Connected State
    connectedTitle: "Phone connected",
    deviceCountSingle: "1 phone connected",
    deviceCountMultiple: "phones connected",
    lastSynced: "Last synced",
    justNow: "Just now",
    autoUpdateNotice: "Your phone and PC now update each other automatically.",
    disconnectButton: "Unpair all phones",
    disconnectConfirm: "Unpair all phones? Every phone will need to scan the QR code again before it can sync.",
    connectAnotherPhone: "Connect another phone",
    backToStatus: "Back to connected view",

    // Paired, but the phone is away from this Wi-Fi (reached over the internet)
    awayTitle: "Phone paired — connected over the internet",
    awayBadge: "Paired · over the internet",
    awayNotice: "Your phone isn't on this Wi-Fi right now. Changes travel through the internet instead and can take up to a minute to appear.",
    awayLastHeard: "Last heard from phone",
    awayAddAnotherBanner: "A phone is paired over the internet. Pair an additional device below:",

    // First screen (before a PIN is set): use the phone's setup instead
    firstRunEntryQuestion: "Already using Budget Secure on your phone?",
    firstRunEntryLabel: "Connect to mobile",
    firstRunConnectTitle: "Connect to mobile",
    firstRunConnectNote: "On your phone, open Budget Secure, go to Settings and tap \"Connect to PC\", then scan the code below. This computer will then use the same PIN, ledger names and records as your phone, so there is nothing more to set up here.",
    firstRunConnectNotReady: "This computer is still getting ready. Wait a moment, then close this and try again.",
  },

  mobile: {
    entryLabel: "Connect to PC",
    entrySubtitleConnected: "Connected to your PC",
    entrySubtitleDisconnected: "Sync with your computer over Wi-Fi",

    // Screen 1: Connect to your computer
    screen1Title: "Connect to your computer",
    screen1Bullet1: "Open Budget Secure on your PC",
    screen1Bullet2: "Go to Settings > Mobile Device Sync",
    screen1Bullet3: "Make sure your phone and PC are on the same Wi-Fi",
    screen1PhoneOn: "This phone is on:",
    screen1WifiUnknown: "Make sure your phone's Wi-Fi is turned on.",
    screen1Next: "Next",

    // Screen 2: Scan the code on your PC
    screen2Title: "Scan the code on your PC",
    screen2OpenCamera: "Open Camera",
    screen2ManualLink: "Enter code manually",
    screen2PermissionExplain: "Budget Secure needs your camera to read the code on your PC screen. It is only used for this.",
    screen2PermissionDenied: "Camera access is turned off. Open Settings to allow it.",
    screen2OpenSettings: "Open Settings",
    screen2Continue: "Continue",

    // Screen 3: Scanner view
    screen3Caption: "Point at the QR code on your PC screen",
    screen3Cancel: "Cancel",
    screen3InvalidToast: "That's not a Budget Secure code — try again",

    // Screen 3b: Manual entry
    screen3bTitle: "Enter details manually",
    screen3bIpLabel: "IP address",
    screen3bIpPlaceholder: "e.g. 192.168.1.4",
    screen3bIpInvalid: "That doesn't look like an IP address — it should look like 192.168.1.4",
    screen3bIpRequired: "Please enter your PC's IP address.",
    screen3bPortLabel: "Port",
    screen3bPortInvalid: "Port must be a number like 3001.",
    screen3bCodeLabel: "Code",
    screen3bCodeRequired: "Please enter the code shown on your PC.",
    screen3bConnect: "Connect",
    screen3bBackToScan: "Scan QR code instead",

    // Screen 4: Connecting
    screen4Connecting: "Connecting to your PC…",
    screen4TryAgain: "Try Again",
    screen4Back: "Back",
    screen4Unreachable: "Can't find your PC. Check that both devices are on the same Wi-Fi and that Budget Secure is open on your PC.",
    screen4AuthRejected: "That code didn't work. Get a fresh code from your PC and try again.",
    screen4Timeout: "Your PC didn't answer. Make sure Budget Secure is open on your PC, and that you clicked Allow on the computer's permission popup.",

    // Screen 5: Success
    screen5Title: "Connected to your PC",
    screen5Desc: "Anything you add on your phone now appears on your PC, and anything you add on your PC appears here.",
    screen5Done: "Done",

    // Paired Status Screen
    statusTitle: "Connected to your PC",
    statusConnectedState: "Connected",
    statusSyncingState: "Updating...",
    statusConnectingState: "Connecting...",
    statusOfflineState: "Waiting for Wi-Fi",
    statusAddressLabel: "Computer address",
    statusLastSynced: "Last synced",
    statusAutoSyncNote: "Your phone and PC update each other automatically whenever they are on the same Wi-Fi.",
    disconnectButton: "Disconnect",
    disconnectDialogTitle: "Disconnect from your PC?",
    disconnectDialogMessage: "Disconnect from your PC? Your data stays on this phone, but the two devices will stop updating each other. You can connect again any time.",
    disconnectConfirm: "Disconnect",
    disconnectCancel: "Cancel",
    backButton: "Back",
  },

  troubleshooting: {
    linkText: "Having trouble?",
    title: "Help & Troubleshooting",
    closeText: "Close",

    q1: "My phone can't find my PC",
    a1Desktop: [
      "Make sure both are on the same Wi-Fi network (not mobile data on the phone, and not a guest Wi-Fi network).",
      "Make sure Budget Secure is open on your PC.",
      "On your PC, click \"Allow in Firewall\" in the sync section and choose Yes on the Windows popup.",
      "Try turning your phone's Wi-Fi off and on again."
    ],
    a1Mobile: [
      "Make sure both are on the same Wi-Fi network (not mobile data on the phone, and not a guest Wi-Fi network).",
      "Make sure Budget Secure is open on your PC.",
      "On your PC, make sure you allowed the connection in the sync section and clicked Yes on the computer's permission popup.",
      "Try turning your phone's Wi-Fi off and on again."
    ],

    q2: "The QR code won't scan",
    a2: [
      "Clean your camera lens and hold the phone 20-30 cm from the screen.",
      "Make the PC window bigger so the code is larger.",
      "Use \"Enter code manually\" instead."
    ],

    q3: "It was connected but stopped",
    a3: [
      "This is normal if your PC went to sleep or the Wi-Fi dropped. It reconnects by itself when both are back on the same Wi-Fi.",
      "If it doesn't, scan the code again."
    ],

    q4: "Is my data safe?",
    a4: [
      "On the same Wi-Fi, your data goes straight from your phone to your PC. When they are on different networks it passes through a relay, locked before it leaves your device so only your phone and PC can read it, and deleted once your other device has collected it."
    ]
  }
} as const;

export type SyncStrings = typeof syncStrings;
