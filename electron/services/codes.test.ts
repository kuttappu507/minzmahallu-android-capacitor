import { describe, it, expect } from "vitest";
import { makeVerificationCode } from "./codes.js";

describe("verification codes", () => {
  it("produces the expected shape", () => {
    const code = makeVerificationCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  });

  it("is unique across calls", () => {
    const codes = new Set(Array.from({ length: 200 }, () => makeVerificationCode()));
    expect(codes.size).toBe(200);
  });

  it("excludes ambiguous characters (0, O, 1, I, L)", () => {
    const code = makeVerificationCode(5, 8);
    expect(code).not.toMatch(/[0O1IL]/);
  });
});
