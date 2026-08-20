export class EnvironmentError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = "EnvironmentError";
    this.code = code;
    this.details = details;
  }
}
