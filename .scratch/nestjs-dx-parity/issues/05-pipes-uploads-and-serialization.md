# Pipes, File Uploads, and Serialization Techniques

Type: grilling
Status: open
Blocked by: 01, 03

## Question

Settle the exact contracts for NestJS's pipe, file-upload, mapped-type, and serialization techniques without adding `class-validator` or `class-transformer` runtime dependencies:

1. **Serialization decorators (`@Exclude`, `@Expose`, `@Transform`)**: What exact option subsets (`toPlainOnly`, `toClassOnly`, `name`, `groups`, `value` transform fn) should `@Exclude()`, `@Expose()`, and `@Transform()` support on classes, properties, and getters, and how does `ClassSerializerInterceptor` compose them with `@SerializeOptions()`?
2. **File uploads**: Define `FileValidator`, `MaxFileSizeValidator`, `FileTypeValidator`, `ParseFilePipeBuilder`, and `ParseFilePipe({ validators, ... })` (while preserving `maxSize`/`mimetype` shorthand), plus `FileInterceptor`, `FilesInterceptor`, `FileFieldsInterceptor`, and `AnyFilesInterceptor` across Elysia, Hono, and H3 multipart requests.
3. **Built-in pipe exceptions & mapped types**: Confirm the `HttpException` subclass design for `ParseIntPipe` / `ParseFloatPipe` / `ParseBoolPipe` / `ParseDatePipe` / `ParseEnumPipe` / `ParseArrayPipe` / `ParseUUIDPipe` / `ParseFilePipe` so both `@Catch(HttpException)` / `BadRequestException` AND `code: "INVALID_PIPE_VALUE"` assertions hold, and define `PartialType` / `PickType` / `OmitType` / `IntersectionType` interop over `@Validation()` classes and `createDto()` schemas.
