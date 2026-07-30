# Learning Path

An ordered walkthrough of AponiaJS. Each chapter states when it applies, shows
the smallest working code, and points at the reference document that covers the
same ground in depth. Read them in order the first time; jump by number
afterwards.

| Chapter                                                         | Answers                                                     |
| --------------------------------------------------------------- | ----------------------------------------------------------- |
| [01 · Overview](./01-overview.md)                               | What AponiaJS is, and the two authoring layers behind it    |
| [02 · Install and generate](./02-install-and-generate.md)       | How to start a project and what the generator produces      |
| [03 · Modules](./03-modules.md)                                 | How code is grouped and what a module exposes               |
| [04 · Providers and injection](./04-providers-and-injection.md) | How dependencies are declared and resolved                  |
| [05 · Controllers and routes](./05-controllers-and-routes.md)   | How a request reaches a method                              |
| [06 · Validation](./06-validation.md)                           | How invalid requests are rejected before the handler        |
| [07 · Request parameters](./07-request-parameters.md)           | How to take one piece of the request instead of the context |
| [08 · Native plugins](./08-native-plugins.md)                   | How to use an Elysia plugin and keep its types              |
| [09 · Logging](./09-logging.md)                                 | What the framework prints, and how to replace it            |
| [10 · Errors](./10-errors.md)                                   | Which failures are raised, when, and how to assert on them  |
| [11 · Testing](./11-testing.md)                                 | How to exercise a real application without a port           |
| [12 · Releasing](./12-releasing.md)                             | How a change reaches npm, for contributors                  |

Reference documents live one directory up: [architecture and style](../architecture-and-style.md),
[dependency injection](../dependency-injection.md),
[WebSocket gateways](../websockets.md), [native plugins](../native-plugins.md),
[logging](../logging.md),
[testing](../testing.md), [CLI](../cli.md), [releasing](../releasing.md).
