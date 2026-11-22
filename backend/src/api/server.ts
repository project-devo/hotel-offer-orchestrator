import http from 'node:http';
import type { Express } from 'express';

export function startServer(app: Express, port: number): Promise<http.Server> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    // Outlive the platform load balancer's idle timeout to avoid sporadic 502s.
    server.keepAliveTimeout = 65_000;
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => resolve(server));
  });
}

export function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}
