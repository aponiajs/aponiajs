import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BladeViewEngine } from "../src/index.ts";

let root = "";
let engine: BladeViewEngine;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "aponia-blade-"));
  await mkdir(join(root, "layouts"), { recursive: true });
  await mkdir(join(root, "partials"), { recursive: true });
  await mkdir(join(root, "components"), { recursive: true });
  await mkdir(join(root, "users"), { recursive: true });

  await writeFile(
    join(root, "layouts", "app.html"),
    "<main>@yield('content')</main><footer>{{ footer }}</footer>",
    "utf8",
  );
  await writeFile(
    join(root, "layouts", "fallback.html"),
    "@yield('content', 'fallback')|@yield('missing', 'none')",
    "utf8",
  );
  await writeFile(join(root, "partials", "nav.html"), "<nav>{{ active }}</nav>", "utf8");
  await writeFile(
    join(root, "components", "alert.html"),
    '<div class="alert-{{ type }}">{!! slot !!}</div>',
    "utf8",
  );
  await writeFile(
    join(root, "users", "show.html"),
    "@extends('layouts.app')\n@section('content')\n@include('partials.nav', { active: 'users' })\n<x-alert type=\"warning\" :count=\"count\">User {{ user.name }} has {{ count }} items</x-alert>\n@if(showFooter)<p>footer on</p>@else<p>footer off</p>@endif\n@endsection",
    "utf8",
  );
  await writeFile(
    join(root, "list.html"),
    "<ul>@foreach(items as item)<li>{{ item }}</li>@endforeach</ul>",
    "utf8",
  );
  await writeFile(join(root, "escape.html"), "<p>{{ value }}</p><div>{!! value !!}</div>", "utf8");
  await writeFile(
    join(root, "components", "badge.html"),
    "{{ active }}|{{ title }}|{{ count }}|{!! slot !!}",
    "utf8",
  );
  await writeFile(join(root, "no-sections.html"), "@extends('layouts.fallback')", "utf8");
  await writeFile(
    join(root, "inline-section.html"),
    "@section('greeting', 'Hello')@yield('greeting')",
    "utf8",
  );
  await writeFile(
    join(root, "unless.html"),
    "@unless(false)shown@endunless@unless(true)hidden@endunless",
    "utf8",
  );
  await writeFile(
    join(root, "foreach-object.html"),
    "@foreach(users as key => user){{ key }}:{{ user.name }};@endforeach",
    "utf8",
  );
  await writeFile(join(root, "foreach-null.html"), "@foreach(missing as item)x@endforeach", "utf8");
  await writeFile(
    join(root, "components-props.html"),
    '<x-badge active title="Hi {{ name }}" :count="items.length">inner</x-badge>',
    "utf8",
  );
  await writeFile(join(root, "self.html"), "@include('self')", "utf8");
  await writeFile(join(root, "explicit.html"), "<p>explicit</p>", "utf8");
  await writeFile(join(root, "if-no-else.html"), "@if(true)yes@endif", "utf8");
  await writeFile(join(root, "stringify.html"), "{{ user }}", "utf8");
  await writeFile(join(root, "eval-error.html"), "{{ missing.method }}", "utf8");
  await writeFile(join(root, "yield-fallback.html"), "@yield('missing', 'fallback')", "utf8");
  await writeFile(
    join(root, "include-non-object.html"),
    "@include('partials.nav', 'not-an-object')",
    "utf8",
  );

  engine = new BladeViewEngine({ rootDir: root });
  engine.share("footer", "shared footer");
});

afterAll(async () => {
  if (root !== "") {
    await rm(root, { recursive: true, force: true });
  }
});

describe("BladeViewEngine", () => {
  test("resolves dot-notation templates with layout, section, yield, include, component props, and slot", async () => {
    const html = await engine.render("users.show", {
      user: { name: "Ada" },
      count: 3,
      showFooter: true,
    });

    expect(html).toContain("<nav>users</nav>");
    expect(html).toContain('<div class="alert-warning">User Ada has 3 items</div>');
    expect(html).toContain("<p>footer on</p>");
    expect(html).toContain("<footer>shared footer</footer>");
  });

  test("runs conditionals, loops, and shared data", async () => {
    const off = await engine.render("users.show", { user: { name: "Ada" }, count: 1 });
    expect(off).toContain("<p>footer off</p>");

    const list = await engine.render("list", { items: ["a", "b"] });
    expect(list).toBe("<ul><li>a</li><li>b</li></ul>");
  });

  test("escapes echoed values and leaves raw output unescaped", async () => {
    const html = await engine.render("escape", { value: "<script>alert(1)</script>" });
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("<div><script>alert(1)</script></div>");
  });

  test("reports a missing template", async () => {
    const failure = await engine.render("missing.template", {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("was not found");
  });

  test("renders inline sections, unless, and a layout fallback without sections", async () => {
    expect(await engine.render("inline-section", {})).toBe("Hello");
    expect(await engine.render("unless", {})).toBe("shown");
    expect(await engine.render("no-sections", {})).toBe("|none");
  });

  test("iterates objects with keys and skips a missing collection", async () => {
    const html = await engine.render("foreach-object", {
      users: { a: { name: "Ada" }, b: { name: "Linus" } },
    });
    expect(html).toBe("a:Ada;b:Linus;");
    expect(await engine.render("foreach-null", {})).toBe("");
  });

  test("binds boolean and interpolated component props", async () => {
    const html = await engine.render("components-props", {
      name: "Ada",
      items: [1, 2],
    });
    expect(html).toBe("true|Hi Ada|2|inner");
  });

  test("handles explicit paths, if without else, object output, and expression failures", async () => {
    expect(await engine.render("explicit.html", {})).toBe("<p>explicit</p>");
    expect(await engine.render("if-no-else", {})).toBe("yes");
    expect(await engine.render("stringify", { user: { name: "Ada" } })).toBe(
      "{&quot;name&quot;:&quot;Ada&quot;}",
    );
    expect(await engine.render("eval-error", {})).toBe("");
  });

  test("refuses a template that includes itself", async () => {
    const failure = await engine.render("self", {}).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain("includes itself");
  });

  test("uses a yield fallback and ignores a non-object include payload", async () => {
    expect(await engine.render("yield-fallback", {})).toBe("fallback");
    expect(await engine.render("include-non-object", { active: "users" })).toBe("<nav>users</nav>");
  });

  test("renders an empty string for a value JSON cannot serialize", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(await engine.render("stringify", { user: circular })).toBe("");
  });
});
