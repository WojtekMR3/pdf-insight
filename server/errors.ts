export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** A response failure eligible for the single correction attempt. */
export class InvalidModelReply extends Error {}
