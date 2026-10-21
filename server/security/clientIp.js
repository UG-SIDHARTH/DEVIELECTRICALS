import net from 'node:net';
import config from '../config.js';

/**
 * Extracts and strictly validates the real client IP behind Cloudflare Tunnel.
 * The CF-Connecting-IP header is trusted ONLY if the immediate TCP remote peer
 * is the verified internal cloudflared container address (default: 172.28.0.10).
 *
 * @param {import('express').Request} req
 * @returns {string} The verified client IP address
 */
export function getClientIp(req) {
  // Normalize remote address (stripping IPv6 mapped IPv4 prefix if present)
  let remotePeer = req.socket?.remoteAddress || req.connection?.remoteAddress || '127.0.0.1';
  if (remotePeer.startsWith('::ffff:')) {
    remotePeer = remotePeer.replace('::ffff:', '');
  }

  // Only trust proxy headers when TCP connection originates from trusted cloudflared IP
  if (remotePeer === config.trustedProxyIp || (!config.isProd && (remotePeer === '127.0.0.1' || remotePeer === '::1'))) {
    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string') {
      const cleanIp = cfConnectingIp.trim();
      if (net.isIP(cleanIp)) {
        return cleanIp;
      }
    }
  }

  return remotePeer;
}

export default getClientIp;
