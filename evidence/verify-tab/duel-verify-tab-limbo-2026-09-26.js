// Code written in javascript

// User input values
const clientSeed = '';
const serverSeed = '';
const nonce = 0;
const houseEdge = 0; // 0% applied to this bet

// Converts a hex string (e.g. "deadbeef") into a Uint8Array of bytes
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Converts a Uint8Array of bytes back into a hex string (e.g. [222, 173, 190, 239] → "deadbeef")
function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Computes a HMAC-SHA256 using the Web Crypto API
// keyHex: hex-encoded key (e.g. server seed)
// message: Uint8Array to be signed
async function generateHMAC_SHA256(keyHex, message) {
  const keyBytes = hexToBytes(keyHex);

  // Import raw key for HMAC use
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  // Generate HMAC signature
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
  return bytesToHex(new Uint8Array(signature)); // Return signature as hex
}

// The actual fairness verification function
const validateLimboResult = async (serverSeed, clientSeed, nonce) => {
  // Prepare input message for HMAC: public seed + nonce
  const message = new TextEncoder().encode(`${clientSeed}:${nonce}`);

  // Compute HMAC hash
  const hash = await generateHMAC_SHA256(serverSeed, message);

  const MAX = 2 ** 32;
  const value = parseInt(hash.slice(0, 8), 16);

  // The provably fair roll, with no house edge in it
  const roll = Math.max(1.0, Math.floor((MAX / (value + 1)) * 1000000) / 1000000);

  // The multiplier the bet is scored on: the roll with this bet's house edge taken out of it,
  // never below the 1x floor of the game. You win when it reaches the target you picked.
  const afterEdge = Math.max(1, Math.floor(roll * (1 - houseEdge) * 1000000) / 1000000);

  return { roll: roll.toFixed(6), afterEdge: afterEdge.toFixed(6) };
}

// Run the validateLimboResult function if input values are provided
if (serverSeed && serverSeed.trim() !== '' && clientSeed && clientSeed.trim() !== '' && nonce >= 0) {
  validateLimboResult(serverSeed, clientSeed, nonce).then(({ roll, afterEdge }) => {
    console.log("Game result:", afterEdge + "x");
    if (houseEdge > 0) {
      console.log("PF roll before edge:", roll + "x");
    } else {
      console.log("Note: the real round multiplier changes with the size of the bet and the scaling edge applied");
    }
  });
} else {
  console.log("Please provide valid serverSeed, clientSeed, and nonce (>=0) before running.");
}
