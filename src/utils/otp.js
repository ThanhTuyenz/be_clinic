import crypto from 'crypto'

/** 6 chữ số */
export function generateOtp() {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, '0')
}
