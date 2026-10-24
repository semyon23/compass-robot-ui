/** Ошибка обращения к роботу: машинный code (контракт §1) — UI показывает текст по нему. */
export class ApiError extends Error {
  constructor(code, message, details) {
    super(message || code)
    this.code = code
    this.details = details
  }
}
