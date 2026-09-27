/**
 * Error carrying an HTTP status from the service layer to the response. The
 * app-level error handler already renders { error: message } with this status
 * for anything below 500, so routes stay thin.
 */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
