/** A request the studio refuses, with the HTTP status and a message for the user (returned as ProblemDetails). */
export class StudioError extends Error {
  constructor(public status: number, public title: string, detail: string) {
    super(detail);
  }
}

/** A block or page the AI (or a user) produced breaks the catalogue rules. */
export class InvalidBlockError extends Error {}

/** Inputs failed validation: field → messages (returned as a ValidationProblem). */
export class ParameterValidationError extends Error {
  constructor(public errors: Record<string, string[]>) {
    super("One or more parameters are invalid.");
  }
}
