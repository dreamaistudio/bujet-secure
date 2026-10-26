/**
 * relayConfig.js — where this build's internet post box lives.
 *
 * Put the address printed by `npx wrangler deploy` (in the relay folder) here,
 * for example:
 *
 *   const RELAY_URL = 'https://budget-secure-relay.your-name.workers.dev';
 *
 * Leave it empty to turn the post box off: sync then works over the same Wi-Fi
 * only, exactly as before.
 *
 * The address can also be changed without rebuilding the app by writing it
 * into a file named sync_relay.txt in the app's data folder
 * (%APPDATA%\Budget Secure). That file wins over the value below.
 */
const RELAY_URL = 'https://budget-secure-relay.dreamaistudio.workers.dev';

module.exports = { RELAY_URL };
