import { HttpException } from "./http.exception.ts";
import { httpStatus } from "./http-status.ts";

/** The options every built-in exception accepts after its body. */
export interface BuiltInExceptionOptions {
  readonly cause?: unknown;
  readonly description?: string;
}

type ExceptionBody = string | object | undefined;

function buildBody(objectOrError: ExceptionBody, description?: string): string | object {
  if (typeof objectOrError === "string") {
    return description === undefined ? objectOrError : `${objectOrError}: ${description}`;
  }
  if (objectOrError === undefined) {
    return description ?? "Unexpected error";
  }
  return objectOrError;
}

function optionsOf(
  descriptionOrOptions?: string | BuiltInExceptionOptions,
): BuiltInExceptionOptions {
  return typeof descriptionOrOptions === "string"
    ? { description: descriptionOrOptions }
    : (descriptionOrOptions ?? {});
}

/** A `400 Bad Request`. */
export class BadRequestException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.BAD_REQUEST, options);
  }
}

/** A `401 Unauthorized`. */
export class UnauthorizedException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.UNAUTHORIZED, options);
  }
}

/** A `403 Forbidden`. */
export class ForbiddenException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.FORBIDDEN, options);
  }
}

/** A `404 Not Found`. */
export class NotFoundException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.NOT_FOUND, options);
  }
}

/** A `405 Method Not Allowed`. */
export class MethodNotAllowedException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.METHOD_NOT_ALLOWED, options);
  }
}

/** A `406 Not Acceptable`. */
export class NotAcceptableException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.NOT_ACCEPTABLE, options);
  }
}

/** A `408 Request Timeout`. */
export class RequestTimeoutException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.REQUEST_TIMEOUT, options);
  }
}

/** A `409 Conflict`. */
export class ConflictException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.CONFLICT, options);
  }
}

/** A `410 Gone`. */
export class GoneException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.GONE, options);
  }
}

/** A `412 Precondition Failed`. */
export class PreconditionFailedException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.PRECONDITION_FAILED, options);
  }
}

/** A `413 Payload Too Large`. */
export class PayloadTooLargeException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.PAYLOAD_TOO_LARGE, options);
  }
}

/** A `415 Unsupported Media Type`. */
export class UnsupportedMediaTypeException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(
      buildBody(objectOrError, options.description),
      httpStatus.UNSUPPORTED_MEDIA_TYPE,
      options,
    );
  }
}

/** A `421 Misdirected Request`. */
export class MisdirectedException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.MISDIRECTED, options);
  }
}

/** A `422 Unprocessable Entity`. */
export class UnprocessableEntityException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.UNPROCESSABLE_ENTITY, options);
  }
}

/** A `429 Too Many Requests`. */
export class TooManyRequestsException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.TOO_MANY_REQUESTS, options);
  }
}

/** A `418 I'm a Teapot`. */
export class ImATeapotException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.I_AM_A_TEAPOT, options);
  }
}

/** A `500 Internal Server Error`. */
export class InternalServerErrorException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.INTERNAL_SERVER_ERROR, options);
  }
}

/** A `501 Not Implemented`. */
export class NotImplementedException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.NOT_IMPLEMENTED, options);
  }
}

/** A `502 Bad Gateway`. */
export class BadGatewayException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.BAD_GATEWAY, options);
  }
}

/** A `503 Service Unavailable`. */
export class ServiceUnavailableException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.SERVICE_UNAVAILABLE, options);
  }
}

/** A `504 Gateway Timeout`. */
export class GatewayTimeoutException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(buildBody(objectOrError, options.description), httpStatus.GATEWAY_TIMEOUT, options);
  }
}

/** A `505 HTTP Version Not Supported`. */
export class HttpVersionNotSupportedException extends HttpException {
  constructor(
    objectOrError?: ExceptionBody,
    descriptionOrOptions?: string | BuiltInExceptionOptions,
  ) {
    const options = optionsOf(descriptionOrOptions);
    super(
      buildBody(objectOrError, options.description),
      httpStatus.HTTP_VERSION_NOT_SUPPORTED,
      options,
    );
  }
}
