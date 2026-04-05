import { describe, expect, it } from "vitest";
import {
  isValidWaitlistEmail,
  normalizeWaitlistPayload,
} from "../lib/waitlist";

describe("normalizeWaitlistPayload", () => {
  it("normalizes and lowercases email fields", () => {
    expect(
      normalizeWaitlistPayload({
        email: "  PERSON@Example.COM ",
        role: " Estimator ",
        company: "  Acme Build  ",
      }),
    ).toEqual({
      email: "person@example.com",
      role: "Estimator",
      company: "Acme Build",
      source: "landing_page",
    });
  });

  it("collapses blank optional fields to null", () => {
    expect(
      normalizeWaitlistPayload({
        email: "user@example.com",
        role: " ",
        company: "",
        source: " ",
      }),
    ).toEqual({
      email: "user@example.com",
      role: null,
      company: null,
      source: "landing_page",
    });
  });
});

describe("isValidWaitlistEmail", () => {
  it("accepts a valid email", () => {
    expect(isValidWaitlistEmail("user@example.com")).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(isValidWaitlistEmail("not-an-email")).toBe(false);
  });
});
