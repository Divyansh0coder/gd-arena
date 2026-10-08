/**
 * Production Deployment Helper for API and WebSocket URLs.
 * 
 * Supports:
 * 1. Monorepo Single-Origin Deployment (VITE_API_BASE_URL & VITE_WS_URL undefined or empty).
 * 2. Separate Frontend/Backend Deployment (VITE_API_BASE_URL="https://your-backend.onrender.com").
 */

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export function getApiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${cleanPath}`;
}

export function getWsUrl(sessionId: string): string {
  const envWs = (import.meta.env.VITE_WS_URL || "").replace(/\/$/, "");
  if (envWs) {
    let base = envWs;
    if (base.startsWith("http://")) {
      base = base.replace(/^http:\/\//, "ws://");
    } else if (base.startsWith("https://")) {
      base = base.replace(/^https:\/\//, "wss://");
    } else if (!base.startsWith("ws://") && !base.startsWith("wss://")) {
      base = `wss://${base}`;
    }
    return `${base}/ws/session/${sessionId}`;
  }

  // Fallback to current browser host
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host;
  return `${protocol}//${host}/ws/session/${sessionId}`;
}
