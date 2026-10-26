# Budget Secure — post box (relay)

A tiny Cloudflare Worker that lets the Windows app and the Android app reach
each other when they are NOT on the same Wi-Fi, or when one of them is asleep.

It stores only sealed envelopes: both devices lock everything with a key that
is created during QR pairing and never leaves them, so this service cannot read
any of your money data. It holds each envelope until the other device has
picked it up, then deletes it (and in any case after 30 days).

## Put it online (once)

From the project folder:

    cd relay
    npm install
    npx wrangler login     # opens the browser, click Allow
    npx wrangler deploy

Wrangler prints an address like:

    https://budget-secure-relay.YOUR-NAME.workers.dev

Open Budget Secure on the PC, go to Settings, and paste that address into the
sync section. The PC puts it into the QR code, so the phone picks it up when it
pairs. Nothing else to set up.

## Cost

It fits inside Cloudflare's free plan with room to spare: two devices checking
in every half minute use a few thousand of the 100,000 free requests a day.
If a day's free allowance ever ran out, the post box pauses until the next day
and Wi-Fi sync keeps working; no bill appears.
