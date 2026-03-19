import { URL } from 'url'
import { isIP } from 'net'
import dns from 'dns/promises'

const BLOCKED_RANGES = [
  /^127\./,                    // 127.0.0.0/8
  /^10\./,                     // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0/12
  /^192\.168\./,               // 192.168.0.0/16
  /^169\.254\./,               // 169.254.0.0/16
  /^0\./,                      // 0.0.0.0/8
  /^::1$/,                     // IPv6 loopback
  /^fc00:/i,                   // IPv6 private
  /^fd/i,                      // IPv6 private
  /^fe80:/i,                   // IPv6 link-local
]

function isPrivateIP(ip: string): boolean {
  return BLOCKED_RANGES.some(r => r.test(ip))
}

/**
 * Validate that a URL points to a public host (not internal/private).
 * Returns the validated URL string or throws an error.
 */
export async function validatePublicUrl(rawUrl: string): Promise<string> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('Invalid URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('URL must use http or https')
  }

  const hostname = parsed.hostname

  // Check if hostname is directly an IP
  if (isIP(hostname)) {
    if (isPrivateIP(hostname)) {
      throw new Error('URL must not point to a private/internal address')
    }
    return rawUrl
  }

  // Block obvious internal hostnames
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('URL must not point to a private/internal address')
  }

  // Resolve DNS and check IP
  try {
    const addresses = await dns.resolve4(hostname)
    for (const addr of addresses) {
      if (isPrivateIP(addr)) {
        throw new Error('URL must not point to a private/internal address')
      }
    }
  } catch (e: any) {
    if (e.message?.includes('private')) throw e
    // DNS resolution failed — allow (might work at runtime)
  }

  return rawUrl
}
