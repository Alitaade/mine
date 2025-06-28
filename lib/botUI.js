// botUI.js

// Main menu keyboard (two per row)
const createMainMenuKeyboard = () => ({
  reply_markup: {
    inline_keyboard: [
    [
  { text: '📱 Pair WhatsApp', callback_data: 'pair' },
  { text: '🔍 Check Status', callback_data: 'status' }
],
[
  { text: '❌ Logout', callback_data: 'disconnect' }, // Ensure this matches the case in the handler
  { text: '🔌 Pause Bot', callback_data: 'cancel_connection' }
]
    ],
  },
});

// Home button keyboard
const homeButton = {
  reply_markup: {
    inline_keyboard: [
      [{ text: '🏠 Back to Home', callback_data: 'home' }],
    ],
  },
};

// Yes/No confirmation keyboard
const createYesNoKeyboard = (dataPrefix) => ({
  reply_markup: {
    inline_keyboard: [
      [
        { text: '✅ Yes', callback_data: `${dataPrefix}_yes` },
        { text: '❌ No', callback_data: `${dataPrefix}_no` },
      ],
      [{ text: '🏠 Back to Home', callback_data: 'home' }],
    ],
  },
});

// Disconnect confirmation keyboard
const createDisconnectConfirmationKeyboard = () => createYesNoKeyboard('disconnect_confirm');

// Cancel connection confirmation keyboard
const createCancelConnectionConfirmationKeyboard = () => createYesNoKeyboard('cancel_confirm');

// Welcome message
const welcomeMessage = `
╭═══════『 𝐖𝐄𝐋𝐂𝐎𝐌𝐄 』═══════⊱
│
├─────『 𝐁𝐨𝐭 𝐅𝐞𝐚𝐭𝐮𝐫𝐞𝐬 』
│ • WhatsApp ↔ PAUL BOT
│ • Media Support
│ • Multi-Device Ready
│ • End-to-End Encryption
│
├─────『 𝐒𝐮𝐩𝐩𝐨𝐫𝐭𝐞𝐝 𝐂𝐨𝐦𝐦𝐚𝐧𝐝𝐬 』
│ /start - Show main menu
│ /pair - Connect WhatsApp
│ /status - Check connection
│ /disconnect - Remove session
│ /help - User Manual
╰═════════════════════⊱`;

// Help message
const helpMessage = `
*Help Information*
------------------
/start - Show the main menu.
/pair - Connect your WhatsApp account. Follow the instructions to pair your device.
/status - Check your current connection status with WhatsApp.
/disconnect - Permanently disconnect and remove your session.
/cancel_connection - Temporarily cancel the connection without deleting your session.

*How to Use:*
1. Tap /pair or the "Pair WhatsApp" button to begin pairing.
2. If you already have a session, the bot will try to reconnect automatically.
3. Use /status to view your current connection details.
4. Use /disconnect to log out and remove your saved session.
5. Use /cancel_connection to disconnect temporarily (your session will be backed up).

For further assistance, please consult the user manual or message owner(https://wa.me/2347067023422).
`;

// Pairing code message
const getPairingCodeMessage = (pairingCode) => `
🔐 *Pairing Code*
\`${pairingCode}\`

1. Open WhatsApp > Settings
2. Linked Devices > Link Device
3. Enter the code above
`;

// Phone number prompt message
const phoneNumberPromptMessage = `
📲 Please enter your WhatsApp number in international format:
(e.g., +1234567890)
`;

// No active connection message
const noActiveConnectionMessage = "⚠️ No active connection found to cancel!";
const cancelaborted = "✅ Cancellation aborted.";
// Connection cancelled message
const connectionCancelledMessage = "✅ WhatsApp connection cancelled. Your session has been backed up.";

// Connection cancelled (forced) message
const connectionCancelledForcedMessage = "✅ Connection cancelled (forced). Your session has been backed up.";

// Found existing session message
const foundExistingSessionMessage = "Found existing session. Attempting to reconnect...";
const messageFowardingDisabled = "✅ Message forwarding disabled. You will not receive WhatsApp messages in this chat.";
// Enable message forwarding prompt
const enableMessageForwardingMessage = "🔔 Enable message forwarding to Telegram?";

// Success message generator
const getSuccessMessage = (userInfo, status) => {
  const statusMessage = status === 'connected' ? 'Connected ✅' : 'Not Connected ❌';
  const connectionInfo = status === 'connected'
    ? `│ • Name: ${userInfo?.name || 'Unknown'}\n│ • Number: ${userInfo?.id ? String(userInfo.id).split(':')[0] : 'Unknown'}`
    : '│ • Session: Existing session found';

  return {
    message: `
╭═══════『 𝐖𝐡𝐚𝐭𝐬𝐀𝐩𝐩 𝐒𝐭𝐚𝐭𝐮𝐬 』═══════⊱
│
├─────『 𝐂𝐨𝐧𝐧𝐞𝐜𝐭𝐢𝐨𝐧 𝐒𝐭𝐚𝐭𝐮𝐬 』
│ • Status: ${statusMessage}
${connectionInfo}
│
├─────『 𝐁𝐨𝐭 𝐈𝐧𝐟𝐨 』
│ • Mode: ${status === 'connected' ? 'Active' : 'Standby'}
│ • Version: 3.0 Stable Release
│ • Type: Multi-Device
│ 
╰═════════════════════⊱`,
    keyboard: {
      reply_markup: {
        inline_keyboard: [
          ...(status !== 'connected' ? [[{ text: '📱 Reconnect', callback_data: 'pair' }]] : []),
          [{ text: '🏠 Back to Home', callback_data: 'home' }],
        ],
      },
    },
  };
};

module.exports = {
  createMainMenuKeyboard,
  homeButton,
  createYesNoKeyboard,
  createDisconnectConfirmationKeyboard,
  createCancelConnectionConfirmationKeyboard,
  welcomeMessage,
  helpMessage, cancelaborted,
  getPairingCodeMessage,
  phoneNumberPromptMessage,
  noActiveConnectionMessage,
  connectionCancelledMessage,
  connectionCancelledForcedMessage,
  foundExistingSessionMessage,
  enableMessageForwardingMessage,
  getSuccessMessage,
};