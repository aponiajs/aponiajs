# @aponiajs/mapped-types

Mapped DTO utilities (`PartialType`, `PickType`, `OmitType`, `IntersectionType`) for AponiaJS validation models.

## Usage

```ts
import { createDto } from "@aponiajs/common";
import { IntersectionType, OmitType, PartialType, PickType } from "@aponiajs/mapped-types";
import { Type } from "typebox";

class CreateUserDto extends createDto(
  Type.Object({
    id: Type.String(),
    email: Type.String(),
    password: Type.String(),
  }),
) {}

export class UpdateUserDto extends PartialType(CreateUserDto) {}
export class PublicUserDto extends OmitType(CreateUserDto, ["password"] as const) {}
export class UserCredentialsDto extends PickType(CreateUserDto, ["email", "password"] as const) {}
export class MergedUserDto extends IntersectionType(PublicUserDto, UserCredentialsDto) {}
```
