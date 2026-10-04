// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));

import GlobalError from "../global-error";
import AppNotFound from "../(app)/not-found";
import AppError from "../(app)/error";

describe("error pages (NAV-01c)", () => {
  it("global-error brings its own html/body, a Try again button and no error text", () => {
    const html = renderToStaticMarkup(<GlobalError error={Object.assign(new Error("db password leaked"), { digest: "d1" })} retry={() => undefined} />);
    expect(html).toMatch(/^<html/);
    expect(html).toContain("<body");
    expect(html).toContain("Try again");
    expect(html).toContain("Reference: d1");
    expect(html).not.toContain("db password leaked");
  });

  it("(app)/not-found links Home", () => {
    const html = renderToStaticMarkup(<AppNotFound />);
    expect(html).toContain("couldn&#x27;t find that page");
    expect(html).toContain('href="/"');
  });

  it("(app)/error renders the shared card without the error message", () => {
    const html = renderToStaticMarkup(<AppError error={new Error("stack at /srv/x.ts")} retry={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("Try again");
    expect(html).not.toContain("/srv/x.ts");
  });

  it("positive control: the leak check would catch a page that printed the message", () => {
    const leaky = renderToStaticMarkup(<p>{new Error("db password leaked").message}</p>);
    expect(leaky).toContain("db password leaked");
  });
});
