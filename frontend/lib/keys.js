export function getRotatedKey() {
  const keys = [];
  
  // Load primary key
  const mainKey = process.env.GEMINI_API_KEY;
  if (mainKey) keys.push(mainKey);

  // Load rotated keys
  for (let i = 1; ; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) keys.push(k);
    else break;
  }
  
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
}
