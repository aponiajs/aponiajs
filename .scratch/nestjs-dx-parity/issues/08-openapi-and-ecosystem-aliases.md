# OpenAPI Swagger Surface and Ecosystem Aliases

Type: grilling
Status: open
Blocked by: 02, 05, 07

## Question

Settle the NestJS 1:1 contracts across `@aponiajs/openapi` and ecosystem feature packages:

1. **`@aponiajs/openapi` (`@nestjs/swagger` parity)**: Design `DocumentBuilder`, `SwaggerModule.createDocument(app, config, options?)`, `SwaggerModule.setup(path, app, document, options?)`, and core `@Api*` decorators (`@ApiTags`, `@ApiOperation`, `@ApiResponse`, `@ApiOkResponse`/`@ApiCreatedResponse`, `@ApiProperty`/`@ApiPropertyOptional`, `@ApiBearerAuth`, `@ApiParam`, `@ApiQuery`, `@ApiBody`, `@ApiExcludeEndpoint`) so they compose cleanly with `RouteSchema` / `@Validation()` models and `OpenApiModule.forRoot`.
2. **Ecosystem aliases**: Define exact compatibility surfaces for `EventEmitter2` (`@aponiajs/events`), `ThrottlerModule`/`ThrottlerGuard`/`@Throttle`/`@SkipThrottle` (`@aponiajs/rate-limit`), and `JwtModule` (`@aponiajs/auth`) — including any `forRoot`/`register` option differences from `RateLimitModule` / `AuthModule`.
