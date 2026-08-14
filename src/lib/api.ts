/**
 * Extracts a human-readable error message from a failed fetch Response whose body is
 * expected to be `{ error: string }` JSON. Falls back to a generic message if the body
 * isn't JSON or doesn't have that shape (e.g. a proxy error page, a 500 with no body).
 */
export async function extractError(res: Response): Promise<string> {
    try {
        const body = await res.json();
        return typeof body.error === 'string' ? body.error : 'Something went wrong';
    } catch {
        return 'Something went wrong';
    }
}
