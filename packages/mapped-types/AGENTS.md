# @aponiajs/mapped-types — Agent Guide

Read the [repository guide](../../AGENTS.md) first. This file covers only what is
specific to this package.

## What this package owns

Nest-compatible DTO composition helpers (`PartialType`, `PickType`, `OmitType`,
`IntersectionType`) that derive new `@Validation()` / `createDto()` model classes
from existing TypeBox-backed DTO classes or plain classes.
