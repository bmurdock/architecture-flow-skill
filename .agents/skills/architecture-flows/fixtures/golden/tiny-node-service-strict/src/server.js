import { buildGreeting } from './handler.js';

export function startServer(request) {
  return buildGreeting(request.name);
}
