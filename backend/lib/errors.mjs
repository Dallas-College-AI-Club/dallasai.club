export class RequestError extends Error {
  // details are extra JSON fields for the client, such as code or current.
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
