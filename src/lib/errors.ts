export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}
export const badRequest = (code: string, msg?: string) => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Sign in required') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (code = 'forbidden', msg?: string) => new HttpError(403, code, msg);
export const notFound = (what = 'Not found') => new HttpError(404, 'not_found', what);
export const conflict = (code: string, msg?: string) => new HttpError(409, code, msg);
