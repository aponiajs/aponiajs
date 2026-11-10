/** The default root document used when an application supplies none. */
export const defaultInertiaRootView = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    {{ styles }}
  </head>
  <body>
    {{ inertia }}
    {{ scripts }}
  </body>
</html>`;
