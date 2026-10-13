import { NextResponse } from 'next/server';

export function jsonSuccess<T = any>(data: T, status = 200, headers: Record<string, string> = {}) {
  return NextResponse.json(
    {
      success: true,
      data,
    },
    { status, headers }
  );
}

export function jsonError(message: string, status = 400, details?: any) {
  return NextResponse.json(
    {
      success: false,
      error: message,
      details: details ?? null,
    },
    { status }
  );
}

export function jsonUnauthorized(message = 'Authentication required. Missing or invalid Bearer token.') {
  return jsonError(message, 401);
}

export function jsonForbidden(message = 'You do not have permission to perform this action.') {
  return jsonError(message, 403);
}

export function jsonNotFound(message = 'Resource not found.') {
  return jsonError(message, 404);
}
